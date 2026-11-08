import math

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from drf_spectacular.utils import extend_schema_serializer, extend_schema, inline_serializer
from django.db.models import Count, Exists, OuterRef
from rest_framework import generics, permissions, serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.horaires import DAYS, Horaires, clean as clean_horaires
from apps.academics.models import Coefficient, Room, SchoolClass, SchoolSettings, Teacher, TeachingAssignment
from apps.core.log import record
from apps.core.pagination import BigPages
from apps.core.permissions import has_perm, perm_required
from apps.notifications.services import notify
from apps.students.models import Student
from apps.students.views import visible_students

from . import generator
from . import lessons as lessons_mod
from .models import Cell, Replacement, TextEntry

EXTRA_ROOMS = [generator.LAB, generator.SPORT, "Salle informatique"]


def current_horaires() -> Horaires:
    """Horaires de l'école courante (ceux d'origine tant qu'elle n'a rien réglé)."""
    return Horaires(SchoolSettings.load().horaires or None)


# ---------- Emploi du temps ----------
class CellSerializer(serializers.ModelSerializer):
    subject_name = serializers.CharField(source="subject.name", read_only=True)

    class Meta:
        model = Cell
        fields = ["id", "school_class", "day", "slot", "subject", "subject_name", "room"]
        validators: list = []  # le PUT remplace le cours déjà placé sur ce créneau (update_or_create)

    def validate(self, a):
        if not current_horaires().is_open(a["day"], a["slot"]):
            raise serializers.ValidationError("Ce créneau n’existe pas dans les horaires de l’école (jour sans cours ou créneau fermé).")
        if not Coefficient.objects.filter(groupe=a["school_class"].groupe, subject=a["subject"]).exists():
            raise serializers.ValidationError({"subject": "Cette matière n’est pas enseignée à cette classe."})
        if Room.objects.exists() and not Room.objects.filter(name=a["room"]).exists():
            raise serializers.ValidationError({"room": "Cette salle n’existe pas dans la liste des salles de l’école."})
        return a


def teacher_of(school_class_id, subject_id):
    a = TeachingAssignment.objects.filter(school_class_id=school_class_id, subject_id=subject_id).first()
    return a.teacher_id if a else None


def conflicts(school_class_id, day, slot, subject_id, room) -> list[str]:
    """Doubles réservations qu'entraînerait ce cours : enseignant déjà en cours ailleurs, salle déjà prise."""
    out = []
    tid = teacher_of(school_class_id, subject_id)
    if tid is None:
        out.append("Aucun enseignant n’est affecté à cette matière dans cette classe.")
    else:
        busy = Cell.objects.filter(day=day, slot=slot).exclude(school_class_id=school_class_id).select_related("school_class")
        for c in busy:
            if teacher_of(c.school_class_id, c.subject_id) == tid:
                out.append(f"L’enseignant est déjà en cours avec la {c.school_class.name} à ce créneau.")
    r = Cell.objects.filter(day=day, slot=slot, room=room).exclude(school_class_id=school_class_id).select_related("school_class").first()
    if r:
        out.append(f"{room} est déjà occupée par la {r.school_class.name} à ce créneau.")
    return out


def dispo_of(teacher_id) -> dict:
    t = Teacher.objects.filter(pk=teacher_id).first() if teacher_id else None
    return (t.dispo or {}) if t else {}


def dispo_warnings(school_class_id, day, slot, subject_id) -> list[str]:
    """Avertissements (non bloquants) : l'enseignant s'est déclaré indisponible, ou préfère éviter, ce créneau."""
    t = Teacher.objects.select_related("user").filter(pk=teacher_of(school_class_id, subject_id)).first()
    v = (t.dispo or {}).get(f"{day}-{slot}") if t else None
    if v == "x":
        return [f"{t.user.name} s’est déclaré indisponible à ce créneau."]
    if v == "p":
        return [f"{t.user.name} préfère ne pas avoir cours à ce créneau."]
    return []


def capacity_warnings(school_class, room_name) -> list[str]:
    """Avertissements (non bloquants) : la salle choisie est plus petite que la classe."""
    room = Room.objects.filter(name=room_name).first()
    n = school_class.students.filter(active=True).count()
    if room and n > room.capacity:
        return [f"{room.name} a {room.capacity} places pour {n} élèves en {school_class.name}."]
    return []


