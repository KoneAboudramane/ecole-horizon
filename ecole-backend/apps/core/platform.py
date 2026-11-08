from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Max, Q, Sum
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import Cursus, bootstrap_cursus, cursus_usage
from apps.accounts.models import User
from apps.students.models import Student

from . import abonnement
from .log import plog
from .models import AbonnementPaiement, AbonnementTranche, Etablissement, PlatformLog, PlatformSettings
from .schools import SchoolError, create_school


class IsPlatformAdmin(BasePermission):
    message = "Réservé à l’administrateur de la plateforme."

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.is_active and u.is_platform_admin)


class SchoolInSerializer(serializers.Serializer):
    code = serializers.SlugField(max_length=20)
    nom = serializers.CharField(max_length=120)
    prefixe = serializers.CharField(max_length=4, required=False, allow_blank=True)
    director = serializers.CharField(max_length=150)
    founder = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    secretary = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    director_email = serializers.EmailField(required=False, allow_blank=True, default="")
    founder_email = serializers.EmailField(required=False, allow_blank=True, default="")
    secretary_email = serializers.EmailField(required=False, allow_blank=True, default="")
    informatique = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    informatique_email = serializers.EmailField(required=False, allow_blank=True, default="")
    address = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    email = serializers.EmailField()  # adresse de contact de l'école : obligatoire
    abonnement_fin = serializers.DateField(required=False, allow_null=True, default=None)


    def validate(self, d):
        # Le mot de passe oublié passe par l'e-mail : obligatoire pour la direction, et pour chaque personne ajoutée.
        errors = {}
        if not d["email"].strip():
            errors["email"] = ["L’e-mail de l’école est obligatoire."]
        if not d["director_email"].strip():
            errors["director_email"] = ["L’e-mail du directeur est obligatoire (mot de passe oublié)."]
        for name, mail, label in (("founder", "founder_email", "du fondateur"), ("secretary", "secretary_email", "du secrétariat"), ("informatique", "informatique_email", "de l’informatique")):
            if d[name].strip() and not d[mail].strip():
                errors[mail] = [f"Indiquez l’e-mail {label} (mot de passe oublié)."]
            if d[mail].strip() and not d[name].strip():
                errors[name] = [f"Indiquez le nom {label.replace('du ', 'du ').replace('de l’', 'de l’')}."]
        if errors:
            raise serializers.ValidationError(errors)
        return d


class DirectionEmailSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PlatformAdminInSerializer(serializers.Serializer):
    username = serializers.SlugField(max_length=150)
    name = serializers.CharField(max_length=150)
    email = serializers.EmailField()


class SchoolPatchSerializer(serializers.Serializer):
    nom = serializers.CharField(max_length=120, required=False)
    prefixe = serializers.CharField(max_length=4, required=False)
    actif = serializers.BooleanField(required=False)
    abonnement_fin = serializers.DateField(required=False, allow_null=True)


class AbonnementSettingsSerializer(serializers.Serializer):
    tarif_inscription = serializers.IntegerField(min_value=0, max_value=100_000_000, required=False)
    tarif_inscription_multi = serializers.IntegerField(min_value=0, max_value=100_000_000, required=False)
    tarif_renouvellement = serializers.IntegerField(min_value=0, max_value=100_000_000, required=False)
    tarif_renouvellement_multi = serializers.IntegerField(min_value=0, max_value=100_000_000, required=False)
    grace_jours = serializers.IntegerField(min_value=0, max_value=90, required=False)
    rappel_jours = serializers.IntegerField(min_value=0, max_value=180, required=False)
    fin_annee = serializers.CharField(max_length=5, required=False)
    inscription_tranches = serializers.IntegerField(min_value=1, max_value=abonnement.TRANCHES_MAX, required=False)
    inscription_ecart_mois = serializers.IntegerField(min_value=1, max_value=12, required=False)
    renouvellement_dates = serializers.CharField(max_length=120, required=False)
    arrondi = serializers.IntegerField(min_value=0, max_value=1_000_000, required=False)
    recu_signature = serializers.CharField(max_length=700_000, required=False, allow_blank=True)
    recu_cachet = serializers.CharField(max_length=700_000, required=False, allow_blank=True)
    recu_adresse = serializers.CharField(max_length=160, required=False, allow_blank=True)
    recu_mentions = serializers.CharField(max_length=200, required=False, allow_blank=True)
    recu_ville = serializers.CharField(max_length=60, required=False, allow_blank=True)

    def _image(self, v):
        if v and not v.startswith(("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,")):
            raise serializers.ValidationError("Image PNG, JPEG ou WebP attendue.")
        return v

    def validate_recu_signature(self, v):
        return self._image(v)

    def validate_recu_cachet(self, v):
        return self._image(v)

    def validate_fin_annee(self, v):
        try:
            j, m = abonnement.jour_mois(v)
        except abonnement.EcheancierInvalide as e:
            raise serializers.ValidationError(str(e)) from None
        return f"{j:02d}/{m:02d}"

    def validate_renouvellement_dates(self, v):
        try:
            jms = [abonnement.jour_mois(t) for t in v.split(",") if t.strip()]
        except abonnement.EcheancierInvalide as e:
            raise serializers.ValidationError(str(e)) from None
        if not 1 <= len(jms) <= abonnement.TRANCHES_MAX:
            raise serializers.ValidationError(f"Indiquez entre 1 et {abonnement.TRANCHES_MAX} dates.")
        return ", ".join(f"{j:02d}/{m:02d}" for j, m in jms)


class TrancheInSerializer(serializers.Serializer):
    echeance = serializers.DateField()
    montant = serializers.IntegerField(min_value=0, max_value=100_000_000)


