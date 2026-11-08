from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import generics, serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import Cursus, SchoolClass, SchoolYear
from apps.core.log import record
from apps.core.permissions import perm_required
from apps.core.tenancy import cursus_context

from . import csvio
from .models import Enrollment, Parent, Student
from .serializers import EnrollSerializer, ParentSerializer, StudentDetailSerializer, StudentSerializer, StudentUpdateSerializer
from .services import change_class, class_free_places, enroll_student

READ_STAFF = ("students.write", "settings", "appel", "justifs", "discipline", "pay.read", "pay.write", "journal", "classes.write")


def visible_students(user):
    """Périmètre de lecture : chaque rôle ne voit que ce qui le concerne (appliqué côté serveur, jamais côté interface)."""
    if user.role in ("eleve", "parent"):
        with cursus_context(None):     # la famille voit ses inscriptions dans tous les cursus de l'école
            qs = Student.objects.select_related("school_class", "parent__user", "user", "cursus")
        return qs.filter(user=user) if user.role == "eleve" else qs.filter(parent__user=user)
    qs = Student.objects.select_related("school_class", "parent__user", "user", "cursus")
    if user.role == "enseignant":
        from datetime import timedelta

        from django.db.models import Q
        from django.utils import timezone

        from apps.schedule.models import Replacement
        subbed = Replacement.objects.filter(teacher__user=user, date__gte=timezone.localdate() - timedelta(days=7)).values("school_class_id")
        return qs.filter(Q(school_class__assignments__teacher__user=user) | Q(school_class_id__in=subbed)).distinct()  # + classes qu'il remplace
    if user.role == "educateur":
        from apps.discipline.scope import educator_scope
        sc = educator_scope(user)
        return qs if sc is None else qs.filter(school_class_id__in=sc)   # classes confiées à l'éducateur (sinon toute l'école)
    return qs


class StudentListCreate(generics.ListCreateAPIView):
    """GET : liste filtrée (`?class=`, `?q=`, `?active=`). POST : inscription (secrétariat) → renvoie les identifiants provisoires."""

    serializer_class = StudentSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [perm_required("students.write")()]
        if getattr(self.request.user, "role", "") in ("parent", "eleve"):
            return []  # périmètre limité par get_queryset
        return [perm_required(*READ_STAFF)()]

    def get_queryset(self):
        qs = visible_students(self.request.user)
        p = self.request.query_params
        if p.get("class"):
            qs = qs.filter(school_class_id=p["class"])
        if p.get("q"):
            qs = qs.filter(Q(nom__icontains=p["q"]) | Q(prenoms__icontains=p["q"]) | Q(matricule__icontains=p["q"]))
        if p.get("active") in ("0", "1"):
            qs = qs.filter(active=p["active"] == "1")
        return qs

    def create(self, request, *args, **kwargs):
        ser = EnrollSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        res = enroll_student(**ser.validated_data)
        s = res.student
        record("Inscription", f"{s.full_name} · {s.class_label} · {s.matricule}", request=request)
        return Response({"student": StudentSerializer(s).data, "credentials": res.credentials}, status=status.HTTP_201_CREATED)


class StudentDetail(generics.RetrieveUpdateAPIView):
    serializer_class = StudentDetailSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_permissions(self):
        if self.request.method == "PATCH":
            return [perm_required("students.write")()]
        return []

    def get_queryset(self):
        return visible_students(self.request.user)

    def update(self, request, *args, **kwargs):
        s = self.get_object()
        ser = StudentUpdateSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        with transaction.atomic():
            new_class = d.pop("school_class", None)
            parent_name = d.pop("parent_name", None)
            active = d.pop("active", None)
            if "nom" in d:
                d["nom"] = d["nom"].strip().upper()
            for k, v in d.items():
                setattr(s, k, v)
            if active is not None and active != s.active:
                s.active = active
                s.sortie = "" if active else (s.sortie or "parti")
                # Le compte reste ouvert tant que l'élève est inscrit dans un autre cursus
                s.user.is_active = active or s.inscriptions().exclude(pk=s.pk).filter(active=True).exists()
                s.user.save(update_fields=["is_active"])
            s.save()
            same = {k: getattr(s, k) for k in Student.IDENTITE if k in d}
            if same:                       # même personne : identité tenue à jour dans tous ses cursus
                s.inscriptions().exclude(pk=s.pk).update(**same)
            if new_class:
                change_class(s, new_class)
            if parent_name:
                s.parent.user.full_name = parent_name.strip()
                s.parent.user.save(update_fields=["full_name"])
            if {"nom", "prenoms"} & set(d):
                s.user.full_name = s.full_name
                s.user.save(update_fields=["full_name"])
        record("Élève modifié", f"{s.full_name} · {s.matricule}", request=request)
        s.refresh_from_db()
        return Response(StudentDetailSerializer(s).data)