class TimetableView(APIView):
    """GET `?class=` ou `?teacher=` : cours de la semaine. Parents et élèves : la classe de leurs enfants. Personnel : tout.
    PUT : place ou remplace un cours (direction, secrétariat) ; DELETE `?class=&day=&slot=` : le retire."""

    def get_permissions(self):
        return [permissions.IsAuthenticated()] if self.request.method == "GET" else [perm_required("edt.write")()]

    @extend_schema(responses=CellSerializer(many=True))
    def get(self, request):
        u, p = request.user, request.query_params
        qs = Cell.objects.select_related("subject")
        if u.role in ("parent", "eleve"):
            qs = qs.filter(school_class_id__in=visible_students(u).values("school_class_id"))
        if p.get("class"):
            qs = qs.filter(school_class_id=p["class"])
        if p.get("teacher"):
            ids = [(a.school_class_id, a.subject_id) for a in TeachingAssignment.objects.filter(teacher_id=p["teacher"])]
            q = Q(pk__in=[])
            for c, s in ids:
                q |= Q(school_class_id=c, subject_id=s)
            qs = qs.filter(q)
        hr = current_horaires()
        return Response({"slots": [{"start": a, "end": b} for a, b in hr.slots], "breaks": hr.breaks, "days": DAYS, "ouverts": hr.ouverts,
                         "horaires": hr.data, "cells": CellSerializer(qs, many=True).data})

    @extend_schema(request=CellSerializer, responses=CellSerializer)
    @transaction.atomic
    def put(self, request):
        ser = CellSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        bad = conflicts(d["school_class"].pk, d["day"], d["slot"], d["subject"].pk, d["room"])
        if bad:
            raise ValidationError({"conflicts": bad, "detail": bad[0]})
        c, _ = Cell.objects.update_or_create(school_class=d["school_class"], day=d["day"], slot=d["slot"], defaults={"subject": d["subject"], "room": d["room"]})
        record("Emploi du temps", f"{d['school_class'].name} · {DAYS[d['day']]} créneau {d['slot'] + 1} · {d['subject'].name}", request=request)
        warnings = dispo_warnings(d["school_class"].pk, d["day"], d["slot"], d["subject"].pk) + capacity_warnings(d["school_class"], d["room"])
        return Response({**CellSerializer(c).data, "warnings": warnings})

    @extend_schema(request=None, responses={204: None})
    def delete(self, request):
        p = request.query_params
        n, _ = Cell.objects.filter(school_class_id=p.get("class"), day=p.get("day"), slot=p.get("slot")).delete()
        if not n:
            raise NotFound()
        return Response(status=status.HTTP_204_NO_CONTENT)


class GenerateView(APIView):
    """Régénère tout l'emploi du temps d'après les affectations et les coefficients (heures par semaine). Remplace l'existant."""

    permission_classes = [perm_required("edt.write")]

    @extend_schema(request=None, responses=inline_serializer("Generated", {"cells": serializers.IntegerField(), "unplaced": serializers.IntegerField(),
                                                                         "blocked_by": serializers.ListField(child=serializers.DictField())}))
    @transaction.atomic
    def post(self, request):
        classes = list(SchoolClass.objects.order_by("id"))
        coefs = {(c.groupe, c.subject_id): c.value for c in Coefficient.objects.all()}
        by_id = {c.pk: c for c in classes}
        asg = [(a.school_class_id, a.subject.code, a.subject_id, a.teacher_id) for a in TeachingAssignment.objects.select_related("subject").order_by("id")]
        blocked, avoid = set(), set()
        teachers = {t.pk: t for t in Teacher.objects.select_related("user")}
        for t in teachers.values():
            for k, v in (t.dispo or {}).items():
                d, s = (int(x) for x in k.split("-"))
                (blocked if v == "x" else avoid).add((t.pk, d, s))
        homes, labs, sports = None, None, None
        if Room.objects.exists():
            auto_assign_rooms(reset=False)
            homes = {c.pk: c.room.name for c in SchoolClass.objects.select_related("room") if c.room}
            labs = list(Room.objects.filter(kind__in=("labo", "info")).values_list("name", flat=True))
            sports = list(Room.objects.filter(kind="sport").values_list("name", flat=True))
        cells, unplaced = generator.generate([c.pk for c in classes], asg, lambda cl, sb: coefs.get((by_id[cl].groupe, sb), 0), current_horaires(),
                                             homes=homes, labs=labs, sports=sports, blocked=blocked, avoid=avoid)
        Cell.objects.all().delete()
        Cell.objects.bulk_create([Cell(school_class_id=c, day=d, slot=s, subject_id=sb, room=r) for c, d, s, sb, r in cells])
        # Heures restées sans créneau chez les enseignants qui ont déclaré des indisponibilités : la direction sait qui contacter
        placed = {}
        for c, _d, _s, sb, _r in cells:
            placed[(c, sb)] = placed.get((c, sb), 0) + 1
        missing = {}
        for cl, code, sb, tid in asg:
            want = int(min(5, 2 if code == "eps" else coefs.get((by_id[cl].groupe, sb), 0)))
            if want > placed.get((cl, sb), 0) and tid in teachers and any(k[0] == tid for k in blocked):
                missing[tid] = missing.get(tid, 0) + want - placed.get((cl, sb), 0)
        blocked_by = sorted(({"teacher": tid, "name": teachers[tid].user.name, "missing": n} for tid, n in missing.items()), key=lambda x: -x["missing"])
        record("Emploi du temps", f"Génération automatique : {len(cells)} heures, {unplaced} non placée(s)", request=request)
        return Response({"cells": len(cells), "unplaced": unplaced, "blocked_by": blocked_by})