class PaiementInSerializer(serializers.Serializer):
    montant = serializers.IntegerField(min_value=0, max_value=100_000_000, required=False)
    # Seulement quand aucune tranche n'est en attente : la période à ouvrir et son échéancier (fixé par l'administrateur,
    # sinon celui proposé par les réglages, en `tranches` tranches).
    nature = serializers.ChoiceField(choices=[n for n, _ in AbonnementTranche.NATURES], required=False)
    tranches = serializers.IntegerField(min_value=1, max_value=abonnement.TRANCHES_MAX, required=False, default=1)
    echeancier = TrancheInSerializer(many=True, required=False)
    mode = serializers.ChoiceField(choices=[m for m, _ in AbonnementPaiement.MODES], default="especes")
    reference = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    date = serializers.DateField(required=False)

    # N° de transaction : obligatoire quand le paiement en laisse une trace (mobile money, virement, chèque), et jamais deux fois
    # le même pour un mode donné, pour ne pas compter un paiement en double.
    REFERENCE_OBLIGATOIRE = {"mobile": "le numéro de transaction mobile money", "virement": "la référence du virement", "cheque": "le numéro du chèque"}

    def validate(self, d):
        d["reference"] = d["reference"].strip()
        quoi = self.REFERENCE_OBLIGATOIRE.get(d["mode"])
        if quoi and not d["reference"]:
            raise serializers.ValidationError({"reference": [f"Indiquez {quoi}."]})
        if d["reference"]:
            deja = AbonnementPaiement.objects.select_related("etablissement").filter(mode=d["mode"], reference__iexact=d["reference"]).first()
            if deja:
                raise serializers.ValidationError({"reference": [f"Ce numéro est déjà enregistré : paiement du {deja.date:%d/%m/%Y} "
                                                                 f"({deja.montant:,} FCFA, {deja.etablissement.nom}).".replace(",", " ")]})
        return d


def _row(e: Etablissement, students=0, accounts=0) -> dict:
    return {"id": e.pk, "code": e.code, "nom": e.nom, "prefixe": e.prefixe, "actif": e.actif, "created": e.created,
            "eleves": students, "comptes": accounts,
            "abonnement_fin": e.abonnement_fin, "abonnement_etat": e.abonnement_etat, "abonnement_jours": e.abonnement_jours}


def _settings_dict() -> dict:
    c = PlatformSettings.load()
    return {"tarif_inscription": c.tarif_inscription, "tarif_inscription_multi": c.tarif_inscription_multi, "tarif_renouvellement": c.tarif_renouvellement,
            "tarif_renouvellement_multi": c.tarif_renouvellement_multi, "grace_jours": c.grace_jours, "rappel_jours": c.rappel_jours,
            "fin_annee": c.fin_annee, "inscription_tranches": c.inscription_tranches, "inscription_ecart_mois": c.inscription_ecart_mois,
            "renouvellement_dates": c.renouvellement_dates, "arrondi": c.arrondi, "recu_signature": c.recu_signature, "recu_cachet": c.recu_cachet,
            "recu_adresse": c.recu_adresse, "recu_mentions": c.recu_mentions, "recu_ville": c.recu_ville}


def _rows():
    students = dict(Student.all_objects.filter(active=True, principal__isnull=True).values_list("etablissement").annotate(n=Count("id")))
    accounts = dict(User.all_objects.filter(etablissement__isnull=False).values_list("etablissement").annotate(n=Count("id")))
    return [_row(e, students.get(e.pk, 0), accounts.get(e.pk, 0)) for e in Etablissement.objects.all()]