class StudentOtherCursusView(APIView):
    """POST `{cursus, school_class}` (ou `{cursus, level}` : à placer) : inscrit l'élève dans un autre cursus de l'école (école
    franco-arabe…). La personne reste la même : même compte, même matricule, même parent ; une inscription par cursus."""

    permission_classes = [perm_required("students.write")]

    @extend_schema(request=inline_serializer("OtherCursusIn", {"cursus": serializers.IntegerField(), "school_class": serializers.IntegerField(required=False)}),
                   responses=StudentDetailSerializer)
    def post(self, request, pk):
        s = generics.get_object_or_404(Student, pk=pk)
        root = s.principal or s
        target = Cursus.objects.filter(pk=request.data.get("cursus")).first()
        if target is None:
            raise ValidationError({"cursus": "Cursus inconnu."})
        if s.inscriptions().filter(cursus=target).exists():
            raise ValidationError({"cursus": f"{s.prenoms} est déjà inscrit(e) dans le cursus « {target.nom} »."})
        year = SchoolYear.get_current()
        if year is None:
            raise ValidationError("Aucune année scolaire n’est configurée.")
        with cursus_context(target), transaction.atomic():
            klass, level = None, str(request.data.get("level") or "").strip()
            if request.data.get("school_class"):
                klass = SchoolClass.objects.select_for_update().filter(pk=request.data["school_class"]).first()
                if klass is None:
                    raise ValidationError({"school_class": "Classe inconnue dans ce cursus."})
                if class_free_places(klass) <= 0:
                    raise ValidationError({"school_class": f"La classe {klass.name} est complète ({klass.max_students} places)."})
            elif not level:
                raise ValidationError({"school_class": "Choisissez la classe, ou le niveau pour un élève à répartir."})
            new = Student.objects.create(user=root.user, principal=root, matricule=root.matricule, cursus=target, school_class=klass,
                                         active=klass is not None, sortie="" if klass is not None else "placer",
                                         **{k: getattr(root, k) for k in Student.IDENTITE})
            Enrollment.objects.create(student=new, year=year, school_class=klass, level="" if klass is not None else level)
        record("Inscription dans un autre cursus", f"{s.full_name} · {target.nom} · {new.class_label}", request=request)
        return Response(StudentDetailSerializer(s).data, status=status.HTTP_201_CREATED)


class ParentList(generics.ListAPIView):
    serializer_class = ParentSerializer
    pagination_class = None

    def get_permissions(self):
        return [perm_required("students.write", "pay.read", "pay.write", "settings")()]

    def get_queryset(self):
        return Parent.objects.select_related("user").prefetch_related("children")


@extend_schema(request={"multipart/form-data": inline_serializer("ImportCsv", {"file": serializers.FileField()})}, responses=inline_serializer("ImportResult", {"total": serializers.IntegerField(), "valid": serializers.IntegerField(), "errors": serializers.ListField(), "created": serializers.ListField()}))
class ImportView(APIView):
    """Import CSV. `?commit=1` pour enregistrer ; sans, simple vérification (aperçu des erreurs). Les lignes valides
    sont inscrites, les lignes en erreur sont renvoyées avec leur motif. Les identifiants provisoires sont renvoyés une seule fois."""

    parser_classes = [MultiPartParser]

    def get_permissions(self):
        return [perm_required("students.write")()]

    def post(self, request):
        f = request.FILES.get("file")
        if not f:
            raise ValidationError({"file": "Joignez un fichier Excel (.xlsx) ou CSV."})
        if f.size > 2_000_000:
            raise ValidationError({"file": "Fichier trop volumineux (2 Mo au maximum)."})
        try:
            rows = csvio.read_rows(f.read())
        except ValueError as e:
            raise ValidationError({"file": str(e)}) from e
        valid, errors = csvio.validate_rows(rows)
        out = {"total": len(rows), "valid": len(valid), "errors": errors, "created": []}
        if request.query_params.get("commit") != "1":
            return Response(out)
        credentials = []
        for r in valid:
            line = r.pop("line")
            try:
                res = enroll_student(**r)
            except ValidationError as e:  # concurrence : classe pleine entre-temps, doublon…
                out["errors"].append({"line": line, "nom": r["nom"], "errors": [str(e.detail)]})
                continue
            out["created"].append({"matricule": res.student.matricule, "name": res.student.full_name})
            credentials += res.credentials
        out["valid"] = len(out["created"])
        out["credentials"] = credentials
        record("Import d’élèves", f"{f.name[:60]} : {len(out['created'])} inscrit(s), {len(out['errors'])} erreur(s)", request=request)
        return Response(out, status=status.HTTP_201_CREATED if out["created"] else status.HTTP_200_OK)


@extend_schema(responses={(200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): OpenApiTypes.BINARY})
class ImportTemplateView(APIView):
    """Modèle Excel prêt à remplir (classes de l'école en liste déroulante)."""

    def get_permissions(self):
        return [perm_required("students.write")()]

    def get(self, request):
        from apps.academics.models import SchoolClass
        resp = HttpResponse(csvio.template_xlsx([c.name for c in SchoolClass.objects.order_by("name")]),
                            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        resp["Content-Disposition"] = 'attachment; filename="modele-import-eleves.xlsx"'
        return resp


@extend_schema(responses={(200, "text/csv"): OpenApiTypes.STR})
class ExportView(APIView):
    def get_permissions(self):
        return [perm_required("students.write", "settings")()]

    def get(self, request):
        qs = Student.objects.filter(active=True)
        if request.query_params.get("class"):
            qs = qs.filter(school_class_id=request.query_params["class"])
        record("Export des élèves", f"{qs.count()} ligne(s)", request=request)
        resp = HttpResponse(csvio.export_students(qs), content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = 'attachment; filename="eleves.csv"'
        return resp
