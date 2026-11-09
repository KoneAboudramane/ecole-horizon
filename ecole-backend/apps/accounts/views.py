from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from PIL import Image, UnidentifiedImageError
from rest_framework import generics, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.log import plog, record

from .invite import send_access
from apps.core.errors import field_error
from apps.core.permissions import STAFF_ROLES, perm_required

from .models import TotpDevice, User
from . import captcha, totp as totp_lib
from .passwords import temp_password, temp_pin
from .serializers import (MAX_PHOTO, PHOTO_TYPES, LoginSerializer, PasswordChangeSerializer, ProfileUpdateSerializer,
                          StaffCreateSerializer, UserAdminUpdateSerializer, UserSerializer, staff_email_taken)


def _tokens(user) -> dict:
    refresh = RefreshToken.for_user(user)
    refresh["role"] = user.role
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def resolve_school(code: str):
    """Établissement visé par une connexion : (école, None), (None, None) pour la plateforme, ou (None, réponse d'erreur)."""
    from apps.core.models import Etablissement
    code = (code or "").strip().lower()
    if code == "plateforme":
        return None, None
    if code:
        etab = Etablissement.objects.filter(code=code).first()
        if etab is None:
            return None, Response({"detail": "Code d’établissement inconnu."}, status=status.HTTP_401_UNAUTHORIZED)
    else:
        actifs = list(Etablissement.objects.filter(actif=True)[:2])
        if len(actifs) != 1:
            return None, Response({"detail": "Indiquez le code de votre établissement."}, status=status.HTTP_400_BAD_REQUEST)
        etab = actifs[0]
    if not etab.actif:
        return None, Response({"detail": "Cet établissement est suspendu. Contactez l’administration de la plateforme."}, status=status.HTTP_403_FORBIDDEN)
    return etab, None


def captcha_refused(request):
    """Réponse d'erreur si le contrôle anti-robot est actif et mal réussi, sinon None."""
    if not captcha.enabled():
        return None
    if captcha.verify(request.data.get("captcha_token", ""), request.data.get("captcha_answer", "")):
        return None
    return Response({"detail": "Vérification anti-robot incorrecte ou expirée. Répondez au calcul et réessayez.", "captcha": True}, status=status.HTTP_400_BAD_REQUEST)


class CaptchaView(APIView):
    """Nouveau défi anti-robot (ou {enabled: false} quand il est désactivé)."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        return Response(captcha.new_challenge() if captcha.enabled() else {"enabled": False})


class LoginView(APIView):
    """Connexion par identifiant et mot de passe. Renvoie les jetons et le profil (rôle, permissions)."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(request=LoginSerializer, responses={200: UserSerializer})
    def post(self, request):
        s = LoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        if (bad := captcha_refused(request)):
            return bad
        username, password = s.validated_data["username"].strip(), s.validated_data["password"]
        etab, err = resolve_school(s.validated_data.get("ecole", ""))
        if err:
            return err
        if etab is None:  # compte de la plateforme (sans école)
            user = User.all_objects.filter(etablissement__isnull=True, is_superuser=True, username__iexact=username).first()
        else:
            user = User.all_objects.filter(etablissement=etab, username__iexact=username).first()

        if user and user.is_locked:
            if etab is None:
                plog(request, "Connexion bloquée", f"{user.username} : compte verrouillé", user=user)
            record("Connexion bloquée", f"{user.username} : compte verrouillé", user=user, request=request)
            return Response({"detail": "Trop de tentatives. Réessayez dans quelques minutes ou contactez l’administration."},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        if not user or not user.check_password(password):
            if user:
                user.register_failure()
                if etab is None:
                    plog(request, "Connexion refusée", f"{user.username} : mot de passe incorrect", user=user)
                record("Connexion refusée", f"{user.username} : mot de passe incorrect", user=user, request=request)
            return Response({"detail": "Identifiant ou mot de passe incorrect."}, status=status.HTTP_401_UNAUTHORIZED)
        if not user.is_active:
            record("Connexion refusée", f"{user.username} : compte désactivé", user=user, request=request)
            return Response({"detail": "Ce compte est désactivé. Contactez l’administration."}, status=status.HTTP_403_FORBIDDEN)

        if etab is None:  # double authentification des administrateurs de la plateforme
            dev = TotpDevice.objects.filter(user=user, confirmed=True).first()
            if dev:
                code = s.validated_data.get("otp", "").strip()
                if not code:
                    return Response({"detail": "Saisissez le code de votre application d’authentification.", "otp_required": True}, status=status.HTTP_401_UNAUTHORIZED)
                if not dev.verifier(code):
                    user.register_failure()
                    plog(request, "Connexion refusée", f"{user.username} : code de double authentification incorrect", user=user)
                    return Response({"detail": "Code de vérification incorrect.", "otp_required": True}, status=status.HTTP_401_UNAUTHORIZED)
        user.register_success()
        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])
        record("Connexion", user.username, user=user, request=request)
        if etab is None:
            plog(request, "Connexion", user.username, user=user)
        return Response({**_tokens(user), "user": UserSerializer(user, context={"request": request}).data})