class SchoolsView(APIView):
    """Établissements de la plateforme : liste (GET) et création d'une école avec ses comptes de direction (POST)."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=inline_serializer("SchoolRow", {"id": serializers.IntegerField(), "code": serializers.CharField(), "nom": serializers.CharField(), "prefixe": serializers.CharField(), "actif": serializers.BooleanField(), "eleves": serializers.IntegerField(), "comptes": serializers.IntegerField()}, many=True))
    def get(self, request):
        return Response(_rows())

    @extend_schema(request=SchoolInSerializer, responses={201: inline_serializer("SchoolCreated", {"id": serializers.IntegerField(), "comptes_crees": serializers.ListField()})})
    def post(self, request):
        s = SchoolInSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        try:
            etab, creds = create_school(code=d["code"], nom=d["nom"], prefixe=d.get("prefixe", ""), director=d["director"], founder=d["founder"], secretary=d["secretary"],
                                    director_email=d["director_email"], founder_email=d["founder_email"], secretary_email=d["secretary_email"],
                                    it=d["informatique"], it_email=d["informatique_email"], address=d["address"], phone=d["phone"], email=d["email"])
        except SchoolError as e:
            return Response({"code": [str(e)]}, status=status.HTTP_400_BAD_REQUEST)
        if d.get("abonnement_fin"):
            etab.abonnement_fin = d["abonnement_fin"]
            etab.save(update_fields=["abonnement_fin"])
        plog(request, "École créée", f"{etab.nom} ({etab.code})", etab=etab)
        from apps.accounts.invite import send_access
        for c in creds:
            u = User.all_objects.filter(etablissement=etab, username=c["username"]).first()
            c["invitation"] = send_access(request, u, c["password"], etab=etab) if u else None
            c["email"] = u.email if u else ""
        seen: dict[str, list[str]] = {}
        for c in creds:
            if c["email"]:
                seen.setdefault(c["email"].lower(), []).append(c["username"])
        warnings = [f"L’adresse {m} est utilisée par plusieurs comptes ({', '.join(u)}) : le « mot de passe oublié » enverra un lien pour chacun." for m, u in seen.items() if len(u) > 1]
        return Response({**_row(etab), "comptes_crees": creds, "avertissements": warnings}, status=status.HTTP_201_CREATED)


class SchoolDetailView(APIView):
    """Renommer une école, changer son préfixe de matricule, la suspendre ou la réactiver. Aucune suppression."""

    permission_classes = [IsPlatformAdmin]
    http_method_names = ["get", "patch", "head", "options"]  # jamais de suppression d'école

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request, pk):
        etab = Etablissement.objects.filter(pk=pk).first()
        if etab is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(_fiche(etab))

    @extend_schema(request=SchoolPatchSerializer, responses=inline_serializer("SchoolUpdated", {"id": serializers.IntegerField()}))
    def patch(self, request, pk):
        etab = Etablissement.objects.filter(pk=pk).first()
        if etab is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        s = SchoolPatchSerializer(data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        before = {k: getattr(etab, k) for k in s.validated_data}
        for k, v in s.validated_data.items():
            setattr(etab, k, v.upper() if k == "prefixe" else v)
        etab.save()
        if "abonnement_fin" in s.validated_data and before["abonnement_fin"] != etab.abonnement_fin:
            plog(request, "Échéance modifiée", f"{etab.code} : {before['abonnement_fin'] or 'sans échéance'} → {etab.abonnement_fin or 'sans échéance'}", etab=etab)
            if len(before) == 1:
                return Response(_row(etab))
            before.pop("abonnement_fin")
        if "actif" in s.validated_data and before["actif"] != etab.actif:
            plog(request, "École réactivée" if etab.actif else "École suspendue", f"{etab.nom} ({etab.code})", etab=etab)
        else:
            plog(request, "École modifiée", f"{etab.code} : " + ", ".join(f"{k} {before[k]} → {getattr(etab, k)}" for k in before), etab=etab)
        return Response(_row(etab))



# ---------- Tableau de bord, fiche école, comptes de direction, administrateurs, journal ----------
DIRECTION_ROLES = ("directeur", "fondateur", "admin")
INACTIVE_DAYS = 30


def _fiche(etab: Etablissement) -> dict:
    users = User.all_objects.filter(etablissement=etab)
    by_role = {r["role"]: r["n"] for r in users.values("role").annotate(n=Count("id"))}
    direction = [{"id": u.pk, "username": u.username, "name": u.full_name, "role": u.role, "email": u.email, "actif": u.is_active,
                  "last_login": u.last_login, "must_change_password": u.must_change_password, "locked": u.is_locked}
                 for u in users.filter(role__in=DIRECTION_ROLES).order_by("role", "full_name")]
    last = users.filter(role__in=DIRECTION_ROLES).aggregate(m=Max("last_login"))["m"]
    return {**_row(etab, Student.all_objects.filter(etablissement=etab, active=True, principal__isnull=True).count(), users.count()),
            "roles": by_role, "direction": direction, "last_direction_login": last, "cursus": _cursus_rows(etab),
            "paiements": [{"id": p.pk, "numero": p.numero, "date": p.date, "montant": p.montant, "mode": p.mode, "reference": p.reference,
                           "fin_avant": p.fin_avant, "fin_apres": p.fin_apres, "par": p.par.full_name if p.par else ""}
                          for p in etab.paiements_abonnement.select_related("par")[:20]],
            **_echeancier(etab)}


def _echeancier(etab: Etablissement) -> dict:
    """Tranches en attente et celles de la dernière période ; sans tranche en attente, de quoi proposer la période suivante."""
    tranches = list(etab.tranches.all())
    derniere = max((t.periode_fin for t in tranches), default=None)
    attente = [t for t in tranches if t.reste > 0]
    cfg = PlatformSettings.load()
    return {"multi_cursus": etab.multi_cursus,
            "echeancier": [{"id": t.pk, "nature": t.nature, "numero": t.numero, "nombre": t.nombre, "echeance": t.echeance, "montant": t.montant,
                            "regle": t.regle, "reste": t.reste, "periode_fin": t.periode_fin} for t in tranches if t.reste > 0 or t.periode_fin == derniere],
            "reste_du": sum(t.reste for t in attente),
            "prochaine_nature": None if attente else abonnement.prochaine_nature(etab),
            "tarifs": {n: cfg.tarif(n, etab.multi_cursus) for n in abonnement.NATURES},
            "tranches_proposees": {n: abonnement.nombre_propose(n, cfg) for n in abonnement.NATURES},
            "echeance_calculee": abonnement.echeance_calculee(etab), "grace_jours": cfg.grace_jours, "rappel_jours": cfg.rappel_jours}


class StatsView(APIView):
    """Tableau de bord de la plateforme."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        schools = list(Etablissement.objects.all())
        last = {r["etablissement"]: r["m"] for r in User.all_objects.filter(role__in=DIRECTION_ROLES).values("etablissement").annotate(m=Max("last_login"))}
        limit = timezone.now() - timedelta(days=INACTIVE_DAYS)
        dormant = [{"id": e.pk, "nom": e.nom, "code": e.code, "last_login": last.get(e.pk)} for e in schools
                   if e.actif and (last.get(e.pk) is None or last[e.pk] < limit)]
        return Response({
            "ecoles": len(schools), "actives": sum(e.actif for e in schools), "suspendues": sum(not e.actif for e in schools),
            "eleves": Student.all_objects.filter(active=True, etablissement__actif=True).count(),
            "comptes": User.all_objects.filter(etablissement__isnull=False, etablissement__actif=True).count(),
            "inactives": dormant, "inactive_days": INACTIVE_DAYS,
            "abonnements_a_suivre": [{"id": e.pk, "nom": e.nom, "code": e.code, "etat": e.abonnement_etat, "fin": e.abonnement_fin, "jours": e.abonnement_jours}
                                     for e in schools if e.actif and e.abonnement_etat in ("bientot", "grace", "echu")],
            "recentes": [{"id": e.pk, "nom": e.nom, "code": e.code, "created": e.created} for e in sorted(schools, key=lambda e: e.created, reverse=True)[:5]],
        })


def _direction_account(pk, uid):
    etab = Etablissement.objects.filter(pk=pk).first()
    user = User.all_objects.filter(pk=uid, etablissement=etab, role__in=DIRECTION_ROLES).first() if etab else None
    return etab, user


