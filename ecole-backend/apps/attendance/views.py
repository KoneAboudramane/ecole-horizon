from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date
from drf_spectacular.utils import extend_schema_serializer, extend_schema, inline_serializer
from rest_framework import generics, serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from collections import defaultdict
from datetime import timedelta

from apps.academics.models import SchoolClass, SchoolSettings, SchoolYear, Teacher, TeachingAssignment, Term
from apps.discipline import conduct
from apps.core.log import record
from apps.core.pagination import BigPages
from apps.core.permissions import has_perm, perm_required
from apps.discipline.scope import educator_scope, educators_of
from apps.notifications.services import family_users, notify
from apps.students.models import Student
from apps.students.views import visible_students

from apps.schedule import lessons as lessons_mod
from apps.schedule.models import Cell

from .models import SLOTS, Absence, AppelSession

SLOT_CODES = [s for s, _ in SLOTS]


def valid_slot(v) -> bool:
    """« Matin » / « Après-midi » (vie scolaire) ou « C1 »… « C9 » : une heure de cours de l'emploi du temps."""
    return v in SLOT_CODES or lessons_mod.slot_of(v) is not None
STAFF_READ = ("appel", "justifs", "discipline", "students.write", "journal")


def slot_label(slot: str) -> str:
    n = lessons_mod.slot_of(slot)
    return slot.lower() if n is None else f"cours {n + 1}"


def fr(d) -> str:
    return d.strftime("%d/%m/%Y")


def term_of(d) -> Term | None:
    """Période qui contient la date (les absences tombées pendant les vacances n'en ont pas)."""
    return Term.objects.filter(start__lte=d, end__gte=d).order_by("-start").first()


def justif_deadline(ab, cfg=None):
    """Dernier jour où la famille peut justifier l'absence (None : l'école n'a pas fixé de délai)."""
    cfg = cfg or SchoolSettings.load()
    return ab.date + timedelta(days=cfg.justif_delai) if cfg.justif_delai else None


def is_late(ab, cfg=None) -> bool:
    dl = justif_deadline(ab, cfg)
    return dl is not None and timezone.localdate() > dl


def check_school_can_justify(user, ab) -> Term | None:
    """Période verrouillée : seule la direction peut encore toucher aux justificatifs."""
    t = term_of(ab.date)
    if t is not None and t.locked and not has_perm(user, "grades.locked"):
        raise PermissionDenied("Cette période est verrouillée : seule la direction peut traiter ce justificatif.")
    return t


def after_decision(ab, term, user):
    """Le retrait de conduite pour absences déjà appliqué à l'élève suit la décision (inutile de relancer la règle)."""
    if term is not None:
        conduct.refresh_absences(ab.student, term, user)


def can_take_appel(user, school_class_id, date=None, slot=None) -> bool:
    """Un enseignant fait l'appel de SON cours : classe, jour et heure doivent figurer à l'emploi du temps (titulaire ou remplaçant).
    Tant que l'école n'a pas d'emploi du temps, il garde l'appel par demi-journée de ses classes."""
    if not has_perm(user, "appel"):
        return False
    if user.role == "educateur":
        from apps.discipline.scope import in_scope
        return in_scope(user, school_class_id)
    if user.role != "enseignant":
        return True
    if date is not None and slot is not None and lessons_mod.slot_of(slot) is not None:
        return lessons_mod.may_teach(user, school_class_id, date, slot)
    if Cell.objects.exists():
        return False
    return TeachingAssignment.objects.filter(teacher__user=user, school_class_id=school_class_id).exists()


class AbsenceSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    class_name = serializers.CharField(source="school_class.name", read_only=True)

    class Meta:
        model = Absence
        fields = ["id", "student", "student_name", "school_class", "class_name", "date", "slot", "status", "justif", "motif"]


@extend_schema_serializer(component_name="AppelEntry")
class EntrySerializer(serializers.Serializer):
    student = serializers.IntegerField()
    status = serializers.ChoiceField(choices=["P", "A", "R"])


class AppelSerializer(serializers.Serializer):
    school_class = serializers.PrimaryKeyRelatedField(queryset=SchoolClass.objects)
    date = serializers.DateField()
    slot = serializers.CharField(max_length=10)
    entries = EntrySerializer(many=True)

    def validate_slot(self, v):
        if not valid_slot(v):
            raise serializers.ValidationError("Créneau inconnu (Matin, Après-midi ou C1, C2…).")
        return v

    def validate_date(self, d):
        if d > timezone.localdate():
            raise serializers.ValidationError("Impossible de faire l’appel d’un jour à venir.")
        return d