class LogoutView(APIView):
    """Invalide le jeton de rafraîchissement : la session ne peut plus être prolongée."""

    @extend_schema(request={"application/json": {"type": "object", "properties": {"refresh": {"type": "string"}}}}, responses={204: None})
    def post(self, request):
        try:
            RefreshToken(request.data.get("refresh", "")).blacklist()
        except TokenError:
            pass  # déjà invalide : l'objectif (ne plus pouvoir l'utiliser) est atteint
        record("Déconnexion", request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    @extend_schema(responses=UserSerializer)
    def get(self, request):
        return Response(UserSerializer(request.user, context={"request": request}).data)

    @extend_schema(request=ProfileUpdateSerializer, responses=UserSerializer)
    def patch(self, request):
        s = ProfileUpdateSerializer(request.user, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        if request.user.is_platform_admin and "email" in s.validated_data:
            # L'e-mail sert au mot de passe oublié : obligatoire et unique parmi les administrateurs de la plateforme.
            mail = s.validated_data["email"].strip().lower()
            if not mail:
                return Response({"email": ["L’e-mail est obligatoire (mot de passe oublié)."]}, status=400)
            if User.all_objects.filter(etablissement__isnull=True, email__iexact=mail).exclude(pk=request.user.pk).exists():
                return Response({"email": ["Cette adresse est déjà utilisée par un administrateur."]}, status=400)
        s.save()
        record("Profil modifié", request.user.username, request=request)
        if request.user.is_platform_admin:
            plog(request, "Profil modifié", request.user.username)
        return Response(UserSerializer(request.user, context={"request": request}).data)


class PhotoView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request={"multipart/form-data": {"type": "object", "properties": {"photo": {"type": "string", "format": "binary"}}}}, responses=UserSerializer)
    def post(self, request):
        f = request.FILES.get("photo")
        if not f:
            return Response({"detail": "Choisissez une image."}, status=400)
        if f.size > MAX_PHOTO:
            return Response({"detail": "Image trop lourde (2 Mo maximum)."}, status=400)
        if f.content_type not in PHOTO_TYPES:
            return Response({"detail": "Format non pris en charge : utilisez JPG, PNG ou WebP."}, status=400)
        try:
            Image.open(f).verify()  # le contenu doit réellement être une image, pas seulement en avoir l'extension
        except (UnidentifiedImageError, OSError):
            return Response({"detail": "Fichier illisible : ce n’est pas une image valide."}, status=400)
        f.seek(0)
        u = request.user
        if u.photo:
            u.photo.delete(save=False)
        u.photo.save(f.name, f, save=True)
        record("Photo de profil modifiée", u.username, request=request)
        return Response(UserSerializer(u, context={"request": request}).data)

    @extend_schema(responses=UserSerializer)
    def delete(self, request):
        u = request.user
        if u.photo:
            u.photo.delete(save=True)
            record("Photo de profil retirée", u.username, request=request)
        return Response(UserSerializer(u, context={"request": request}).data)


class PasswordView(APIView):
    @extend_schema(request=PasswordChangeSerializer, responses={204: None})
    def post(self, request):
        if settings.DEMO_INSTANCE:
            return Response(DEMO_PW, status=403)
        s = PasswordChangeSerializer(data=request.data, context={"request": request})
        s.is_valid(raise_exception=True)
        u = request.user
        u.set_password(s.validated_data["new"])
        u.must_change_password = False
        u.save(update_fields=["password", "must_change_password"])
        record("Mot de passe modifié", u.username, request=request)
        if u.is_platform_admin:
            plog(request, "Mot de passe modifié", u.username)
        return Response(status=status.HTTP_204_NO_CONTENT)


PROTECTED_ROLES = ("directeur", "fondateur")


def may_manage(actor, target_role: str) -> bool:
    """Le service informatique gère les comptes mais jamais ceux de la direction ni du fondateur."""
    return actor.role != "informatique" or target_role not in PROTECTED_ROLES


def pick_role(d):
    """(type de rôle, rôle de l'école) demandé pour un compte du personnel, ou une réponse d'erreur."""
    from .models import Role
    if d.get("role_id"):
        r = Role.objects.exclude(base__in=("parent", "eleve")).filter(pk=d["role_id"]).first()
        if r is None:
            return None, field_error({"role_id": ["Ce rôle n’existe pas dans votre école."]})
        return (r.base, r), None
    r = Role.objects.filter(key=d["role"]).first()
    if r is None and Role.objects.exists():
        return None, field_error({"role": ["Ce rôle n’existe plus dans votre école."]})
    return (d["role"], r), None


def is_manager(user) -> bool:
    from apps.core.permissions import perms_for
    return "roles.manage" in perms_for(user)


DENIED = {"detail": "Les comptes de la direction et du fondateur ne sont pas gérés par le service informatique."}
DEMO_PW = {"detail": "Démonstration : les comptes et leurs mots de passe ne se modifient pas (tout est remis à zéro chaque nuit)."}
OUT_OF_SCOPE = {"detail": "Ce compte concerne un cursus hors de votre périmètre : il est géré par la direction de ce cursus ou de l’école."}


# ---------- Gestion des comptes (secrétariat) ----------
class UserListCreateView(generics.ListCreateAPIView):
    """Liste des comptes (`?role=`, `?active=`, `?q=`) et création d'un compte du personnel."""

    permission_classes = [perm_required("accounts")]
    serializer_class = UserSerializer

    def get_queryset(self):
        from .perimetre import manageable
        qs = manageable(self.request.user, User.objects.select_related("role_ref").prefetch_related("cursus"))
        p = self.request.query_params
        if p.get("role"):
            qs = qs.filter(role=p["role"])
        if p.get("active") in ("0", "1"):
            qs = qs.filter(is_active=p["active"] == "1")
        q = p.get("q", "").strip()
        if q:
            qs = qs.filter(Q(full_name__icontains=q) | Q(username__icontains=q) | Q(phone__icontains=q))
        return qs

    @extend_schema(request=StaffCreateSerializer, responses={201: UserSerializer})
    def create(self, request, *args, **kwargs):
        s = StaffCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        picked, err = pick_role(d)
        if err:
            return err
        base, ref = picked
        if not may_manage(request.user, base):
            return Response(DENIED, status=403)
        from .perimetre import assign_error, default_cursus_for
        cursus = d["cursus"] if "cursus" in d and base != "enseignant" else default_cursus_for(base, request.user) if base != "enseignant" else []
        why = assign_error(request.user, cursus)
        if why:
            return Response({"cursus": [why]}, status=400)
        pwd = temp_password()
        user = User(username=d["username"], full_name=d["name"].strip(), role=base, role_ref=ref, phone=d.get("phone", ""),
                    email=d.get("email", ""), must_change_password=True, is_staff=False)
        user.set_password(pwd)
        user.save()
        user.cursus.set(cursus)
        record("Compte créé", f"{user.username} ({user.role_label})", request=request)
        sent = send_access(request, user, pwd, etab=user.etablissement)
        # Le mot de passe provisoire n'est montré qu'ici, une seule fois.
        return Response({"user": UserSerializer(user, context={"request": request}).data,
                        "credentials": {"username": user.username, "password": pwd}, "invitation": sent}, status=status.HTTP_201_CREATED)


@extend_schema(request={"multipart/form-data": {"type": "object", "properties": {"file": {"type": "string", "format": "binary"}}}}, responses={200: {"type": "object"}})
class StaffImportView(APIView):
    """Import de comptes du personnel (Excel ou CSV). Sans `?commit=1` : simple vérification. Mots de passe provisoires renvoyés une seule fois."""

    parser_classes = [MultiPartParser]
    permission_classes = [perm_required("accounts")]

    def post(self, request):
        from django.db import transaction
        from . import imports
        f = request.FILES.get("file")
        if not f:
            return Response({"file": "Joignez un fichier Excel (.xlsx) ou CSV."}, status=400)
        if f.size > 2_000_000:
            return Response({"file": "Fichier trop volumineux (2 Mo au maximum)."}, status=400)
        try:
            rows = imports.read(f.read())
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)
        valid, errors = imports.validate(rows)
        out = {"total": len(rows), "valid": len(valid), "errors": errors, "created": []}
        if request.query_params.get("commit") != "1":
            return Response(out)
        creds = []
        with transaction.atomic():
            for v in valid:
                pwd = temp_password()
                u = User(username=v["username"], full_name=v["nom"], role=v["role"], phone=v["phone"], email=v["email"], must_change_password=True, is_staff=False)
                u.set_password(pwd)
                u.save()
                if v["subjects"]:
                    u.teacher.subjects.set(v["subjects"])
                out["created"].append({"matricule": u.username, "name": u.full_name})
                creds.append({"role": u.role, "name": u.full_name, "username": u.username, "password": pwd, "email": u.email, "_u": u})
        record("Import de comptes", f"{f.name[:60]} : {len(out['created'])} créé(s), {len(errors)} erreur(s)", request=request)
        for c in creds:  # accès par e-mail pour ceux qui ont une adresse (hors transaction : un échec d'envoi ne défait rien)
            u = c.pop("_u")
            c["invitation"] = send_access(request, u, c["password"], etab=u.etablissement)
        out["credentials"] = creds
        return Response(out, status=201 if creds else 200)