class DirectionAccountView(APIView):
    """Corriger l'e-mail d'un compte de direction (directeur, fondateur, secrétariat). Aucune suppression."""

    permission_classes = [IsPlatformAdmin]
    http_method_names = ["patch", "options"]

    @extend_schema(request=DirectionEmailSerializer, responses={200: {"type": "object"}})
    def patch(self, request, pk, uid):
        etab, user = _direction_account(pk, uid)
        if user is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        s = DirectionEmailSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        email = s.validated_data["email"].strip().lower()
        if User.all_objects.filter(etablissement=etab, email__iexact=email).exclude(pk=user.pk).exists():
            return Response({"email": ["Cette adresse est déjà utilisée par un autre compte de cette école."]}, status=400)
        user.email = email
        user.save(update_fields=["email"])
        plog(request, "E-mail corrigé", f"{etab.code} / {user.username}", etab=etab)
        return Response(_fiche(etab))


class DirectionResetView(APIView):
    """Nouveau mot de passe provisoire pour un compte de direction (affiché une seule fois). Coupe les sessions ouvertes."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(request=None, responses={200: {"type": "object"}})
    def post(self, request, pk, uid):
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

        from apps.accounts.passwords import temp_password
        etab, user = _direction_account(pk, uid)
        if user is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        pwd = temp_password(10)
        user.set_password(pwd)
        user.must_change_password = True
        user.failed_attempts, user.locked_until = 0, None
        user.save()
        for t in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=t)
        plog(request, "Mot de passe réinitialisé", f"{etab.code} / {user.username}", etab=etab)
        from apps.accounts.invite import send_access
        return Response({"invitation": send_access(request, user, pwd, etab=etab, new=False), "email": user.email,
                         "credentials": {"username": user.username, "name": user.full_name, "password": pwd, "ecole": etab.code}})


class DirectionToggleView(APIView):
    """Désactiver ou réactiver un compte de direction (jamais de suppression)."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(request=None, responses={200: {"type": "object"}})
    def post(self, request, pk, uid):
        etab, user = _direction_account(pk, uid)
        if user is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        user.is_active = not user.is_active
        user.save(update_fields=["is_active"])
        plog(request, "Compte réactivé" if user.is_active else "Compte désactivé", f"{etab.code} / {user.username}", etab=etab)
        return Response(_fiche(etab))


def _admin_qs():
    return User.all_objects.filter(etablissement__isnull=True, is_superuser=True)


def _admin_row(u, request):
    return {"id": u.pk, "username": u.username, "name": u.full_name, "email": u.email, "phone": u.phone,
            "photo": request.build_absolute_uri(u.photo.url) if u.photo else None,
            "actif": u.is_active, "last_login": u.last_login, "must_change_password": u.must_change_password,
            "owner": u.platform_owner, "pending": u.platform_pending, "invited_by": u.invited_by.full_name if u.invited_by_id else "",
            "is_me": u.pk == request.user.pk, "twofa": hasattr(u, "totp") and u.totp.confirmed}


class IsPlatformOwner(IsPlatformAdmin):
    message = "Réservé à l’administrateur principal de la plateforme."

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.platform_owner


class PlatformAdminsView(APIView):
    """Administrateurs de la plateforme : liste et ajout.

    Le principal ajoute directement (compte actif, mot de passe provisoire affiché une fois). Un autre administrateur ne fait
    qu'inviter : le compte reste en attente jusqu'à la validation du principal. Personne n'est supprimé d'ici."""

    permission_classes = [IsPlatformAdmin]
    http_method_names = ["get", "post", "head", "options"]

    @extend_schema(responses={200: {"type": "array", "items": {"type": "object"}}})
    def get(self, request):
        rows = _admin_qs().select_related("invited_by", "totp").order_by("-platform_owner", "platform_pending", "full_name")
        return Response([_admin_row(u, request) for u in rows])

    @extend_schema(request=PlatformAdminInSerializer, responses={201: {"type": "object"}})
    def post(self, request):
        from apps.accounts.passwords import temp_password
        s = PlatformAdminInSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        username, email = d["username"].strip().lower(), d["email"].strip().lower()
        admins = User.all_objects.filter(etablissement__isnull=True)
        if admins.filter(username__iexact=username).exists():
            return Response({"username": ["Cet identifiant existe déjà."]}, status=400)
        if admins.filter(email__iexact=email).exists():
            return Response({"email": ["Cette adresse est déjà utilisée par un administrateur."]}, status=400)
        owner = request.user.platform_owner
        u = User(username=username, full_name=d["name"].strip(), email=email, role="", is_superuser=True, is_staff=True,
                 must_change_password=True, invited_by=request.user, is_active=owner, platform_pending=not owner)
        if owner:
            pwd = temp_password(12)
            u.set_password(pwd)
        else:
            u.set_unusable_password()  # le mot de passe est créé à la validation par l'administrateur principal
        u.save()
        if not owner:
            plog(request, "Administrateur proposé", f"{username} (en attente de validation)")
            return Response({"id": u.pk, "pending": True}, status=status.HTTP_201_CREATED)
        plog(request, "Administrateur créé", f"{username}")
        from apps.accounts.invite import send_access
        return Response({"id": u.pk, "pending": False, "invitation": send_access(request, u, pwd), "email": u.email,
                         "credentials": {"username": username, "name": u.full_name, "password": pwd}}, status=status.HTTP_201_CREATED)