class AppelView(APIView):
    """GET `?class=&date=&slot=` : état de l'appel. PUT : enregistre l'appel (remplace le précédent du même créneau)."""

    permission_classes = [perm_required("appel")]

    @extend_schema(responses=inline_serializer("AppelState", {"done": serializers.BooleanField(), "entries": EntrySerializer(many=True)}))
    def get(self, request):
        p = request.query_params
        cid = p.get("class")
        if not (cid and p.get("date") and valid_slot(p.get("slot"))):
            raise ValidationError("Indiquez la classe, la date et le créneau.")
        if not can_take_appel(request.user, int(cid), parse_date(p["date"]), p["slot"]):
            raise PermissionDenied("Ce n’est pas votre cours : l’appel suit l’emploi du temps de la classe.")
        done = AppelSession.objects.filter(school_class_id=cid, date=p["date"], slot=p["slot"]).exists()
        marks = dict(Absence.objects.filter(school_class_id=cid, date=p["date"], slot=p["slot"]).values_list("student_id", "status"))
        students = Student.objects.filter(school_class_id=cid, active=True)
        return Response({"done": done, "entries": [{"student": s.pk, "status": marks.get(s.pk, "P")} for s in students]})

    @extend_schema(request=AppelSerializer, responses=inline_serializer("AppelResult", {"absents": serializers.IntegerField(), "notified": serializers.IntegerField()}))
    @transaction.atomic
    def put(self, request):
        ser = AppelSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        cls = d["school_class"]
        if not can_take_appel(request.user, cls.pk, d["date"], d["slot"]):
            raise PermissionDenied("Ce n’est pas votre cours : l’appel suit l’emploi du temps de la classe.")
        roster = {s.pk: s for s in Student.objects.filter(school_class=cls, active=True)}
        if any(e["student"] not in roster for e in d["entries"]):
            raise ValidationError("Certains élèves n’appartiennent pas à cette classe.")
        previous = {a.student_id: a for a in Absence.objects.filter(school_class=cls, date=d["date"], slot=d["slot"])}
        marks = {e["student"]: e["status"] for e in d["entries"]}
        notified = 0
        for sid, st in marks.items():
            old = previous.get(sid)
            if st == "P":
                if old:
                    old.delete()
                continue
            if old:
                old.status = st
                old.save(update_fields=["status"])  # le justificatif déjà déposé est conservé
            else:
                Absence.objects.create(student=roster[sid], school_class=cls, date=d["date"], slot=d["slot"], status=st)
                if st == "A" and not Absence.objects.filter(student_id=sid, date=d["date"], status="A").exclude(slot=d["slot"]).exists():
                    stu = roster[sid]  # une seule alerte par jour, même si l'élève manque plusieurs cours
                    notify(family_users(stu), f"{stu.prenoms} a été absent(e) le {fr(d['date'])} ({slot_label(d['slot'])}).", "absence", "presences")
                    notified += 1
        AppelSession.objects.update_or_create(school_class=cls, date=d["date"], slot=d["slot"], defaults={"taken_by": request.user})
        absents = sum(1 for v in marks.values() if v == "A")
        record("Appel", f"{cls.name}, {fr(d['date'])} {d['slot']} : {absents} absent(s)", request=request)
        return Response({"absents": absents, "notified": notified})


def visible_absences(user):
    qs = Absence.objects.select_related("student", "school_class")
    if user.role in ("parent", "eleve"):
        return qs.filter(student__in=visible_students(user))
    if user.role == "enseignant":
        return qs.filter(school_class__assignments__teacher__user=user).distinct()
    if user.role == "educateur":
        from apps.discipline.scope import educator_scope
        sc = educator_scope(user)
        return qs if sc is None else qs.filter(school_class_id__in=sc)
    return qs


