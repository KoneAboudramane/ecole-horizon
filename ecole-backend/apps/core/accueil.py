"""Page d'accueil publique : commune à toutes les écoles de la plateforme, gérée par l'administrateur de la plateforme."""
import logging
import re
import threading
from io import BytesIO

from django.core.files.base import ContentFile
from django.core.mail import send_mail
from django.db import connection, transaction
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import permissions, serializers, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .log import plog
from .models import AccueilPhoto, DemandeDemo, PlatformSettings, VisiteJour, VisiteurJour
from .platform import IsPlatformAdmin

log = logging.getLogger(__name__)
MAX_BYTES = 8 * 1024 * 1024
SIZE = 1920


def photo_row(x: AccueilPhoto, request) -> dict:
    return {"id": x.pk, "url": request.build_absolute_uri(x.image.url), "caption": x.caption}


def platform_figures() -> dict:
    """Chiffres réels de la plateforme pour la page d'accueil (écoles actives seulement), recalculés au plus toutes les 10 minutes.
    Aucun nom : seulement des totaux."""
    from datetime import timedelta

    from django.core.cache import cache
    from django.utils import timezone

    def compute():
        from apps.accounts.models import User
        from apps.finance.models import Payment
        from apps.students.models import Student
        from .models import Etablissement
        since = timezone.now() - timedelta(days=30)
        return {"ecoles": Etablissement.objects.filter(actif=True).count(),
                "eleves": Student.all_objects.filter(active=True, principal__isnull=True, etablissement__actif=True).count(),
                "connectes": User.all_objects.filter(etablissement__actif=True, last_login__gte=since).count(),
                "paiements": Payment.all_objects.filter(status="confirme", etablissement__actif=True).count()}
    return cache.get_or_set("accueil-chiffres", compute, 600)


def visitor_figures() -> dict:
    """Fréquentation de la page d'accueil (visiteurs comptés une fois par jour), recalculée au plus chaque minute."""
    from datetime import timedelta

    from django.core.cache import cache
    from django.db.models import Sum
    from django.utils import timezone

    def compute():
        today = timezone.localdate()
        qs = VisiteJour.objects.all()
        return {"aujourdhui": qs.filter(day=today).aggregate(n=Sum("visiteurs"))["n"] or 0,
                "mois": qs.filter(day__gt=today - timedelta(days=30)).aggregate(n=Sum("visiteurs"))["n"] or 0,
                "total": qs.aggregate(n=Sum("visiteurs"))["n"] or 0}
    return cache.get_or_set("accueil-visiteurs", compute, 60)


def public_accueil(request) -> dict:
    c = PlatformSettings.load()
    prix = {"inscription": c.tarif_inscription, "renouvellement": c.tarif_renouvellement} if c.accueil_prix and c.tarif_inscription else None
    return {"nom": c.accueil_nom, "logo": c.accueil_logo, "carte": c.accueil_carte, "photos": [photo_row(x, request) for x in AccueilPhoto.objects.all()],
            "contact": {"whatsapp": c.accueil_whatsapp, "telephone": c.accueil_telephone, "email": c.accueil_email}, "prix": prix,
            "prix_affiche": c.accueil_prix, "chiffres": platform_figures() if c.accueil_chiffres else None, "chiffres_affiches": c.accueil_chiffres,
            "visiteurs": visitor_figures() if c.accueil_visiteurs else None, "visiteurs_affiches": c.accueil_visiteurs}


def shrink(f) -> ContentFile:
    """Réduit l'image (1920 px au plus), la remet dans le bon sens et la réenregistre en JPEG : les métadonnées (lieu GPS, appareil) disparaissent."""
    from PIL import Image, ImageOps, UnidentifiedImageError
    try:
        im = Image.open(f)
        im.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ValidationError({"detail": "Fichier illisible : ce n’est pas une image valide."}) from None
    im = ImageOps.exif_transpose(im).convert("RGB")
    if min(im.size) < 400:
        raise ValidationError({"detail": "Image trop petite : choisissez une photo d’au moins 800 pixels de large."})
    im.thumbnail((SIZE, SIZE))
    buf = BytesIO()
    im.save(buf, "JPEG", quality=82, optimize=True, progressive=True)
    return ContentFile(buf.getvalue(), name="photo.jpg")