class PlatformAdminActionView(APIView):
    """Actions de l'administrateur principal sur un autre administrateur : valider, refuser, activer/désactiver, mot de passe, double authentification."""

    permission_classes = [IsPlatformOwner]
    http_method_names = ["post", "options"]
    action = ""

    @extend_schema(request=None, responses={200: {"type": "object"}})
    def post(self, request, pk):
        from apps.accounts.models import TotpDevice
        from apps.accounts.passwords import temp_password
        u = _admin_qs().filter(pk=pk).first()
        if u is None:
            return Response({"detail": "Administrateur introuvable."}, status=404)
        a = self.action
        if u.pk == request.user.pk:
            return Response({"detail": "Cette action ne s’applique pas à votre propre compte."}, status=400)
        if u.platform_owner:
            return Response({"detail": "L’administrateur principal ne se gère que depuis l’administration Django."}, status=400)
        if a in ("valider", "refuser") and not u.platform_pending:
            return Response({"detail": "Cette invitation n’est plus en attente."}, status=400)
        if a not in ("valider", "refuser") and u.platform_pending:
            return Response({"detail": "Validez ou refusez d’abord l’invitation."}, status=400)
        if a == "valider":
            pwd = temp_password(12)
            u.set_password(pwd)
            u.is_active, u.platform_pending, u.must_change_password = True, False, True
            u.save()
            plog(request, "Administrateur validé", u.username)
            from apps.accounts.invite import send_access
            return Response({"invitation": send_access(request, u, pwd), "email": u.email, "credentials": {"username": u.username, "name": u.full_name, "password": pwd}})
        if a == "refuser":
            name = u.username
            u.delete()
            plog(request, "Invitation refusée", name)
            return Response({"ok": True})
        if a == "basculer":
            u.is_active = not u.is_active
            u.save(update_fields=["is_active"])
            plog(request, "Administrateur réactivé" if u.is_active else "Administrateur désactivé", u.username)
            return Response({"actif": u.is_active})
        if a == "reinitialiser":
            pwd = temp_password(12)
            u.set_password(pwd)
            u.must_change_password, u.failed_attempts, u.locked_until = True, 0, None
            u.save()
            plog(request, "Mot de passe d’administrateur réinitialisé", u.username)
            from apps.accounts.invite import send_access
            return Response({"invitation": send_access(request, u, pwd, new=False), "email": u.email, "credentials": {"username": u.username, "name": u.full_name, "password": pwd}})
        if a == "retirer-2fa":
            if TotpDevice.objects.filter(user=u).delete()[0]:
                plog(request, "Double authentification retirée", u.username)
            return Response({"ok": True})
        return Response(status=404)


