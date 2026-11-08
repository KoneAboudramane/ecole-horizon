"""Supports de cours et cours en direct. Les liens sont des adresses https vers des services extérieurs (YouTube, Drive, Meet, Zoom…)."""
from datetime import timedelta
from urllib.parse import urlsplit

from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import Teacher, TeachingAssignment
from apps.core.log import record
from apps.core.permissions import has_perm, perm_required
from apps.notifications.services import family_users, notify
from apps.students.models import Student
from apps.students.views import visible_students

from . import logic
from .models import Resource
from .views import file_response

OBJ = {200: {"type": "object"}}
EARLY = timedelta(minutes=15)   # le lien d'un cours en direct apparaît 15 minutes avant le début


def clean_links(raw) -> list[dict]:
    if not isinstance(raw, list) or len(raw) > 5:
        raise ValidationError("Cinq liens au plus.")
    out = []
    for it in raw:
        url = str((it or {}).get("url", "")).strip() if isinstance(it, dict) else str(it).strip()
        label = str((it or {}).get("label", "")).strip()[:80] if isinstance(it, dict) else ""
        parts = urlsplit(url)
        if parts.scheme != "https" or not parts.hostname or "." not in parts.hostname or parts.username or parts.password or len(url) > 500 or " " in url:
            raise ValidationError(f"Lien refusé : « {url[:60]} ». Seules les adresses commençant par https:// sont acceptées.")
        out.append({"url": url, "label": label})
    return out


def link_open(r: Resource, user, now=None) -> bool:
    """Un lien de cours en direct n'est montré qu'à l'élève, dans la fenêtre de la séance."""
    if r.kind != "direct":
        return True
    if user.role == "parent":
        return False
    if user.role != "eleve":
        return True
    now = now or timezone.now()
    return r.starts_at - EARLY <= now <= r.ends_at


def resource_dict(r: Resource, user) -> dict:
    show = link_open(r, user)
    return {"id": r.pk, "school_class": r.school_class_id, "subject": r.subject_id, "subject_name": r.subject.name,
            "teacher_name": r.teacher.user.name if r.teacher_id else "", "kind": r.kind, "title": r.title, "description": r.description,
            "links": r.links if show else [], "links_hidden": bool(r.links) and not show, "has_file": bool(r.file), "file_name": r.file_name,
            "starts_at": r.starts_at.isoformat() if r.starts_at else None, "ends_at": r.ends_at.isoformat() if r.ends_at else None,
            "created_at": r.created_at.isoformat()}


class ResourceInput(serializers.ModelSerializer):
    class Meta:
        model = Resource
        fields = ["school_class", "subject", "kind", "title", "description", "starts_at", "ends_at"]
        extra_kwargs = {"title": {"min_length": 3}, "description": {"max_length": 1000}}

    def validate(self, a):
        cur = self.instance
        kind = a.get("kind", cur.kind if cur else None)
        s, e = a.get("starts_at", cur.starts_at if cur else None), a.get("ends_at", cur.ends_at if cur else None)
        if kind == "direct":
            if not s or not e or e <= s:
                raise serializers.ValidationError({"ends_at": "Indiquez le début et la fin du cours en direct (la fin suit le début)."})
        else:
            a["starts_at"] = a["ends_at"] = None
        return a


def base_qs():
    return Resource.objects.select_related("subject", "teacher__user", "school_class")


def get_visible(request, pk, write=False) -> Resource:
    logic.check_module()
    r = base_qs().filter(pk=pk).first()
    u = request.user
    if r is None:
        raise NotFound()
    mine = u.role == "enseignant" and r.teacher_id and r.teacher.user_id == u.pk
    if write:
        if not mine:
            raise PermissionDenied("Ce support n’est pas le vôtre.")
        return r
    if mine:
        return r
    if u.role in ("parent", "eleve"):
        if not visible_students(u).filter(school_class_id=r.school_class_id).exists():
            raise NotFound()
    elif not has_perm(u, "devoirs.read"):
        raise PermissionDenied()
    return r