# ---------- Cours du jour, remplacements ----------
class LessonsView(APIView):
    """GET `?date=` : les cours du jour, déduits de l'emploi du temps. Un enseignant voit les siens (ou ceux qu'il remplace) ;
    le personnel voit tous les cours, ou ceux d'un enseignant (`?teacher=`) ou d'une classe (`?class=`).
    Chaque cours indique si l'appel est fait (`done`)."""

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        from apps.attendance.models import AppelSession
        u, p = request.user, request.query_params
        d = parse_date(p.get("date") or "") or timezone.localdate()
        tid = None
        if u.role == "enseignant":
            t = Teacher.objects.filter(user=u).first()
            tid = t.pk if t else -1
        elif u.role in ("parent", "eleve", "comptable"):
            raise PermissionDenied()
        elif not any(has_perm(u, x) for x in ("appel", "edt.write", "journal", "discipline")):
            raise PermissionDenied()
        elif p.get("teacher"):
            tid = int(p["teacher"])
        rows = lessons_mod.lessons(d, current_horaires(), tid, int(p["class"]) if p.get("class") else None)
        from apps.discipline.scope import educator_scope
        sc = educator_scope(u)
        if sc is not None:
            rows = [x for x in rows if x["school_class"] in sc]                  # classes confiées à l'éducateur
        done = set(AppelSession.objects.filter(date=d).values_list("school_class_id", "slot"))
        entries = {(e.school_class_id, e.subject_id): e.pk for e in TextEntry.objects.filter(date=d)}
        for x in rows:
            x["done"] = (x["school_class"], x["code"]) in done
            x["entry"] = entries.get((x["school_class"], x["subject"]))      # séance déjà saisie au cahier de textes
        return Response({"date": d, "lessons": rows})