class PlatformJournalView(APIView):
    """Journal de la plateforme, du plus récent au plus ancien. Filtres : `?q=` (texte), `?action=` (type) ; pagination `?offset=&limit=` (50 par défaut, 200 au plus)."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        qs = PlatformLog.objects.select_related("user", "etablissement")
        q = request.query_params.get("q", "").strip()
        if q:
            qs = qs.filter(Q(action__icontains=q) | Q(detail__icontains=q) | Q(user__full_name__icontains=q) | Q(etablissement__nom__icontains=q))
        action = request.query_params.get("action", "").strip()
        if action:
            qs = qs.filter(action=action)
        try:
            offset = max(0, int(request.query_params.get("offset", 0)))
            limit = min(200, max(1, int(request.query_params.get("limit", 50))))
        except ValueError:
            offset, limit = 0, 50
        total = qs.count()
        return Response({"total": total, "actions": sorted(PlatformLog.objects.order_by().values_list("action", flat=True).distinct()),
                         "results": [{"ts": e.ts, "action": e.action, "detail": e.detail, "user": e.user.full_name if e.user else "",
                                      "ecole": e.etablissement.nom if e.etablissement else "", "ip": e.ip} for e in qs[offset:offset + limit]]})


class StatisticsView(APIView):
    """Statistiques de l'administration de la plateforme, et rien de plus : ses actions, les écoles qu'elle gère, les comptes de
    direction qu'elle doit suivre et la sécurité de son accès. Seul chiffre scolaire : le nombre d'élèves inscrits (agrégé, sans détail).

    `?jours=7|30|90` règle la période des actions ; la courbe des écoles couvre les 12 derniers mois."""

    permission_classes = [IsPlatformAdmin]
    LOGIN = ("Connexion", "Connexion refusée", "Connexion bloquée")
    DENIED = ("Connexion refusée", "Connexion bloquée")

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        from django.db.models.functions import TruncDate, TruncMonth
        try:
            jours = int(request.query_params.get("jours", 30))
        except ValueError:
            jours = 30
        jours = jours if jours in (7, 30, 90) else 30
        today = timezone.localdate()
        start = today - timedelta(days=jours - 1)
        logs = PlatformLog.objects.filter(ts__date__gte=start)
        days = [start + timedelta(days=i) for i in range(jours)]

        def per_day(qs):
            got = {r["d"]: r["n"] for r in qs.annotate(d=TruncDate("ts")).values("d").annotate(n=Count("id"))}
            return [{"date": d.isoformat(), "n": got.get(d, 0)} for d in days]
        actions = logs.exclude(action__in=self.LOGIN)
        by_type = [{"action": r["action"], "n": r["n"]} for r in actions.order_by().values("action").annotate(n=Count("id")).order_by("-n")[:10]]
        refused = logs.filter(action__in=self.DENIED)

        y, m, months = today.year, today.month, []
        for _ in range(12):
            months.append((y, m))
            m -= 1
            if m == 0:
                y, m = y - 1, 12
        months.reverse()
        first = f"{months[0][0]}-{months[0][1]:02d}-01"
        got = {(r["m"].year, r["m"].month): r["n"] for r in Etablissement.objects.filter(created__date__gte=first).annotate(m=TruncMonth("created")).values("m").annotate(n=Count("id"))}
        cum, ecoles = Etablissement.objects.filter(created__date__lt=first).count(), []
        for y, m in months:
            cum += got.get((y, m), 0)
            ecoles.append({"mois": f"{y}-{m:02d}", "nouvelles": got.get((y, m), 0), "cumul": cum})

        direction = User.all_objects.filter(role__in=DIRECTION_ROLES, etablissement__isnull=False)
        now = timezone.now()
        a_traiter = [
            {"key": "provisoire", "label": "Jamais connectés (mot de passe provisoire)", "n": direction.filter(is_active=True, last_login__isnull=True, must_change_password=True).count()},
            {"key": "sans_email", "label": "Sans e-mail (mot de passe oublié impossible)", "n": direction.filter(is_active=True, email="").count()},
            {"key": "verrouilles", "label": "Verrouillés (trop d’essais)", "n": direction.filter(locked_until__gt=now).count()},
            {"key": "desactives", "label": "Désactivés", "n": direction.filter(is_active=False).count()},
        ]
        etats = {k: 0 for k in ("sans_echeance", "actif", "bientot", "grace", "echu")}
        for e in Etablissement.objects.filter(actif=True):
            etats[e.abonnement_etat] += 1
        pays = AbonnementPaiement.objects.filter(date__gte=start)
        paiements = {"n": pays.count(), "total": pays.aggregate(t=Sum("montant"))["t"] or 0}
        return Response({
            "jours": jours, "actions": per_day(actions), "total_actions": actions.count(), "actions_par_type": by_type,
            "reinitialisations": logs.filter(action="Mot de passe réinitialisé").count(), "ecoles_creees": logs.filter(action="École créée").count(),
            "suspensions": logs.filter(action="École suspendue").count(), "refus": per_day(refused), "total_refus": refused.count(),
            "connexions_admin": logs.filter(action="Connexion").count(),
            "ecoles": ecoles, "ecoles_actives": Etablissement.objects.filter(actif=True).count(), "ecoles_suspendues": Etablissement.objects.filter(actif=False).count(),
            "comptes_direction": direction.count(), "a_traiter": a_traiter,
            "abonnements": etats, "paiements": paiements,
            "eleves": Student.all_objects.filter(active=True, etablissement__actif=True).count(),
            "eleves_par_ecole": [{"nom": e.nom, "n": n} for e, n in sorted(((e, Student.all_objects.filter(active=True, etablissement=e).count()) for e in Etablissement.objects.filter(actif=True)), key=lambda t: -t[1])[:10]],
        })


# ---------- Abonnement : tarifs communs, échéancier par école ----------
class AbonnementSettingsView(APIView):
    """Tarifs de l'abonnement (les mêmes pour toutes les écoles, selon leur nombre de cursus), délai de grâce et rappel."""

    permission_classes = [IsPlatformAdmin]
    http_method_names = ["get", "patch", "head", "options"]

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        return Response(_settings_dict())

    @extend_schema(request=AbonnementSettingsSerializer, responses={200: {"type": "object"}})
    def patch(self, request):
        s = AbonnementSettingsSerializer(data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        c = PlatformSettings.load()
        before = _settings_dict()
        for k, v in s.validated_data.items():
            setattr(c, k, v)
        c.save()
        after = _settings_dict()
        images = ("recu_signature", "recu_cachet")          # des images : on note le changement, pas leur contenu
        diff = ", ".join(f"{k} {'retirée' if not after[k] else 'modifiée'}" if k in images else f"{k} {before[k]} → {after[k]}"
                         for k in after if before[k] != after[k])
        if diff:
            plog(request, "Réglages d’abonnement modifiés", diff)
        return Response(after)


class SchoolPaymentView(APIView):
    """Enregistre un paiement d'abonnement : il règle les tranches de l'échéancier dans l'ordre et repousse l'échéance d'accès
    jusqu'à la prochaine tranche. Sans tranche en attente, il ouvre la période suivante. Un paiement ne se modifie ni ne se supprime."""

    permission_classes = [IsPlatformAdmin]
    http_method_names = ["post", "options"]

    @extend_schema(request=PaiementInSerializer, responses={201: {"type": "object"}})
    def post(self, request, pk):
        etab = Etablissement.objects.filter(pk=pk).first()
        if etab is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        s = PaiementInSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        today = timezone.localdate()
        jour = d.get("date") or today
        if jour > today:
            return Response({"date": ["La date ne peut pas être dans le futur."]}, status=status.HTTP_400_BAD_REQUEST)
        avant = etab.abonnement_fin
        attente = abonnement.impayees(etab)
        try:
            if "montant" in d:
                montant = d["montant"]
            elif attente:
                montant = attente[0].reste
            elif d.get("echeancier"):
                montant = d["echeancier"][0]["montant"]
            else:
                montant = abonnement.plan(etab, d.get("nature") or abonnement.prochaine_nature(etab), d["tranches"], jour)[0]["montant"]
            with transaction.atomic():
                detail = abonnement.encaisser(etab, montant, jour, d.get("nature"), d["tranches"], d.get("echeancier"))
                p = AbonnementPaiement.objects.create(etablissement=etab, date=jour, montant=montant, mode=d["mode"], reference=d["reference"],
                                                      numero=abonnement.numero_recu(jour.year), code_verif=abonnement.code_verification(), detail=detail,
                                                      fin_avant=avant, fin_apres=etab.abonnement_fin, par=request.user)
        except ValueError as e:
            return Response({"montant": [str(e)]}, status=status.HTTP_400_BAD_REQUEST)
        apres = etab.abonnement_fin
        plog(request, "Paiement d’abonnement enregistré", f"{etab.code} : reçu {p.numero}, {montant} FCFA ({d['mode']}), échéance {apres or 'sans échéance'}", etab=etab)
        return Response({**_fiche(etab), "paiement": {"id": p.pk, "numero": p.numero, "montant": p.montant}}, status=status.HTTP_201_CREATED)


def lien_verification(request, p: AbonnementPaiement) -> str:
    """Adresse de la page de vérification, imprimée dans le QR code du reçu.

    La page vit avec l'interface : son adresse publique (PUBLIC_BASE_URL), sinon celle d'où vient la demande (le portail, si elle
    est autorisée), sinon le serveur lui-même. Quand l'interface et l'API ne sont pas au même endroit (développement), le lien
    indique aussi l'API."""
    from django.conf import settings
    from urllib.parse import urlencode
    api = request.build_absolute_uri("/").rstrip("/")
    origine = request.META.get("HTTP_ORIGIN", "").rstrip("/")
    front = settings.PUBLIC_BASE_URL or (origine if origine in getattr(settings, "CORS_ALLOWED_ORIGINS", []) else "") or api
    q = {"c": p.code_verif}
    if not settings.PUBLIC_BASE_URL and front != api:
        q["api"] = api
    return f"{front}/verifier.html?{urlencode(q)}"


class PaymentReceiptView(APIView):
    """Reçu d'un paiement d'abonnement en PDF. `?duplicata=1` : réimpression, marquée « Duplicata » et tracée dans le journal."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses={(200, "application/pdf"): {"type": "string", "format": "binary"}})
    def get(self, request, pid):
        from django.http import HttpResponse

        from .recu_abonnement import build_recu_abonnement
        p = AbonnementPaiement.objects.select_related("etablissement", "par").filter(pk=pid).first()
        if p is None or not p.numero:
            return Response(status=status.HTTP_404_NOT_FOUND)
        duplicata = request.query_params.get("duplicata") == "1"
        if duplicata:
            plog(request, "Duplicata de reçu d’abonnement", f"{p.etablissement.code} : reçu {p.numero}", etab=p.etablissement)
        resp = HttpResponse(build_recu_abonnement(p, duplicata, lien_verification(request, p)), content_type="application/pdf")
        resp["Content-Disposition"] = f'inline; filename="recu-{p.numero}.pdf"'
        resp["Cache-Control"] = "private, no-store"
        return resp


class EcheanceInSerializer(serializers.Serializer):
    ACTIONS = [("delai", "Accorder un délai"), ("echeancier", "Revenir à l’échéancier"), ("sans", "Sans échéance")]
    action = serializers.ChoiceField(choices=ACTIONS)
    date = serializers.DateField(required=False)
    motif = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")

    def validate(self, d):
        d["motif"] = d["motif"].strip()
        if d["action"] == "delai" and not d.get("date"):
            raise serializers.ValidationError({"date": ["Indiquez la nouvelle échéance."]})
        if d["action"] != "echeancier" and not d["motif"]:
            raise serializers.ValidationError({"motif": ["Indiquez le motif : il est noté dans le journal."]})
        return d


class SchoolEcheanceView(APIView):
    """Échéance d'accès décidée à la main : délai accordé (avec motif), retour à l'échéancier, ou école sans échéance (exemptée).
    Un délai ne change pas l'échéancier : au paiement suivant, l'échéance repart de la prochaine tranche non soldée."""

    permission_classes = [IsPlatformAdmin]
    http_method_names = ["post", "options"]

    @extend_schema(request=EcheanceInSerializer, responses={200: {"type": "object"}})
    def post(self, request, pk):
        etab = Etablissement.objects.filter(pk=pk).first()
        if etab is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        s = EcheanceInSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        avant = etab.abonnement_fin
        if d["action"] == "echeancier":
            calc = abonnement.echeance_calculee(etab)
            if calc is None:
                return Response({"action": ["Cette école n’a pas encore d’échéancier : enregistrez d’abord un paiement."]}, status=status.HTTP_400_BAD_REQUEST)
            etab.abonnement_fin = calc
        else:
            etab.abonnement_fin = d.get("date") if d["action"] == "delai" else None
        etab.save(update_fields=["abonnement_fin"])
        label = dict(EcheanceInSerializer.ACTIONS)[d["action"]]
        def fr(v):
            return f"{v:%d/%m/%Y}" if v else "sans échéance"
        plog(request, "Échéance modifiée", f"{etab.code} : {label.lower()}, {fr(avant)} → {fr(etab.abonnement_fin)}" + (f" — motif : {d['motif']}" if d["motif"] else ""), etab=etab)
        return Response(_fiche(etab))


class PublicReceiptCheckView(APIView):
    """Vérification publique d'un reçu d'abonnement par son code (QR code ou saisie). Sans compte, limitée en nombre d'essais.
    Ne montre que ce qui est imprimé sur le reçu : numéro, date, école, montant, mode."""

    authentication_classes = []
    permission_classes = []
    throttle_scope = "verif"

    def get_throttles(self):
        from rest_framework.throttling import ScopedRateThrottle
        return [ScopedRateThrottle()]

    @extend_schema(responses={200: {"type": "object"}, 404: {"type": "object"}})
    def get(self, request):
        from apps.finance.receipt import words

        from .recu_abonnement import emetteur
        code = abonnement.normaliser_code(request.query_params.get("c", ""))
        p = AbonnementPaiement.objects.select_related("etablissement").filter(code_verif=code).first() if code else None
        numero = request.query_params.get("n", "").strip().upper()
        if p is None or (numero and numero != p.numero):
            return Response({"authentique": False, "detail": "Aucun reçu ne correspond à ce code. Vérifiez la saisie : un reçu sans code valide n’est pas authentique."},
                            status=status.HTTP_404_NOT_FOUND)
        return Response({"authentique": True, "numero": p.numero, "date": p.date, "montant": p.montant, "montant_lettres": f"{words(p.montant)} francs CFA",
                         "ecole": p.etablissement.nom, "mode": dict(AbonnementPaiement.MODES).get(p.mode, p.mode), "emetteur": emetteur(PlatformSettings.load())[0],
                         "enregistre_le": p.created})


class SchoolPlanView(APIView):
    """Échéancier proposé pour la prochaine période d'une école (`?nature=&tranches=&total=`), sans rien enregistrer :
    le formulaire de paiement s'en sert comme point de départ, l'administrateur ajuste ensuite chaque tranche."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request, pk):
        etab = Etablissement.objects.filter(pk=pk).first()
        if etab is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        q = request.query_params
        nature = q.get("nature") or abonnement.prochaine_nature(etab)
        try:
            tranches = int(q.get("tranches") or abonnement.nombre_propose(nature, PlatformSettings.load()))
            total = int(q["total"]) if q.get("total") else None
            if total is not None and not 0 <= total <= 100_000_000:
                raise ValueError
            t = abonnement.plan(etab, nature, tranches, timezone.localdate(), total)
        except ValueError as e:
            msg = str(e) if isinstance(e, abonnement.EcheancierInvalide) else "Paramètres invalides."
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"nature": nature, "periode_fin": t[0]["periode_fin"], "total": sum(x["montant"] for x in t),
                         "tranches": [{"echeance": x["echeance"], "montant": x["montant"]} for x in t]})