class ResourceList(APIView):
    parser_classes = [JSONParser]

    def get_permissions(self):
        return [perm_required("devoirs.write")()] if self.request.method == "POST" else [IsAuthenticated()]

    @extend_schema(responses=OBJ)
    def get(self, request):
        logic.check_module()
        u, p = request.user, request.query_params
        qs = base_qs()
        if u.role in ("parent", "eleve"):
            qs = qs.filter(school_class_id__in=visible_students(u).values("school_class_id"))
        elif u.role == "enseignant":
            qs = qs.filter(teacher__user=u)
        elif not has_perm(u, "devoirs.read"):
            raise PermissionDenied()
        for k, f in (("class", "school_class_id"), ("subject", "subject_id"), ("kind", "kind")):
            if p.get(k):
                qs = qs.filter(**{f: p[k]})
        return Response([resource_dict(r, u) for r in qs[:300]])

    @extend_schema(request=ResourceInput, responses=OBJ)
    @transaction.atomic
    def post(self, request):
        logic.check_module()
        ser = ResourceInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if not TeachingAssignment.objects.filter(teacher__user=request.user, school_class=d["school_class"], subject=d["subject"]).exists():
            raise PermissionDenied("Vous n’enseignez pas cette matière dans cette classe.")
        links = clean_links(request.data.get("links", []))
        if d["kind"] == "direct" and not links:
            raise ValidationError("Indiquez le lien du cours en direct.")
        if d["kind"] == "support" and not links and not request.data.get("will_attach"):
            raise ValidationError("Ajoutez au moins un lien, ou joignez un fichier.")
        r = ser.save(teacher=Teacher.objects.get(user=request.user), links=links)
        studs = Student.objects.filter(school_class=r.school_class, active=True).select_related("parent__user", "user")
        if r.kind == "direct":
            what = f"Cours en direct en {r.subject.name} ({r.school_class.name}) le {timezone.localtime(r.starts_at):%d/%m/%Y à %H:%M} : « {r.title} »."
        else:
            what = f"Nouveau support de cours en {r.subject.name} ({r.school_class.name}) : « {r.title} »."
        notify([x for s in studs for x in family_users(s)], what, "annonce", "cours")
        record("Cours", f"{r.title} : {r.school_class.name}, {r.subject.name}", request=request)
        return Response(resource_dict(base_qs().get(pk=r.pk), request.user), status=status.HTTP_201_CREATED)


class ResourceDetail(APIView):
    parser_classes = [JSONParser]

    @extend_schema(responses=OBJ)
    def get(self, request, pk):
        return Response(resource_dict(get_visible(request, pk), request.user))

    @extend_schema(request=ResourceInput, responses=OBJ)
    def patch(self, request, pk):
        r = get_visible(request, pk, write=True)
        ser = ResourceInput(r, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if any(k in d and d[k] != getattr(r, k) for k in ("school_class", "subject", "kind")):
            raise ValidationError("La classe, la matière et le type ne se changent pas : supprimez et recréez.")
        extra = {"links": clean_links(request.data["links"])} if "links" in request.data else {}
        if extra and not extra["links"] and not r.file and r.kind == "support" or (r.kind == "direct" and "links" in request.data and not extra["links"]):
            raise ValidationError("Il faut au moins un lien ou un fichier.")
        r = ser.save(**extra)
        return Response(resource_dict(base_qs().get(pk=r.pk), request.user))

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        r = get_visible(request, pk, write=True)
        if r.file:
            r.file.delete(save=False)
        r.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ResourceFile(APIView):
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(responses={200: {"type": "string", "format": "binary"}})
    def get(self, request, pk):
        r = get_visible(request, pk)
        if not r.file:
            raise NotFound()
        return file_response(r.file, r.file_name)

    @extend_schema(request={"multipart/form-data": inline_serializer("ResFileIn", {"file": serializers.FileField()})}, responses=OBJ)
    def post(self, request, pk):
        r = get_visible(request, pk, write=True)
        if r.kind != "support":
            raise ValidationError("Un cours en direct n’a pas de fichier.")
        f = request.FILES.get("file")
        if not f:
            raise ValidationError("Choisissez un fichier.")
        logic.check_file(f)
        if r.file:
            r.file.delete(save=False)
        r.file.save(f.name, f, save=False)
        r.file_name = f.name[:200]
        r.save()
        return Response(resource_dict(base_qs().get(pk=pk), request.user))

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        r = get_visible(request, pk, write=True)
        if r.file and not r.links:
            raise ValidationError("Le support n’aurait plus ni lien ni fichier : supprimez-le plutôt.")
        if r.file:
            r.file.delete(save=False)
        r.file_name = ""
        r.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