class ReplacementSerializer(serializers.ModelSerializer):
    class_name = serializers.CharField(source="school_class.name", read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    teacher_name = serializers.CharField(source="teacher.user.name", read_only=True)
    absent_name = serializers.SerializerMethodField()

    class Meta:
        model = Replacement
        fields = ["id", "school_class", "class_name", "subject", "subject_name", "date", "slot", "teacher", "teacher_name", "absent", "absent_name"]
        read_only_fields = ["subject", "absent"]
        validators: list = []

    def get_absent_name(self, o) -> str:
        return o.absent.user.name if o.absent else ""


def busy_teacher(teacher_id, date, slot, except_class=None) -> str:
    """Nom de la classe où cet enseignant est déjà pris à ce créneau (cours ou remplacement), sinon chaîne vide."""
    for x in lessons_mod.lessons(date, current_horaires(), teacher_id):
        if slot in x["slots"] and x["teacher"] == teacher_id and x["school_class"] != except_class:
            return x["class_name"]
    return ""


class ReplacementList(generics.ListCreateAPIView):
    """Remplacements. GET `?from=&to=&class=` (personnel, et l'enseignant concerné). POST `{school_class, date, slot, teacher}` (`edt.write`) :
    `teacher` tient la classe à la place du titulaire à ce cours ; il doit être libre à ce créneau et en est prévenu."""

    serializer_class = ReplacementSerializer
    pagination_class = None

    def get_permissions(self):
        return [perm_required("edt.write")()] if self.request.method == "POST" else [permissions.IsAuthenticated()]

    def get_queryset(self):
        u, p = self.request.user, self.request.query_params
        qs = Replacement.objects.select_related("school_class", "subject", "teacher__user", "absent__user")
        if u.role == "enseignant":
            qs = qs.filter(Q(teacher__user=u) | Q(absent__user=u))
        elif u.role in ("parent", "eleve", "comptable"):
            return qs.none()
        if p.get("from"):
            qs = qs.filter(date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(date__lte=p["to"])
        if p.get("class"):
            qs = qs.filter(school_class_id=p["class"])
        return qs

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        cls, date, slot, teacher = d["school_class"], d["date"], d["slot"], d["teacher"]
        cell = Cell.objects.filter(school_class=cls, day=date.weekday(), slot=slot).first()
        if not cell:
            raise ValidationError({"detail": "Cette classe n’a pas cours à ce créneau ce jour-là."})
        titular = TeachingAssignment.objects.filter(school_class=cls, subject=cell.subject).first()
        if titular and titular.teacher_id == teacher.pk:
            raise ValidationError({"detail": "Cet enseignant est déjà le titulaire de ce cours."})
        where = busy_teacher(teacher.pk, date, slot, cls.pk)
        if where:
            raise ValidationError({"detail": f"{teacher.user.name} est déjà en cours avec la {where} à ce créneau."})
        r, _ = Replacement.objects.update_or_create(school_class=cls, date=date, slot=slot, defaults={
            "subject": cell.subject, "teacher": teacher, "absent": titular.teacher if titular else None, "by": request.user})
        hr = current_horaires()
        notify([teacher.user], f"Vous remplacez {r.absent.user.name + ' ' if r.absent else ''}en {cls.name} ({cell.subject.name}) le {date:%d/%m/%Y} à {hr.slots[slot][0]}.", "systeme", "presences")
        if r.absent:
            notify([r.absent.user], f"{teacher.user.name} vous remplace en {cls.name} le {date:%d/%m/%Y} à {hr.slots[slot][0]}.", "systeme", "presences")
        record("Remplacement", f"{cls.name} · {date:%d/%m/%Y} créneau {slot + 1} : {teacher.user.name}", request=request)
        return Response(self.get_serializer(r).data, status=status.HTTP_201_CREATED)


class ReplacementDetail(generics.DestroyAPIView):
    serializer_class = ReplacementSerializer
    permission_classes = [perm_required("edt.write")]

    def get_queryset(self):
        return Replacement.objects.select_related("school_class", "teacher__user")

    def perform_destroy(self, o):
        record("Remplacement annulé", f"{o.school_class.name} · {o.date:%d/%m/%Y} : {o.teacher.user.name}", request=self.request)
        o.delete()


class CandidatesView(APIView):
    """GET `?class=&date=&slot=` : enseignants pouvant remplacer (libres à ce créneau), ceux de la même matière en premier."""

    permission_classes = [perm_required("edt.write")]

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        p = request.query_params
        d, slot = parse_date(p.get("date") or ""), p.get("slot", "")
        if not (p.get("class") and d and slot.isdigit()):
            raise ValidationError("Indiquez la classe, la date et le créneau.")
        slot = int(slot)
        cell = Cell.objects.filter(school_class_id=p["class"], day=d.weekday(), slot=slot).first()
        if not cell:
            raise ValidationError("Cette classe n’a pas cours à ce créneau.")
        out = []
        for t in Teacher.objects.select_related("user").prefetch_related("subjects").filter(user__is_active=True):
            where = busy_teacher(t.pk, d, slot, int(p["class"]))
            out.append({"id": t.pk, "name": t.user.name, "same_subject": any(s.pk == cell.subject_id for s in t.subjects.all()), "busy": where,
                        "dispo": (t.dispo or {}).get(f"{d.weekday()}-{slot}", "")})        # "x" indisponible, "p" plutôt pas
        out.sort(key=lambda x: (bool(x["busy"]), x["dispo"] == "x", x["dispo"] == "p", not x["same_subject"], x["name"]))
        return Response(out)


# ---------- Disponibilités des enseignants ----------
def teacher_hours() -> dict[int, int]:
    """Heures de cours par semaine de chaque enseignant, comptées comme le générateur (5 h au plus par matière, 2 h d'EPS)."""
    coefs = {(c.groupe, c.subject_id): c.value for c in Coefficient.objects.all()}
    out: dict[int, int] = {}
    for a in TeachingAssignment.objects.select_related("subject", "school_class"):
        h = min(5, 2 if a.subject.code == "eps" else int(coefs.get((a.school_class.groupe, a.subject_id), 0)))
        out[a.teacher_id] = out.get(a.teacher_id, 0) + h
    return out


def open_keys(hr: Horaires) -> list[str]:
    return [f"{d}-{s}" for d in range(len(DAYS)) for s in range(hr.slots_open(d))]


def dispo_row(t: Teacher, hours: int, keys: list[str], ratio) -> dict:
    grid = {k: v for k, v in (t.dispo or {}).items() if k in keys}          # créneaux encore ouverts dans les horaires
    required = min(len(keys), math.ceil(hours * float(ratio))) if ratio else 0
    return {"id": t.pk, "name": t.user.name, "grid": grid, "updated": t.dispo_at, "hours": hours, "open": len(keys),
            "available": len(keys) - sum(1 for v in grid.values() if v == "x"), "avoid": sum(1 for v in grid.values() if v == "p"), "required": required}


def dispo_payload(teachers, cfg) -> dict:
    hr, hours = current_horaires(), teacher_hours()
    keys = open_keys(hr)
    today = timezone.localdate()
    return {"limite": cfg.dispo_limite, "ratio": float(cfg.dispo_ratio), "closed": bool(cfg.dispo_limite and today > cfg.dispo_limite),
            "teachers": [dispo_row(t, hours.get(t.pk, 0), keys, cfg.dispo_ratio) for t in teachers]}


class DispoView(APIView):
    """GET : disponibilités. L'enseignant voit la sienne, la direction (`edt.write`) celles de tous, avec la date limite et le minimum exigé.
    PUT `{limite, ratio}` (`edt.write`) : date limite de saisie et créneaux disponibles exigés par heure de cours."""

    def get_permissions(self):
        return [permissions.IsAuthenticated()] if self.request.method == "GET" else [perm_required("edt.write")()]

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        u = request.user
        cfg = SchoolSettings.load()
        qs = Teacher.objects.select_related("user").filter(user__is_active=True)
        if u.role == "enseignant":
            qs = qs.filter(user=u)
        elif not has_perm(u, "edt.write"):
            raise PermissionDenied()
        return Response(dispo_payload(qs, cfg))

    @extend_schema(request=inline_serializer("DispoSettings", {"limite": serializers.DateField(allow_null=True), "ratio": serializers.FloatField()}),
                   responses={200: {"type": "object"}})
    def put(self, request):
        cfg = SchoolSettings.load()
        d = request.data
        if "limite" in d:
            v = d.get("limite")
            cfg.dispo_limite = parse_date(v) if v else None
            if v and not cfg.dispo_limite:
                raise ValidationError({"limite": "Date invalide."})
        if "ratio" in d:
            try:
                r = round(float(d["ratio"]), 1)
            except (TypeError, ValueError):
                raise ValidationError({"ratio": "Nombre invalide."}) from None
            if not 0 <= r <= 5:
                raise ValidationError({"ratio": "Choisissez un nombre entre 0 et 5."})
            cfg.dispo_ratio = r
        cfg.save()
        record("Disponibilités", f"Date limite : {cfg.dispo_limite:%d/%m/%Y}" if cfg.dispo_limite else "Sans date limite", request=request)
        return self.get(request)


class DispoDetail(APIView):
    """PUT `{grid: {"jour-créneau": "x" | "p"}}` : les indisponibilités d'un enseignant (toute l'année).
    L'enseignant remplit la sienne jusqu'à la date limite, en gardant le minimum de créneaux disponibles ; la direction peut toujours la corriger."""

    @extend_schema(request=inline_serializer("DispoGrid", {"grid": serializers.DictField(child=serializers.CharField())}), responses={200: {"type": "object"}})
    @transaction.atomic
    def put(self, request, pk):
        u = request.user
        t = Teacher.objects.select_related("user").filter(pk=pk).first()
        if not t:
            raise NotFound()
        staff = has_perm(u, "edt.write")
        if not staff and t.user_id != u.pk:
            raise PermissionDenied()
        cfg = SchoolSettings.load()
        if not staff and cfg.dispo_limite and timezone.localdate() > cfg.dispo_limite:
            raise ValidationError({"detail": f"La saisie des disponibilités est close depuis le {cfg.dispo_limite:%d/%m/%Y}. Adressez-vous à la direction."})
        grid = request.data.get("grid")
        if not isinstance(grid, dict):
            raise ValidationError({"grid": "Disponibilités invalides."})
        keys = set(open_keys(current_horaires()))
        clean = {}
        for k, v in grid.items():
            if v not in ("x", "p", "", None):
                raise ValidationError({"grid": "Chaque créneau est disponible, « plutôt pas » ou indisponible."})
            if k not in keys:
                raise ValidationError({"grid": "Un créneau n’existe pas dans les horaires de l’école."})
            if v:
                clean[k] = v
        row = dispo_row(Teacher(user=t.user, dispo=clean), teacher_hours().get(t.pk, 0), sorted(keys), cfg.dispo_ratio)
        if not staff and row["available"] < row["required"]:
            raise ValidationError({"detail": f"Gardez au moins {row['required']} créneaux disponibles pour vos {row['hours']} h de cours (vous en laissez {row['available']})."})
        t.dispo, t.dispo_at = clean, timezone.now()
        t.save(update_fields=["dispo", "dispo_at"])
        n = sum(1 for v in clean.values() if v == "x")
        if t.user_id != u.pk:
            notify([t.user], "La direction a mis à jour vos disponibilités pour l’emploi du temps.", "systeme", "edt")
        record("Disponibilités", f"{t.user.name} : {n} créneau(x) indisponible(s)", request=request)
        return Response({**row, "id": t.pk, "updated": t.dispo_at, "warning": "" if row["available"] >= row["required"] else
                         f"{t.user.name} ne laisse que {row['available']} créneaux disponibles pour {row['hours']} h de cours."})


class DispoRemind(APIView):
    """POST : rappelle aux enseignants qui n'ont pas encore rempli leurs disponibilités de le faire."""

    permission_classes = [perm_required("edt.write")]

    @extend_schema(request=None, responses={200: {"type": "object"}})
    def post(self, request):
        cfg = SchoolSettings.load()
        late = [t.user for t in Teacher.objects.select_related("user").filter(user__is_active=True, dispo_at__isnull=True)]
        when = f" avant le {cfg.dispo_limite:%d/%m/%Y}" if cfg.dispo_limite else ""
        n = notify(late, f"Indiquez vos disponibilités pour l’emploi du temps{when} : page Emploi du temps, « Mes disponibilités ».", "systeme", "edt")
        record("Disponibilités", f"Rappel envoyé à {n} enseignant(s)", request=request)
        return Response({"sent": n})


# ---------- Salles ----------
class RoomSerializer(serializers.ModelSerializer):
    classes = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = ["id", "name", "capacity", "kind", "classes"]

    def get_classes(self, o) -> list[str]:
        return [c.name for c in o.classes.all()]

    def validate_name(self, v):
        v = v.strip()
        q = Room.objects.filter(name__iexact=v)
        if self.instance:
            q = q.exclude(pk=self.instance.pk)
        if q.exists():
            raise serializers.ValidationError("Une salle porte déjà ce nom.")
        return v


def auto_assign_rooms(reset=False):
    """Donne à chaque classe sans salle une salle de classe libre : les plus grosses classes dans les plus grandes salles."""
    if reset:
        SchoolClass.objects.update(room=None)
    taken = set(SchoolClass.objects.exclude(room=None).values_list("room_id", flat=True))
    free = [r for r in Room.objects.filter(kind="classe").order_by("-capacity", "name") if r.pk not in taken]
    todo = list(SchoolClass.objects.filter(room=None).annotate(n=Count("students")).order_by("-n", "id"))
    done, left = [], []
    for c in todo:
        if free:
            c.room = free.pop(0)
            c.save(update_fields=["room"])
            done.append(c.name)
        else:
            left.append(c.name)
    return done, left


class RoomList(generics.ListCreateAPIView):
    """Salles de l'école. Lecture pour tous les connectés ; création, modification, suppression : `edt.write`."""

    serializer_class = RoomSerializer
    pagination_class = None

    def get_permissions(self):
        return [permissions.IsAuthenticated()] if self.request.method == "GET" else [perm_required("edt.write")()]

    def get_queryset(self):
        return Room.objects.prefetch_related("classes")

    def perform_create(self, ser):
        r = ser.save()
        record("Salle créée", f"{r.name} ({r.capacity} places)", request=self.request)


class RoomDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = RoomSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_permissions(self):
        return [permissions.IsAuthenticated()] if self.request.method == "GET" else [perm_required("edt.write")()]

    def get_queryset(self):
        return Room.objects.prefetch_related("classes")

    def perform_update(self, ser):
        old = ser.instance.name
        r = ser.save()
        if r.name != old:
            Cell.objects.filter(room=old).update(room=r.name)  # les cours déjà placés suivent le nouveau nom
        if r.kind != "classe":
            r.classes.update(room=None)
        record("Salle modifiée", r.name, request=self.request)

    def perform_destroy(self, o):
        n = Cell.objects.filter(room=o.name).count()
        if n and not self.request.query_params.get("force"):
            raise ValidationError({"detail": f"{n} cours sont placés dans {o.name}. Confirmez pour supprimer la salle (les cours gardent son nom).", "code": "salle_utilisee", "cours": n})
        record("Salle supprimée", o.name, request=self.request)
        o.delete()


class RoomAutoView(APIView):
    """Répartit les classes dans les salles de classe : `reset: true` refait toute la répartition."""

    permission_classes = [perm_required("edt.write")]

    @extend_schema(request=None, responses=inline_serializer("RoomAuto", {"assigned": serializers.ListField(child=serializers.CharField()), "left": serializers.ListField(child=serializers.CharField())}))
    @transaction.atomic
    def post(self, request):
        done, left = auto_assign_rooms(bool(request.data.get("reset")))
        record("Salles", f"Répartition automatique : {len(done)} classe(s) placée(s), {len(left)} sans salle", request=request)
        return Response({"assigned": done, "left": left})


class HorairesView(APIView):
    """Horaires de l'école : créneaux, pauses, créneaux ouverts chaque jour. Lecture pour tous, réglage par `edt.write`.
    Si des cours sont placés sur des créneaux qui n'existeraient plus, la modification est refusée (code `cours_invalides`),
    sauf si `retirer: true` est envoyé : ces cours sont alors retirés."""

    def get_permissions(self):
        return [permissions.IsAuthenticated()] if self.request.method == "GET" else [perm_required("edt.write")()]

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        return Response(current_horaires().data)

    @extend_schema(request=None, responses={200: {"type": "object"}})
    @transaction.atomic
    def put(self, request):
        try:
            data = clean_horaires({k: request.data.get(k) for k in ("creneaux", "pauses", "ouverts")})
        except ValueError as e:
            raise ValidationError({"detail": str(e)}) from None
        hr = Horaires(data)
        bad = [c.pk for c in Cell.objects.all() if not hr.is_open(c.day, c.slot)]
        if bad and not request.data.get("retirer"):
            raise ValidationError({"detail": f"{len(bad)} cours sont placés sur des créneaux qui n’existeraient plus avec ces horaires. "
                                             "Confirmez pour les retirer, ou gardez les anciens horaires.",
                                   "code": "cours_invalides", "invalides": len(bad)})
        if bad:
            Cell.objects.filter(pk__in=bad).delete()
        obj = SchoolSettings.load()
        obj.horaires = data
        obj.save(update_fields=["horaires"])
        jours = [f"{DAYS[i]} {n}" for i, n in enumerate(hr.ouverts) if n]
        record("Emploi du temps", f"Horaires modifiés : {len(hr.slots)} créneaux, jours : {', '.join(jours)}" + (f" ; {len(bad)} cours retirés" if bad else ""), request=request)
        return Response({**data, "retires": len(bad)})


# ---------- Cahier de textes ----------
@extend_schema_serializer(component_name="TextbookEntry")
class EntrySerializer(serializers.ModelSerializer):
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    teacher_name = serializers.SerializerMethodField()

    class Meta:
        model = TextEntry
        fields = ["id", "school_class", "subject", "subject_name", "teacher", "teacher_name", "date", "content", "homework", "due"]
        read_only_fields = ["teacher"]
        validators: list = []

    def get_teacher_name(self, o) -> str:
        return o.teacher.user.name if o.teacher else ""

    def validate(self, a):
        today = timezone.localdate()
        if a.get("date") and a["date"] > today:
            raise serializers.ValidationError({"date": "On ne remplit pas le cahier d’une séance à venir."})
        if not (a.get("content") or getattr(self.instance, "content", "")).strip():
            raise serializers.ValidationError({"content": "Décrivez le contenu de la séance."})
        hw = a.get("homework", getattr(self.instance, "homework", ""))
        due = a.get("due", getattr(self.instance, "due", None))
        d = a.get("date", getattr(self.instance, "date", None))
        if hw and not due:
            raise serializers.ValidationError({"due": "Indiquez pour quand le travail est à rendre."})
        if due and d and due < d:
            raise serializers.ValidationError({"due": "La remise ne peut pas précéder la séance."})
        return a


def may_write(user, class_id, subject_id, date=None) -> bool:
    """Le titulaire de la classe et de la matière écrit dans le cahier ; un remplaçant aussi, pour la séance qu'il tient."""
    if not has_perm(user, "cahier.write"):
        return False
    if TeachingAssignment.objects.filter(teacher__user=user, school_class_id=class_id, subject_id=subject_id).exists():
        return True
    return bool(date) and Replacement.objects.filter(teacher__user=user, school_class_id=class_id, subject_id=subject_id, date=date).exists()


def own_entries(user, qs):
    """Cahier d'un enseignant : seulement ses matières dans ses classes (y compris les séances tenues par un remplaçant,
    pour reprendre le fil), plus les séances qu'il a lui-même écrites en remplacement. Jamais les matières de ses collègues."""
    mine = TeachingAssignment.objects.filter(teacher__user=user, school_class_id=OuterRef("school_class_id"), subject_id=OuterRef("subject_id"))
    return qs.filter(Q(Exists(mine)) | Q(teacher__user=user))


def check_cahier_access(user):
    """Le cahier de textes n'est pas montré aux élèves, sauf si l'école l'a décidé (Paramètres)."""
    if user.role == "eleve" and not SchoolSettings.load().eleve_voit_cahier:
        raise PermissionDenied("Le cahier de textes n’est pas ouvert aux élèves par l’école.")


def notify_homework(e: TextEntry):
    if not (e.homework and e.due):
        return
    ids = Student.objects.filter(school_class=e.school_class, active=True).values_list("parent__user_id", flat=True).distinct()
    notify(set(ids), f"Nouveau travail à faire en {e.subject.name} ({e.school_class.name}) pour le {e.due:%d/%m/%Y}.", "annonce", "cahier")


class TextbookList(generics.ListCreateAPIView):
    """GET `?class=&subject=&from=&homework=1` : parents et élèves voient la classe de leurs enfants, un enseignant son propre cahier
    (ses matières dans ses classes), le reste du personnel tout. POST : seul l'enseignant affecté à cette classe et cette matière (une entrée par jour)."""

    serializer_class = EntrySerializer
    pagination_class = BigPages

    def get_permissions(self):
        return [perm_required("cahier.write")()] if self.request.method == "POST" else [permissions.IsAuthenticated()]

    def get_queryset(self):
        u, p = self.request.user, self.request.query_params
        check_cahier_access(u)
        qs = TextEntry.objects.select_related("subject", "teacher__user")
        if u.role in ("parent", "eleve"):
            qs = qs.filter(school_class_id__in=visible_students(u).values("school_class_id"))
        elif u.role == "enseignant":
            qs = own_entries(u, qs)
        elif u.role == "comptable":
            return qs.none()
        for k, f in (("class", "school_class_id"), ("subject", "subject_id")):
            if p.get(k):
                qs = qs.filter(**{f: p[k]})
        if p.get("from"):
            qs = qs.filter(due__gte=p["from"]) if p.get("homework") == "1" else qs.filter(date__gte=p["from"])
        if p.get("homework") == "1":
            qs = qs.exclude(homework="").order_by("due", "subject_id")
        return qs

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if not may_write(request.user, d["school_class"].pk, d["subject"].pk, d["date"]):
            raise PermissionDenied("Vous n’enseignez pas cette matière dans cette classe.")
        if TextEntry.objects.filter(school_class=d["school_class"], subject=d["subject"], date=d["date"]).exists():
            raise ValidationError("Une séance est déjà saisie ce jour-là pour cette matière : modifiez-la.")
        e = ser.save(teacher=Teacher.objects.filter(user=request.user).first())
        notify_homework(e)
        return Response(self.get_serializer(e).data, status=status.HTTP_201_CREATED)


class TextbookLast(APIView):
    """GET `?class=&subject=&before=` : la dernière séance saisie pour cette classe et cette matière — de quoi « reprendre » le cahier
    là où il s'est arrêté (même quand c'est un autre enseignant ou un remplaçant qui l'a rempli)."""

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        p = request.query_params
        if not (p.get("class") and p.get("subject")):
            raise ValidationError("Indiquez la classe et la matière.")
        u = request.user
        if u.role == "enseignant" and not TeachingAssignment.objects.filter(teacher__user=u, school_class_id=p["class"], subject_id=p["subject"]).exists() \
                and not Replacement.objects.filter(teacher__user=u, school_class_id=p["class"], subject_id=p["subject"]).exists():
            raise PermissionDenied()
        if u.role in ("parent", "eleve", "comptable"):
            raise PermissionDenied()
        qs = TextEntry.objects.filter(school_class_id=p["class"], subject_id=p["subject"]).select_related("teacher__user")
        if parse_date(p.get("before") or ""):
            qs = qs.filter(date__lt=parse_date(p["before"]))
        e = qs.order_by("-date").first()
        return Response(EntrySerializer(e).data if e else None)


class TextbookDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = EntrySerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return TextEntry.objects.select_related("subject", "teacher__user", "school_class")

    def get_object(self):
        e = super().get_object()
        u = self.request.user
        check_cahier_access(u)
        if self.request.method in ("PATCH", "DELETE"):
            if not may_write(u, e.school_class_id, e.subject_id, e.date):
                raise PermissionDenied("Vous ne pouvez pas modifier cette séance.")
        elif u.role in ("parent", "eleve") and not visible_students(u).filter(school_class_id=e.school_class_id).exists():
            raise NotFound()
        elif u.role == "enseignant" and not own_entries(u, TextEntry.objects.filter(pk=e.pk)).exists():
            raise NotFound()
        elif u.role == "comptable":
            raise NotFound()
        return e

    def perform_update(self, ser):
        before = (ser.instance.homework, ser.instance.due)
        ser.validated_data.pop("school_class", None)
        ser.validated_data.pop("subject", None)
        ser.validated_data.pop("date", None)
        e = ser.save()
        if e.homework and (e.homework, e.due) != before:
            notify_homework(e)