class TranchePatchSerializer(serializers.Serializer):
    echeance = serializers.DateField(required=False)
    montant = serializers.IntegerField(min_value=0, max_value=100_000_000, required=False)


class SchoolTrancheView(APIView):
    """Modifie la date ou le montant d'une tranche non soldée (accord avec l'école, report…). Aucune suppression : 0 annule la tranche."""

    permission_classes = [IsPlatformAdmin]
    http_method_names = ["patch", "options"]

    @extend_schema(request=TranchePatchSerializer, responses={200: {"type": "object"}})
    def patch(self, request, pk, tid):
        t = AbonnementTranche.objects.select_related("etablissement").filter(pk=tid, etablissement_id=pk).first()
        if t is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        s = TranchePatchSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        avant = f"{t.echeance:%d/%m/%Y}, {t.montant} FCFA"
        try:
            abonnement.modifier_tranche(t, s.validated_data.get("echeance"), s.validated_data.get("montant"))
        except abonnement.EcheancierInvalide as e:
            return Response({"montant": [str(e)]}, status=status.HTTP_400_BAD_REQUEST)
        etab = t.etablissement
        plog(request, "Tranche d’abonnement modifiée",
             f"{etab.code} : {t.get_nature_display()} {t.numero}/{t.nombre} : {avant} → {t.echeance:%d/%m/%Y}, {t.montant} FCFA", etab=etab)
        return Response(_fiche(etab))