@extend_schema(responses={(200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): {"type": "string", "format": "binary"}})
class StaffImportTemplateView(APIView):
    permission_classes = [perm_required("accounts")]

    def get(self, request):
        from django.http import HttpResponse
        from apps.academics.models import Subject
        from . import imports
        r = HttpResponse(imports.template([s.name for s in Subject.objects.all()]), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        r["Content-Disposition"] = 'attachment; filename="modele-import-personnel.xlsx"'
        return r


class UserDetailView(generics.RetrieveUpdateAPIView):
    permission_classes = [perm_required("accounts")]
    serializer_class = UserSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        return User.objects.select_related("role_ref")

    @extend_schema(request=UserAdminUpdateSerializer, responses=UserSerializer)
    def partial_update(self, request, *args, **kwargs):
        user = self.get_object()
        s = UserAdminUpdateSerializer(data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        picked = None
        if "role" in d or "role_id" in d:
            picked, err = pick_role(d)
            if err:
                return err
        if not may_manage(request.user, user.role) or not may_manage(request.user, picked[0] if picked else user.role):
            return Response(DENIED, status=403)
        from .perimetre import assign_error, may_manage_scope
        if not may_manage_scope(request.user, user):
            return Response(OUT_OF_SCOPE, status=403)
        if "cursus" in d:
            why = assign_error(request.user, d["cursus"])
            if why:
                return Response({"cursus": [why]}, status=400)
            if user.role in ("parent", "eleve", "enseignant"):
                return Response({"cursus": ["Le cursus d’un enseignant, d’un parent ou d’un élève découle de ses classes."]}, status=400)
            if user.pk == request.user.pk:
                return Response({"cursus": ["Vous ne pouvez pas changer votre propre périmètre."]}, status=400)
            user.cursus.set(d["cursus"])
        if picked:
            base, ref = picked
            if user.pk == request.user.pk:
                return Response({"detail": "Vous ne pouvez pas changer votre propre rôle."}, status=400)
            if user.role in ("parent", "eleve"):
                return Response({"detail": "Le rôle d’un parent ou d’un élève ne se modifie pas."}, status=400)
            from .rolesapi import NEED_MANAGER, another_manager_remains
            if user.is_active and is_manager(user) and not (ref and "roles.manage" in ref.perms) and not another_manager_remains(exclude_user=user.pk):
                return Response(NEED_MANAGER, status=400)
            user.role, user.role_ref = base, ref
        if "name" in d:
            user.full_name = d["name"].strip()
        if "email" in d:
            d["email"] = d["email"].strip().lower()
            if user.role in STAFF_ROLES:
                if not d["email"]:
                    return Response({"email": ["L’adresse e-mail est obligatoire pour le personnel."]}, status=400)
                if staff_email_taken(d["email"], exclude_pk=user.pk):
                    return Response({"email": ["Cette adresse e-mail est déjà utilisée par un autre compte du personnel."]}, status=400)
        for f in ("phone", "email"):
            if f in d:
                setattr(user, f, d[f])
        user.save()
        record("Compte modifié", user.username, request=request)
        return Response(UserSerializer(user, context={"request": request}).data)


class ResetPasswordView(APIView):
    permission_classes = [perm_required("accounts")]

    @extend_schema(request=None, responses={200: {"type": "object"}})
    def post(self, request, pk):
        if settings.DEMO_INSTANCE:
            return Response(DEMO_PW, status=403)
        user = generics.get_object_or_404(User, pk=pk)
        if not may_manage(request.user, user.role):
            return Response(DENIED, status=403)
        from .perimetre import may_manage_scope
        if not may_manage_scope(request.user, user):
            return Response(OUT_OF_SCOPE, status=403)
        pwd = temp_pin() if user.role in ("parent", "eleve") else temp_password()   # famille et élève : 6 chiffres, à changer à la première connexion
        user.set_password(pwd)
        user.must_change_password = True
        user.failed_attempts, user.locked_until = 0, None
        user.save()
        record("Mot de passe réinitialisé", user.username, request=request)
        sent = send_access(request, user, pwd, etab=user.etablissement, new=False) if user.role not in ("parent", "eleve") else None
        return Response({"credentials": {"username": user.username, "password": pwd}, "invitation": sent})


class ToggleActiveView(APIView):
    permission_classes = [perm_required("accounts")]

    @extend_schema(request=None, responses=UserSerializer)
    def post(self, request, pk):
        if settings.DEMO_INSTANCE:
            return Response(DEMO_PW, status=403)
        user = generics.get_object_or_404(User, pk=pk)
        if not may_manage(request.user, user.role):
            return Response(DENIED, status=403)
        from .perimetre import may_manage_scope
        if not may_manage_scope(request.user, user):
            return Response(OUT_OF_SCOPE, status=403)
        if user.pk == request.user.pk:
            return Response({"detail": "Vous ne pouvez pas désactiver votre propre compte."}, status=400)
        if user.is_active and is_manager(user):
            from .rolesapi import NEED_MANAGER, another_manager_remains
            if not another_manager_remains(exclude_user=user.pk):
                return Response(NEED_MANAGER, status=400)
        user.is_active = not user.is_active
        user.save(update_fields=["is_active"])
        record("Compte réactivé" if user.is_active else "Compte désactivé", user.username, request=request)
        return Response(UserSerializer(user, context={"request": request}).data)


# ---------- Mot de passe oublié (personnel) ----------
GENERIC_FORGOT = "Si un compte du personnel correspond à cette saisie et possède une adresse e-mail, un message vient d’être envoyé. Le lien est valable une heure."
MAX_MAILS_PER_HOUR = 3


def _mask(email: str) -> str:
    name, _, dom = email.partition("@")
    return f"{name[:1]}***@{dom}"


def _reset_link(request, etab, user) -> str:
    from django.conf import settings
    from django.contrib.auth.tokens import default_token_generator
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode
    base = settings.PUBLIC_BASE_URL or request.build_absolute_uri("/").rstrip("/")
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    return f"{base}/?ecole={etab.code}#reinitialiser/{uid}/{default_token_generator.make_token(user)}"


def _send_platform_reset_mail(request, user) -> None:
    from django.conf import settings
    from django.contrib.auth.tokens import default_token_generator
    from django.core.mail import send_mail
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode
    base = settings.PUBLIC_BASE_URL or request.build_absolute_uri("/").rstrip("/")
    link = f"{base}/plateforme.html#reinitialiser/{urlsafe_base64_encode(force_bytes(user.pk))}/{default_token_generator.make_token(user)}"
    body = (f"Bonjour {user.full_name},\n\nUne réinitialisation du mot de passe de votre compte d’administrateur de la plateforme a été demandée.\n\n"
            f"Pour choisir un nouveau mot de passe, ouvrez ce lien (valable une heure, utilisable une seule fois) :\n{link}\n\n"
            "Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe ne change pas.\n")
    send_mail("Réinitialisation de votre mot de passe – plateforme", body, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False)


def _send_reset_mail(request, etab, user) -> None:
    from django.conf import settings
    from django.core.mail import send_mail
    from apps.academics.models import SchoolSettings
    from apps.core.tenancy import tenant_context
    with tenant_context(etab):
        school = SchoolSettings.load().name
    body = (f"Bonjour {user.full_name},\n\n"
            f"Une réinitialisation du mot de passe de votre compte « {user.username} » a été demandée sur l’espace en ligne de {school}.\n\n"
            f"Pour choisir un nouveau mot de passe, ouvrez ce lien (valable une heure, utilisable une seule fois) :\n{_reset_link(request, etab, user)}\n\n"
            "Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe ne change pas.\n"
            "Pour toute difficulté, adressez-vous à l’administration de l’école.\n")
    send_mail(f"Réinitialisation de votre mot de passe – {school}", body, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False)


class ForgotPasswordView(APIView):
    """Demande de lien de réinitialisation. Réponse toujours identique : on ne révèle pas quels comptes existent."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "forgot"

    @extend_schema(request={"application/json": {"type": "object", "properties": {"identifier": {"type": "string"}, "ecole": {"type": "string"}}}},
                   responses={200: {"type": "object"}})
    def post(self, request):
        import logging
        from django.core.cache import cache
        if (bad := captcha_refused(request)):
            return bad
        ident = str(request.data.get("identifier", "")).strip()
        etab, err = resolve_school(str(request.data.get("ecole", "")))
        if err:
            return err
        if etab is None and ident:  # administrateur de la plateforme (code « plateforme »)
            for user in User.all_objects.filter(etablissement__isnull=True, is_superuser=True, is_active=True).exclude(email="").filter(
                    Q(username__iexact=ident) | Q(email__iexact=ident))[:3]:
                key = f"forgot:{user.pk}"
                n = cache.get(key, 0)
                if n >= MAX_MAILS_PER_HOUR:
                    continue
                cache.set(key, n + 1, 3600)
                try:
                    _send_platform_reset_mail(request, user)
                    plog(request, "Mot de passe oublié", f"{user.username} : lien envoyé à {_mask(user.email)}", user=user)
                except Exception:
                    logging.getLogger(__name__).exception("Envoi du lien de réinitialisation impossible")
                    plog(request, "E-mail non envoyé", f"{user.username} : envoi impossible", user=user)
        if etab is not None and ident:
            users = User.all_objects.filter(etablissement=etab, is_active=True, role__in=STAFF_ROLES).exclude(email="").filter(
                Q(username__iexact=ident) | Q(email__iexact=ident))
            for user in users[:3]:
                key = f"forgot:{user.pk}"
                n = cache.get(key, 0)
                if n >= MAX_MAILS_PER_HOUR:
                    continue
                cache.set(key, n + 1, 3600)
                try:
                    _send_reset_mail(request, etab, user)
                    record("Mot de passe oublié", f"{user.username} : lien envoyé à {_mask(user.email)}", user=user, request=request)
                except Exception:  # SMTP indisponible : l'utilisateur n'en saura rien, l'administration le voit au journal
                    logging.getLogger(__name__).exception("Envoi du lien de réinitialisation impossible")
                    record("E-mail non envoyé", f"{user.username} : réinitialisation demandée, envoi impossible", user=user, request=request)
        return Response({"detail": GENERIC_FORGOT})


class ResetPasswordConfirmView(APIView):
    """Choix d'un nouveau mot de passe avec le lien reçu par e-mail."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(request={"application/json": {"type": "object", "properties": {"ecole": {"type": "string"}, "uid": {"type": "string"}, "token": {"type": "string"}, "new": {"type": "string"}, "confirm": {"type": "string"}}}},
                   responses={200: {"type": "object"}})
    def post(self, request):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.http import urlsafe_base64_decode
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
        from .passwords import check_new_password
        from rest_framework.exceptions import ValidationError
        etab, err = resolve_school(str(request.data.get("ecole", "")))
        if err:
            return err
        bad = Response({"detail": "Ce lien n’est plus valable. Demandez-en un nouveau."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            pk = int(urlsafe_base64_decode(str(request.data.get("uid", ""))).decode())
        except (ValueError, TypeError, UnicodeDecodeError):
            return bad
        if etab is None:
            user = User.all_objects.filter(pk=pk, etablissement__isnull=True, is_superuser=True, is_active=True).first()
        else:
            user = User.all_objects.filter(pk=pk, etablissement=etab, is_active=True, role__in=STAFF_ROLES).first()
        if user is None or not default_token_generator.check_token(user, str(request.data.get("token", ""))):
            return bad
        new, confirm = str(request.data.get("new", "")), request.data.get("confirm")
        try:
            check_new_password(new, confirm if confirm is not None else new)
        except ValidationError as e:
            return Response(e.detail, status=400)
        user.set_password(new)
        user.must_change_password = False
        user.failed_attempts, user.locked_until = 0, None
        user.save()
        for t in OutstandingToken.objects.filter(user=user):  # les sessions ouvertes avant le changement sont coupées
            BlacklistedToken.objects.get_or_create(token=t)
        if etab is None:
            plog(request, "Mot de passe réinitialisé par e-mail", user.username, user=user)
        else:
            record("Mot de passe réinitialisé par e-mail", user.username, user=user, request=request)
        return Response({"detail": "Mot de passe modifié. Vous pouvez vous connecter."})


class TwoFactorView(APIView):
    """Double authentification de l'administrateur de la plateforme connecté : état, activation, désactivation."""

    def _guard(self, request):
        u = request.user
        if not (u.is_authenticated and u.is_platform_admin):
            return Response({"detail": "Réservé à l’administrateur de la plateforme."}, status=status.HTTP_403_FORBIDDEN)
        return None

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        if (r := self._guard(request)):
            return r
        d = TotpDevice.objects.filter(user=request.user, confirmed=True).first()
        return Response({"enabled": bool(d), "recovery_left": len(d.recovery) if d else 0})

    @extend_schema(request=None, responses={200: {"type": "object"}})
    def post(self, request):
        """Démarre l'activation : renvoie la clé à saisir dans l'application. Rien n'est actif tant que le code n'est pas confirmé."""
        if (r := self._guard(request)):
            return r
        if TotpDevice.objects.filter(user=request.user, confirmed=True).exists():
            return Response({"detail": "La double authentification est déjà active."}, status=status.HTTP_400_BAD_REQUEST)
        sec = totp_lib.new_secret()
        TotpDevice.objects.update_or_create(user=request.user, defaults={"secret": sec, "confirmed": False, "last_step": 0, "recovery": []})
        return Response({"secret": sec, "uri": totp_lib.uri(sec, request.user.username)})


class TwoFactorEnableView(APIView):
    @extend_schema(request={"application/json": {"type": "object", "properties": {"code": {"type": "string"}}}}, responses={200: {"type": "object"}})
    def post(self, request):
        u = request.user
        if not (u.is_authenticated and u.is_platform_admin):
            return Response({"detail": "Réservé à l’administrateur de la plateforme."}, status=status.HTTP_403_FORBIDDEN)
        dev = TotpDevice.objects.filter(user=u, confirmed=False).first()
        step = dev and totp_lib.verify(dev.secret, request.data.get("code", ""))
        if not step:
            return Response({"detail": "Code incorrect. Vérifiez l’heure de votre téléphone et réessayez."}, status=status.HTTP_400_BAD_REQUEST)
        codes = totp_lib.new_recovery_codes()
        dev.confirmed, dev.last_step, dev.recovery = True, step, [totp_lib.hash_code(c) for c in codes]
        dev.save()
        plog(request, "Double authentification activée", u.username, user=u)
        return Response({"enabled": True, "recovery_codes": codes})


class TwoFactorDisableView(APIView):
    @extend_schema(request={"application/json": {"type": "object", "properties": {"password": {"type": "string"}, "code": {"type": "string"}}}}, responses={200: {"type": "object"}})
    def post(self, request):
        u = request.user
        if not (u.is_authenticated and u.is_platform_admin):
            return Response({"detail": "Réservé à l’administrateur de la plateforme."}, status=status.HTTP_403_FORBIDDEN)
        dev = TotpDevice.objects.filter(user=u, confirmed=True).first()
        if not dev:
            return Response({"enabled": False})
        if not u.check_password(request.data.get("password", "")) or not dev.verifier(request.data.get("code", "")):
            plog(request, "Connexion refusée", f"{u.username} : désactivation de la double authentification refusée", user=u)
            return Response({"detail": "Mot de passe ou code incorrect."}, status=status.HTTP_400_BAD_REQUEST)
        dev.delete()
        plog(request, "Double authentification désactivée", u.username, user=u)
        return Response({"enabled": False})