class AccueilView(APIView):
    """GET : nom, logo, carte d'exemple et photos de la page d'accueil. PATCH `{nom, logo, carte, order: [ids]}`.
    POST multipart `photo` (+ `caption`) : ajoute une photo au diaporama (6 au plus)."""

    permission_classes = [IsPlatformAdmin]
    parser_classes = [JSONParser, MultiPartParser]
    http_method_names = ["get", "patch", "post", "options"]

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        c = PlatformSettings.load()
        return Response({**public_accueil(request), "max": AccueilPhoto.MAX, "email_demandes": c.accueil_email_demandes})

    @extend_schema(request=inline_serializer("AccueilSettings", {"nom": serializers.CharField(required=False, allow_blank=True), "logo": serializers.CharField(required=False, allow_blank=True),
                                                                 "carte": serializers.BooleanField(required=False), "order": serializers.ListField(child=serializers.IntegerField(), required=False)}),
                   responses={200: {"type": "object"}})
    @transaction.atomic
    def patch(self, request):
        c, d, done = PlatformSettings.load(), request.data, []
        if "nom" in d:
            c.accueil_nom = str(d["nom"] or "").strip()[:120]
            done.append("nom")
        if "logo" in d:
            v = str(d["logo"] or "")
            if v and not re.fullmatch(r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+", v):
                raise ValidationError({"logo": "Le logo doit être une image PNG, JPEG ou WebP."})
            if len(v) > 400_000:
                raise ValidationError({"logo": "Le logo est trop lourd (400 Ko au maximum)."})
            c.accueil_logo = v
            done.append("logo")
        if "carte" in d:
            c.accueil_carte = bool(d["carte"])
            done.append("carte d’exemple")
        for key, field, label in (("whatsapp", "accueil_whatsapp", "WhatsApp"), ("telephone", "accueil_telephone", "téléphone")):
            if key in d:
                v = str(d[key] or "").strip()[:30]
                if v and not re.fullmatch(r"\+?[0-9 .-]{6,30}", v):
                    raise ValidationError({key: f"Numéro de {label} invalide (chiffres, espaces et « + » seulement)."})
                setattr(c, field, v)
                done.append(label)
        for key, field, label in (("email", "accueil_email", "e-mail"), ("email_demandes", "accueil_email_demandes", "e-mail de réception des demandes")):
            if key in d:
                v = str(d[key] or "").strip().lower()[:254]
                if v and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
                    raise ValidationError({key: "Adresse e-mail invalide."})
                setattr(c, field, v)
                done.append(label)
        if "prix" in d:
            c.accueil_prix = bool(d["prix"])
            done.append("affichage du prix")
        if "chiffres" in d:
            c.accueil_chiffres = bool(d["chiffres"])
            done.append("affichage des chiffres")
        if "visiteurs" in d:
            c.accueil_visiteurs = bool(d["visiteurs"])
            done.append("affichage de la fréquentation")
        c.save()
        if "order" in d:
            ids = [int(x) for x in d.get("order") or []]
            by_id = {x.pk: x for x in AccueilPhoto.objects.all()}
            if sorted(ids) != sorted(by_id):
                raise ValidationError({"order": "La liste des photos a changé : rechargez la page."})
            for n, i in enumerate(ids):
                by_id[i].order = n
                by_id[i].save(update_fields=["order"])
            done.append("ordre des photos")
        if done:
            plog(request, "Page d’accueil modifiée", ", ".join(done))
        return self.get(request)

    @extend_schema(request={"multipart/form-data": {"type": "object", "properties": {"photo": {"type": "string", "format": "binary"}, "caption": {"type": "string"}}}},
                   responses={201: {"type": "object"}})
    def post(self, request):
        f = request.FILES.get("photo")
        if not f:
            raise ValidationError({"detail": "Choisissez une image."})
        if f.size > MAX_BYTES:
            raise ValidationError({"detail": "Image trop lourde (8 Mo maximum)."})
        if f.content_type not in ("image/jpeg", "image/png", "image/webp"):
            raise ValidationError({"detail": "Format non pris en charge : utilisez JPG, PNG ou WebP."})
        if AccueilPhoto.objects.count() >= AccueilPhoto.MAX:
            raise ValidationError({"detail": f"{AccueilPhoto.MAX} photos au plus : retirez-en une avant d’en ajouter."})
        img = shrink(f)
        last = AccueilPhoto.objects.order_by("-order").first()
        x = AccueilPhoto(caption=(request.data.get("caption") or "").strip()[:120], order=(last.order + 1) if last else 0)
        x.image.save("photo.jpg", img, save=True)
        plog(request, "Photo ajoutée à la page d’accueil", x.caption)
        return Response(photo_row(x, request), status=status.HTTP_201_CREATED)


class AccueilPhotoView(APIView):
    """PATCH `{caption}` : légende d'une photo ; DELETE : la retire du diaporama (et son fichier)."""

    permission_classes = [IsPlatformAdmin]
    http_method_names = ["patch", "delete", "options"]

    def get_photo(self, pk):
        x = AccueilPhoto.objects.filter(pk=pk).first()
        if x is None:
            raise NotFound()
        return x

    @extend_schema(request=inline_serializer("AccueilCaption", {"caption": serializers.CharField(allow_blank=True)}), responses={200: {"type": "object"}})
    def patch(self, request, pk):
        x = self.get_photo(pk)
        x.caption = str(request.data.get("caption") or "").strip()[:120]
        x.save(update_fields=["caption"])
        return Response(photo_row(x, request))

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        x = self.get_photo(pk)
        x.image.delete(save=False)
        x.delete()
        plog(request, "Photo retirée de la page d’accueil", x.caption)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------- Demandes de démonstration (écoles intéressées) ----------
class DemoThrottle(AnonRateThrottle):
    rate = "5/hour"


class PublicDemoRequestView(APIView):
    """Page d'accueil : une école demande une démonstration (sans compte). Le champ caché `site` piège les robots."""

    authentication_classes: list = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [DemoThrottle]

    @extend_schema(request=inline_serializer("DemoIn", {"ecole": serializers.CharField(), "nom": serializers.CharField(), "telephone": serializers.CharField()}),
                   responses={201: {"type": "object"}})
    def post(self, request):
        d = request.data
        if str(d.get("site") or "").strip():          # rempli par un robot : on fait comme si tout allait bien
            return Response({"ok": True}, status=status.HTTP_201_CREATED)
        ecole, nom, tel = (str(d.get(k) or "").strip() for k in ("ecole", "nom", "telephone"))
        errors = {}
        if len(ecole) < 2:
            errors["ecole"] = "Indiquez le nom de l’école."
        if len(nom) < 2:
            errors["nom"] = "Indiquez votre nom."
        if not re.fullmatch(r"\+?[0-9 .-]{8,30}", tel):
            errors["telephone"] = "Indiquez un numéro de téléphone joignable."
        email = str(d.get("email") or "").strip().lower()
        if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            errors["email"] = "Adresse e-mail invalide."
        if errors:
            raise ValidationError(errors)
        x = DemandeDemo.objects.create(ecole=ecole[:120], ville=str(d.get("ville") or "").strip()[:80], nom=nom[:120], telephone=tel[:30],
                                       email=email[:254], message=str(d.get("message") or "").strip()[:1000])
        plog(request, "Demande de démonstration", f"{x.ecole} · {x.nom} · {x.telephone}")
        c = PlatformSettings.load()
        to = c.accueil_email_demandes or c.accueil_email
        if to:   # l'administrateur est prévenu par e-mail, sans faire attendre l'école
            transaction.on_commit(lambda: _start(mail_demo, x, to))
        return Response({"ok": True}, status=status.HTTP_201_CREATED)


def _start(fn, *args):
    def run():
        try:
            fn(*args)
        finally:
            connection.close()   # connexion propre à ce fil
    threading.Thread(target=run, daemon=True).start()


def mail_demo(x: DemandeDemo, to: str) -> None:
    lines = [f"École : {x.ecole}" + (f" ({x.ville})" if x.ville else ""), f"Contact : {x.nom}", f"Téléphone : {x.telephone}"]
    if x.email:
        lines.append(f"E-mail : {x.email}")
    if x.message:
        lines += ["", "Besoin :", x.message]
    lines += ["", "La demande est aussi dans le portail d’administration, « Page d’accueil » > « Demandes de démo »."]
    try:
        send_mail(f"Demande de démonstration : {x.ecole}", "\n".join(lines), None, [to], fail_silently=False)
    except Exception as e:   # serveur d'e-mail absent ou refusé : la demande reste dans le portail
        log.warning("E-mail de demande de démonstration non envoyé : %s", e)


def demo_row(x: DemandeDemo) -> dict:
    return {"id": x.pk, "ecole": x.ecole, "ville": x.ville, "nom": x.nom, "telephone": x.telephone, "email": x.email, "message": x.message,
            "created": x.created, "traitee": x.traitee}


class DemoRequestsView(APIView):
    """Administrateur de la plateforme : demandes de démonstration (les nouvelles d'abord)."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses={200: {"type": "array"}})
    def get(self, request):
        return Response([demo_row(x) for x in DemandeDemo.objects.all()[:200]])


class DemoRequestView(APIView):
    """PATCH `{traitee}` : marque une demande comme traitée (ou à traiter)."""

    permission_classes = [IsPlatformAdmin]
    http_method_names = ["patch", "options"]

    @extend_schema(request=inline_serializer("DemoPatch", {"traitee": serializers.BooleanField()}), responses={200: {"type": "object"}})
    def patch(self, request, pk):
        x = DemandeDemo.objects.filter(pk=pk).first()
        if x is None:
            raise NotFound()
        x.traitee = bool(request.data.get("traitee", True))
        x.save(update_fields=["traitee"])
        plog(request, "Demande de démonstration traitée" if x.traitee else "Demande de démonstration rouverte", x.ecole)
        return Response(demo_row(x))


# ---------- Fréquentation de la page d'accueil (anonyme) ----------
BOTS = re.compile(r"bot|crawl|spider|slurp|preview|monitor|curl|wget|python-requests|headless", re.I)


class VisitThrottle(AnonRateThrottle):
    rate = "120/min"


class PublicVisitView(APIView):
    """La page d'accueil signale une visite. Le visiteur est compté une fois par jour grâce à une empreinte anonyme (hachage
    de l'adresse, du navigateur et du jour, avec la clé secrète du serveur) : aucune adresse IP ni cookie n'est conservé.
    Les robots (moteurs de recherche, aperçus de liens) sont ignorés."""

    authentication_classes: list = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [VisitThrottle]

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        import hashlib
        from datetime import timedelta

        from django.conf import settings
        from django.db.models import F
        from django.utils import timezone

        from .log import client_ip
        ua = request.META.get("HTTP_USER_AGENT", "")
        if not ua or BOTS.search(ua):
            return Response(status=status.HTTP_204_NO_CONTENT)
        day = timezone.localdate()
        fp = hashlib.sha256(f"{settings.SECRET_KEY}|{day}|{client_ip(request)}|{ua}".encode()).hexdigest()[:16]
        with transaction.atomic():
            VisiteJour.objects.get_or_create(day=day)
            new = VisiteurJour.objects.get_or_create(day=day, empreinte=fp)[1]
            VisiteJour.objects.filter(day=day).update(vues=F("vues") + 1, visiteurs=F("visiteurs") + (1 if new else 0))
            VisiteurJour.objects.filter(day__lt=day - timedelta(days=1)).delete()     # les empreintes ne servent qu'à la journée
        return Response(status=status.HTTP_204_NO_CONTENT)


class VisitsView(APIView):
    """Administrateur de la plateforme : fréquentation de la page d'accueil (`?jours=7|30|90`), jour par jour, et demandes de
    démonstration reçues sur la même période."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        from datetime import timedelta

        from django.utils import timezone
        try:
            n = int(request.query_params.get("jours", 30))
        except ValueError:
            n = 30
        n = n if n in (7, 30, 90) else 30
        today = timezone.localdate()
        start = today - timedelta(days=n - 1)
        rows = {v.day: v for v in VisiteJour.objects.filter(day__gte=today - timedelta(days=89))}

        def total(days: int, field: str) -> int:
            return sum(getattr(v, field) for d, v in rows.items() if d > today - timedelta(days=days))
        series = [{"day": d, "visiteurs": rows[d].visiteurs if d in rows else 0, "vues": rows[d].vues if d in rows else 0}
                  for d in (start + timedelta(days=i) for i in range(n))]
        demandes = DemandeDemo.objects.filter(created__date__gte=start).count()
        visiteurs = sum(x["visiteurs"] for x in series)
        return Response({"jours": n, "serie": series, "periode": {"visiteurs": visiteurs, "vues": sum(x["vues"] for x in series), "demandes": demandes},
                         "aujourdhui": total(1, "visiteurs"), "semaine": total(7, "visiteurs"), "mois": total(30, "visiteurs")})