# ---------- Cursus d'une école (français par défaut ; arabe ou autre ajouté à la demande de l'école) ----------
class CursusInSerializer(serializers.Serializer):
    nom = serializers.CharField(max_length=60)
    langue = serializers.ChoiceField(choices=Cursus.LANGUES)
    nom_ecole = serializers.CharField(max_length=120, required=False, allow_blank=True)


def _cursus_rows(etab: Etablissement) -> list[dict]:
    return [{"id": c.pk, "nom": c.nom, "langue": c.langue, "langue_label": c.get_langue_display(), "nom_ecole": c.nom_ecole,
             "donnees": cursus_usage(c)} for c in Cursus.all_objects.filter(etablissement=etab).order_by("ordre", "id")]


def _check_cursus_nom(etab, nom: str, exclude=None):
    qs = Cursus.all_objects.filter(etablissement=etab, nom__iexact=nom)
    if exclude is not None:
        qs = qs.exclude(pk=exclude.pk)
    if qs.exists():
        raise serializers.ValidationError({"nom": ["Cette école a déjà un cursus de ce nom."]})


class SchoolCursusView(APIView):
    """Cursus d'une école : liste (GET) et ajout (POST `{nom, langue, nom_ecole}`), à la demande de l'école."""

    permission_classes = [IsPlatformAdmin]

    def _etab(self, pk):
        etab = Etablissement.objects.filter(pk=pk).first()
        if etab is None:
            raise NotFound()
        return etab

    @extend_schema(responses={200: {"type": "array"}})
    def get(self, request, pk):
        return Response(_cursus_rows(self._etab(pk)))

    @extend_schema(request=CursusInSerializer, responses={201: {"type": "array"}})
    def post(self, request, pk):
        etab = self._etab(pk)
        s = CursusInSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        nom = d["nom"].strip()
        _check_cursus_nom(etab, nom)
        last = Cursus.all_objects.filter(etablissement=etab).aggregate(m=Max("ordre"))["m"] or 0
        c = Cursus.all_objects.create(etablissement=etab, nom=nom, langue=d["langue"], nom_ecole=d.get("nom_ecole", "").strip(), ordre=last + 1)
        bootstrap_cursus(c)
        plog(request, "Cursus ajouté", f"{etab.code} : {nom}", etab=etab)
        return Response(_cursus_rows(etab), status=status.HTTP_201_CREATED)


class SchoolCursusDetailView(APIView):
    """Modifier un cursus (PATCH : nom, langue du bulletin, nom de l'école dans cette langue) ou le retirer (POST `retirer/`) :
    seulement s'il est vide (aucune classe, aucun niveau…) et si l'école en garde au moins un."""

    permission_classes = [IsPlatformAdmin]
    http_method_names = ["patch", "post", "options"]
    action = "modifier"

    def _get(self, pk, cid):
        etab = Etablissement.objects.filter(pk=pk).first()
        c = Cursus.all_objects.filter(pk=cid, etablissement=etab).first() if etab else None
        if c is None:
            raise NotFound()
        return etab, c

    @extend_schema(request=CursusInSerializer, responses={200: {"type": "array"}})
    def patch(self, request, pk, cid):
        etab, c = self._get(pk, cid)
        s = CursusInSerializer(data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        if "nom" in d:
            d["nom"] = d["nom"].strip()
            _check_cursus_nom(etab, d["nom"], exclude=c)
        before = c.nom
        for k, v in d.items():
            setattr(c, k, v.strip() if isinstance(v, str) else v)
        c.save()
        plog(request, "Cursus modifié", f"{etab.code} : {before}" + (f" → {c.nom}" if c.nom != before else ""), etab=etab)
        return Response(_cursus_rows(etab))

    @extend_schema(request=None, responses={200: {"type": "array"}})
    def post(self, request, pk, cid):
        if self.action != "retirer":
            raise NotFound()
        etab, c = self._get(pk, cid)
        if Cursus.all_objects.filter(etablissement=etab).count() <= 1:
            return Response({"detail": "Une école garde toujours au moins un cursus."}, status=status.HTTP_400_BAD_REQUEST)
        if cursus_usage(c):
            return Response({"detail": f"Le cursus « {c.nom} » contient déjà des données (classes, niveaux…) : il ne peut pas être retiré."}, status=status.HTTP_400_BAD_REQUEST)
        c.delete()
        plog(request, "Cursus retiré", f"{etab.code} : {c.nom}", etab=etab)
        return Response(_cursus_rows(etab))