class AbsenceList(generics.ListAPIView):
    """Absences et retards. Filtres : `student`, `class`, `status` (A/R), `justif`, `from`, `to`."""

    serializer_class = AbsenceSerializer
    pagination_class = BigPages

    def get_permissions(self):
        return [] if getattr(self.request.user, "role", "") in ("parent", "eleve") else [perm_required(*STAFF_READ)()]

    def get_queryset(self):
        p = self.request.query_params
        qs = visible_absences(self.request.user)
        for key, field in (("student", "student_id"), ("class", "school_class_id"), ("status", "status"), ("justif", "justif")):
            if p.get(key):
                qs = qs.filter(**{field: p[key]})
        if p.get("from"):
            qs = qs.filter(date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(date__lte=p["to"])
        return qs


class SessionsView(APIView):
    """Appels effectués (classe, date, créneau), selon les classes visibles. Sert à calculer l'assiduité : `?from=&to=&class=`."""

    @extend_schema(responses=inline_serializer("AppelSessionRow", {"school_class": serializers.IntegerField(), "date": serializers.DateField(), "slot": serializers.CharField()}, many=True))
    def get(self, request):
        u, p = request.user, request.query_params
        qs = AppelSession.objects.all()
        if u.role in ("parent", "eleve"):
            qs = qs.filter(school_class__in=visible_students(u).values("school_class_id"))
        elif u.role == "enseignant":
            qs = qs.filter(school_class__assignments__teacher__user=u).distinct()
        elif not any(has_perm(u, perm) for perm in STAFF_READ):
            raise PermissionDenied()
        elif u.role == "educateur":
            from apps.discipline.scope import educator_scope
            sc = educator_scope(u)
            if sc is not None:
                qs = qs.filter(school_class_id__in=sc)
        if p.get("class"):
            qs = qs.filter(school_class_id=p["class"])
        if p.get("from"):
            qs = qs.filter(date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(date__lte=p["to"])
        return Response(list(qs.values("school_class", "date", "slot")))


class SuiviView(APIView):
    """Suivi des appels (personnel) : `?from=&to=&class=&missing=1`. Une ligne par cours prévu à l'emploi du temps :
    appel fait ou non, par qui et quand, absents et retards. Les appels faits hors emploi du temps (par demi-journée) s'ajoutent.
    Un éducateur à qui des classes sont confiées ne voit que celles-ci."""

    MAX_DAYS = 62

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        from apps.schedule.views import current_horaires
        u, p = request.user, request.query_params
        if u.role in ("parent", "eleve", "enseignant") or not any(has_perm(u, x) for x in STAFF_READ):
            raise PermissionDenied()
        today = timezone.localdate()
        end = min(parse_date(p.get("to") or "") or today, today)
        start = parse_date(p.get("from") or "") or end - timedelta(days=end.weekday())     # par défaut : la semaine en cours
        if start > end:
            raise ValidationError({"from": "La date de début doit précéder la date de fin."})
        if (end - start).days >= self.MAX_DAYS:
            raise ValidationError({"from": f"Choisissez une période de {self.MAX_DAYS} jours au plus."})
        classes = SchoolClass.objects.all()
        sc = educator_scope(u)
        if sc is not None:
            classes = classes.filter(pk__in=sc)
        if p.get("class"):
            classes = classes.filter(pk=p["class"])
        cname = dict(classes.values_list("pk", "name"))
        sessions = {(x.school_class_id, x.date, x.slot): x for x in
                    AppelSession.objects.filter(school_class_id__in=cname, date__range=(start, end)).select_related("taken_by")}
        counts = defaultdict(lambda: {"A": 0, "R": 0})
        for c, d, sl, st in Absence.objects.filter(school_class_id__in=cname, date__range=(start, end)).values_list("school_class_id", "date", "slot", "status"):
            counts[(c, d, sl)][st] += 1
        terms = list(Term.objects.filter(year=SchoolYear.get_current()))
        teachers = {t.pk: t.user.name for t in Teacher.objects.select_related("user")}
        hr = current_horaires()

        def row(k, class_name, subject="", start_t="", end_t="", teacher=""):
            ses, n = sessions.get(k), counts.get(k, {"A": 0, "R": 0})
            return {"date": k[1], "school_class": k[0], "class_name": class_name, "slot": k[2], "subject_name": subject, "start": start_t, "end": end_t,
                    "teacher_name": teacher, "done": ses is not None, "taken_by": ses.taken_by.name if ses and ses.taken_by else "",
                    "taken_at": ses.taken_at if ses else None, "absents": n["A"], "retards": n["R"]}

        rows, seen, d = [], set(), start
        while d <= end:
            if not terms or any(t.start <= d <= t.end for t in terms):          # vacances : aucun cours attendu
                for x in lessons_mod.lessons(d, hr):
                    if x["school_class"] in cname:
                        k = (x["school_class"], d, x["code"])
                        seen.add(k)
                        rows.append(row(k, x["class_name"], x["subject_name"], x["start"], x["end"], teachers.get(x["teacher"], "")))
            d += timedelta(days=1)
        rows += [row(k, cname[k[0]]) for k in sessions if k not in seen]
        if p.get("missing") in ("1", "true"):
            rows = [r for r in rows if not r["done"]]
        rows.sort(key=lambda r: (r["start"] or r["slot"], r["class_name"]))
        rows.sort(key=lambda r: r["date"], reverse=True)                            # jours récents d'abord, heures dans l'ordre
        return Response({"from": start, "to": end, "rows": rows})


class JustifyInput(serializers.Serializer):
    motif = serializers.CharField(min_length=3, max_length=300)


class JustifyView(APIView):
    """La famille dépose un justificatif (motif) pour une absence → « en attente »."""

    @extend_schema(request=JustifyInput, responses=AbsenceSerializer)
    def post(self, request, pk):
        if request.user.role not in ("parent", "eleve"):
            raise PermissionDenied("Seuls les parents et les élèves déposent un justificatif.")
        ab = generics.get_object_or_404(visible_absences(request.user), pk=pk)
        if ab.status != "A":
            raise ValidationError("Seules les absences se justifient (pas les retards).")
        if ab.justif in ("en_attente", "acceptee"):
            raise ValidationError("Cette absence a déjà un justificatif.")
        t = term_of(ab.date)
        if t is not None and t.locked:
            raise ValidationError("Cette période est verrouillée : adressez-vous à l’école.")
        cfg = SchoolSettings.load()
        if is_late(ab, cfg):
            raise ValidationError(f"Le délai de justification ({cfg.justif_delai} jour(s)) est dépassé depuis le {fr(justif_deadline(ab, cfg))} : adressez-vous à l’école.")
        ser = JustifyInput(data=request.data)
        ser.is_valid(raise_exception=True)
        ab.justif, ab.motif = "en_attente", ser.validated_data["motif"].strip()
        ab.save(update_fields=["justif", "motif"])
        notify(educators_of(ab.school_class_id), f"Justificatif d’absence reçu pour {ab.student.full_name}.", "absence", "presences")
        record("Justificatif", f"Justificatif envoyé pour {ab.student.full_name}", request=request)
        return Response(AbsenceSerializer(ab).data)


@extend_schema_serializer(component_name="AbsenceDecideInput")
class DecideInput(serializers.Serializer):
    accept = serializers.BooleanField()


class DecideJustifView(APIView):
    """Éducateur ou direction : accepte ou refuse un justificatif en attente."""

    permission_classes = [perm_required("justifs")]

    @extend_schema(request=DecideInput, responses=AbsenceSerializer)
    def post(self, request, pk):
        ab = generics.get_object_or_404(visible_absences(request.user).select_related("student__parent__user", "student__user"), pk=pk)
        if ab.justif != "en_attente":
            raise ValidationError("Aucun justificatif en attente pour cette absence.")
        t = check_school_can_justify(request.user, ab)
        ser = DecideInput(data=request.data)
        ser.is_valid(raise_exception=True)
        ok = ser.validated_data["accept"]
        ab.justif = "acceptee" if ok else "refusee"
        ab.save(update_fields=["justif"])
        after_decision(ab, t, request.user)
        notify(family_users(ab.student), f"Le justificatif d’absence de {ab.student.prenoms} a été {'accepté' if ok else 'refusé'}.", "absence", "presences")
        record("Justificatif", f"{'Accepté' if ok else 'Refusé'} : {ab.student.full_name}", request=request)
        return Response(AbsenceSerializer(ab).data)


class RecordJustifView(APIView):
    """Éducateur ou direction : enregistre un justificatif apporté à l'école (certificat papier…), accepté d'office.
    Possible même après le délai laissé aux familles ; le journal le signale « hors délai »."""

    permission_classes = [perm_required("justifs")]

    @extend_schema(request=JustifyInput, responses=AbsenceSerializer)
    def post(self, request, pk):
        ab = generics.get_object_or_404(visible_absences(request.user).select_related("student__parent__user", "student__user"), pk=pk)
        if ab.status != "A":
            raise ValidationError("Seules les absences se justifient (pas les retards).")
        if ab.justif == "acceptee":
            raise ValidationError("Cette absence est déjà justifiée.")
        t = check_school_can_justify(request.user, ab)
        ser = JustifyInput(data=request.data)
        ser.is_valid(raise_exception=True)
        late = is_late(ab)
        ab.justif, ab.motif = "acceptee", ser.validated_data["motif"].strip()
        ab.save(update_fields=["justif", "motif"])
        after_decision(ab, t, request.user)
        notify(family_users(ab.student), f"L’absence de {ab.student.prenoms} du {fr(ab.date)} a été justifiée par l’école.", "absence", "presences")
        record("Justificatif", f"Saisi par l’école{' (hors délai)' if late else ''} : {ab.student.full_name}, {fr(ab.date)}", request=request)
        return Response(AbsenceSerializer(ab).data)


class SummaryView(APIView):
    """Bilan d'un élève : absences, absences justifiées, justificatifs en attente, retards."""

    @extend_schema(responses=inline_serializer("AttendanceSummary", {"absences": serializers.IntegerField()}))
    def get(self, request, pk):
        stu = generics.get_object_or_404(Student, pk=pk)
        u = request.user
        if u.role in ("parent", "eleve"):
            if not visible_students(u).filter(pk=pk).exists():
                raise NotFound()
        elif not (has_perm(u, "appel") and can_take_appel(u, stu.school_class_id)) and not any(has_perm(u, p) for p in STAFF_READ if p != "appel"):
            raise PermissionDenied()
        qs = Absence.objects.filter(student=stu)
        a = qs.filter(status="A")
        return Response({"absences": a.count(), "justified": a.filter(justif="acceptee").count(),
                         "pending": a.filter(justif="en_attente").count(), "lates": qs.filter(status="R").count()})
