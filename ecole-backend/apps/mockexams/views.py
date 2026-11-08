from decimal import Decimal

from django.db import transaction
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import generics, permissions, serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import SchoolClass, Subject, TeachingAssignment
from apps.core.log import record
from apps.core.permissions import has_perm, perm_required
from apps.notifications.services import family_users, notify
from apps.students.models import Student
from apps.students.views import visible_students

from . import calc
from .models import ExamType, MockMark, MockSession


def classes_of(session):
    return list(session.classes.order_by("id"))


COEFS = serializers.DictField(child=serializers.DictField(child=serializers.IntegerField(min_value=0, max_value=20)), required=False)


class SessionSerializer(serializers.ModelSerializer):
    """Une session porte sur un type d'examen de l'école (`exam_type`, ou `type` = son nom) ou sur « AUTRE » (classes et
    coefficients libres). Sans coefficients envoyés, ceux du type d'examen sont repris."""

    classes = serializers.PrimaryKeyRelatedField(many=True, queryset=SchoolClass.objects)
    type = serializers.CharField(max_length=40, required=False, allow_null=True)
    exam_type = serializers.PrimaryKeyRelatedField(queryset=ExamType.objects, allow_null=True, required=False)
    coefs = COEFS

    class Meta:
        model = MockSession
        fields = ["id", "name", "type", "exam_type", "per_serie", "start", "end", "classes", "coefs", "published"]
        read_only_fields = ["published", "per_serie"]

    def validate(self, a):
        if a["end"] < a["start"]:
            raise serializers.ValidationError({"end": "La fin ne peut pas précéder le début."})
        if not a["name"].strip():
            raise serializers.ValidationError({"name": "Le nom est obligatoire."})
        et = a.get("exam_type")
        if et is None and (a.get("type") or "AUTRE").upper() != "AUTRE":
            et = ExamType.objects.filter(name__iexact=a["type"].strip()).first()
            if et is None:
                raise serializers.ValidationError({"type": "Examen inconnu : choisissez un type d’examen de l’école ou « Autre examen »."})
        a["exam_type"] = et
        a["type"] = et.name if et else "AUTRE"
        a["per_serie"] = bool(et and et.per_serie)
        bad = [c.name for c in a["classes"] if not calc.eligible(et, c)]
        if bad:
            raise serializers.ValidationError({"classes": f"Classes non concernées par le {a['type']} : {', '.join(bad)}."})
        if et is None and not a.get("coefs"):
            raise serializers.ValidationError({"coefs": "Indiquez les coefficients des matières évaluées."})
        if not a["classes"]:
            raise serializers.ValidationError({"classes": "Choisissez au moins une classe."})
        coefs = a.get("coefs") or {col: dict(v) for col, v in (et.coefs if et else {}).items()}
        known = set(Subject.objects.values_list("code", flat=True))
        for col in {calc.column_of(a["per_serie"], c, coefs) for c in a["classes"]}:
            table = coefs.get(col)
            if not table or not any(v > 0 for v in table.values()):
                raise serializers.ValidationError({"coefs": f"Coefficients manquants pour {'toutes les classes' if col == '*' else 'la série ' + col}."})
            if set(table) - known:
                raise serializers.ValidationError({"coefs": "Matière inconnue dans les coefficients."})
        a["coefs"] = coefs
        return a


class ExamTypeSerializer(serializers.ModelSerializer):
    coefs = COEFS
    levels = serializers.ListField(child=serializers.CharField(max_length=10), allow_empty=False)
    sessions = serializers.SerializerMethodField()

    class Meta:
        model = ExamType
        fields = ["id", "name", "levels", "per_serie", "coefs", "active", "sessions"]

    def get_sessions(self, obj) -> int:
        return obj.sessions.count()

    def validate_name(self, v):
        v = " ".join(v.split())
        if len(v) < 2:
            raise serializers.ValidationError("Donnez le nom de l’examen (BEPC, BAC, DEF, CEP…).")
        if ExamType.objects.filter(name__iexact=v).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError(f"L’examen « {v} » existe déjà.")
        return v

    def validate_levels(self, v):
        v = list(dict.fromkeys(x.strip() for x in v if x.strip()))
        if not v:
            raise serializers.ValidationError("Choisissez au moins un niveau.")
        return v

    def validate_coefs(self, v):
        known = set(Subject.objects.values_list("code", flat=True))
        out = {}
        for col, table in v.items():
            if set(table) - known:
                raise serializers.ValidationError("Matière inconnue dans les coefficients.")
            kept = {k: n for k, n in table.items() if n > 0}
            if kept:
                out[col.strip().upper() if col != "*" else "*"] = kept
        return out


class ExamTypeList(generics.ListCreateAPIView):
    """Types d'examen de l'école (BEPC, BAC, DEF, CEP…). Lecture : personnel ; création : direction et secrétariat."""

    serializer_class = ExamTypeSerializer
    pagination_class = None
    queryset = ExamType.objects.all()

    def get_permissions(self):
        return [perm_required("examens.write")()] if self.request.method == "POST" else [permissions.IsAuthenticated()]

    def perform_create(self, ser):
        et = ser.save()
        record("Examens blancs", f"Type d’examen ajouté : {et.name} ({', '.join(et.levels)})", request=self.request)


class ExamTypeDetail(generics.RetrieveUpdateDestroyAPIView):
    """PATCH : nom, niveaux, coefficients par défaut, `active` (masquer). Les sessions déjà créées ne changent pas.
    DELETE : seulement si aucune session ne l'utilise (sinon, le masquer)."""

    serializer_class = ExamTypeSerializer
    queryset = ExamType.objects.all()
    permission_classes = [perm_required("examens.write")]
    http_method_names = ["get", "patch", "delete"]

    def perform_update(self, ser):
        et = ser.save()
        record("Examens blancs", f"Type d’examen modifié : {et.name}" + ("" if et.active else " (masqué)"), request=self.request)

    def perform_destroy(self, et):
        n = et.sessions.count()
        if n:
            raise ValidationError(f"« {et.name} » est utilisé par {n} session(s) : masquez-le plutôt, l’historique est conservé.")
        record("Examens blancs", f"Type d’examen retiré : {et.name}", request=self.request)
        et.delete()


def visible_sessions(user):
    qs = MockSession.objects.prefetch_related("classes")
    if user.role in ("parent", "eleve"):
        return qs.filter(published=True, classes__in=visible_students(user).values("school_class_id")).distinct()
    if has_perm(user, "examens.write"):
        return qs
    if user.role == "enseignant":
        return qs.filter(classes__assignments__teacher__user=user).distinct()
    return qs.none()


def can_mark(user, class_id, subject_id) -> bool:
    return has_perm(user, "examens.write") or TeachingAssignment.objects.filter(teacher__user=user, school_class_id=class_id, subject_id=subject_id).exists()


class SessionList(generics.ListCreateAPIView):
    """GET : sessions visibles (famille : publiées seulement). POST : création (direction, secrétariat) ; les enseignants concernés sont prévenus."""

    serializer_class = SessionSerializer
    pagination_class = None

    def get_permissions(self):
        return [perm_required("examens.write")()] if self.request.method == "POST" else [permissions.IsAuthenticated()]

    def get_queryset(self):
        return visible_sessions(self.request.user)

    @transaction.atomic
    def perform_create(self, ser):
        sess = ser.save()
        teachers = set()
        for c in classes_of(sess):
            for sb in calc.subjects_for(sess, c):
                a = TeachingAssignment.objects.filter(school_class=c, subject_id=sb["id"]).select_related("teacher").first()
                if a:
                    teachers.add(a.teacher.user_id)
        notify(teachers, f"Nouvelle session « {sess.name} » : pensez à saisir vos notes avant la publication.", "systeme", "examens")
        record("Examens blancs", f"Session créée : {sess.name} ({sess.type})", request=self.request)


class SessionDetail(APIView):
    @extend_schema(responses=SessionSerializer)
    def get(self, request, pk):
        s = generics.get_object_or_404(visible_sessions(request.user), pk=pk)
        data = SessionSerializer(s).data
        if request.user.role not in ("parent", "eleve"):
            data["progress"] = [{"class": c.pk, "subject": sb["id"], **calc.progress(s, c, sb["id"])} for c in classes_of(s) for sb in calc.subjects_for(s, c)]
        return Response(data)


class ResultsView(APIView):
    """Résultats d'une classe. Le personnel voit toute la classe ; un parent ou un élève, **uniquement** la ligne de son enfant
    (avec les statistiques de la classe), et seulement une fois la session publiée."""

    @extend_schema(responses=inline_serializer("MockResults", {"rows": serializers.ListField()}))
    def get(self, request, pk):
        s = generics.get_object_or_404(visible_sessions(request.user), pk=pk)
        cid = request.query_params.get("class")
        c = generics.get_object_or_404(s.classes, pk=cid) if cid else None
        if c is None:
            raise ValidationError({"class": "Indiquez la classe."})
        if request.user.role == "enseignant" and not has_perm(request.user, "examens.write") and not TeachingAssignment.objects.filter(teacher__user=request.user, school_class=c).exists():
            raise PermissionDenied()
        out = calc.result(s, c)
        if request.user.role in ("parent", "eleve"):
            mine = set(visible_students(request.user).values_list("pk", flat=True))
            out["rows"] = [r for r in out["rows"] if r["student"] in mine]
            if not out["rows"]:
                raise NotFound()
        return Response(out)


class MarksInput(serializers.Serializer):
    school_class = serializers.PrimaryKeyRelatedField(queryset=SchoolClass.objects, source="klass")
    subject = serializers.PrimaryKeyRelatedField(queryset=Subject.objects)
    values = serializers.DictField(child=serializers.DecimalField(max_digits=5, decimal_places=2, allow_null=True))


class MarksView(APIView):
    """Saisie groupée pour (classe, matière) : `values` = {id_élève: note|null}. Verrouillée une fois la session publiée."""

    @extend_schema(request=MarksInput, responses=inline_serializer("MarksSaved", {"saved": serializers.IntegerField()}))
    @transaction.atomic
    def put(self, request, pk):
        s = generics.get_object_or_404(visible_sessions(request.user), pk=pk)
        ser = MarksInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        c, sb = d["klass"], d["subject"]
        if not can_mark(request.user, c.pk, sb.pk):
            raise PermissionDenied("Vous n’enseignez pas cette matière dans cette classe.")
        if s.published:
            raise ValidationError("Les résultats sont publiés : repassez la session en brouillon pour modifier les notes.")
        if not s.classes.filter(pk=c.pk).exists() or sb.pk not in [x["id"] for x in calc.subjects_for(s, c)]:
            raise ValidationError("Cette matière ne fait pas partie de la session pour cette classe.")
        valid = set(Student.objects.filter(school_class=c, active=True).values_list("pk", flat=True))
        vals = {}
        for k, v in d["values"].items():
            if not k.isdigit() or int(k) not in valid:
                raise ValidationError({"values": "Certains élèves n’appartiennent pas à cette classe."})
            if v is not None and not Decimal(0) <= v <= Decimal(20):
                raise ValidationError({"values": "Les notes doivent être comprises entre 0 et 20."})
            vals[int(k)] = v
        for sid, v in vals.items():
            if v is None:
                MockMark.objects.filter(session=s, student_id=sid, subject=sb).delete()
            else:
                MockMark.objects.update_or_create(session=s, student_id=sid, subject=sb, defaults={"value": v.quantize(Decimal("0.01"))})
        record("Examens blancs", f"Notes saisies : {s.name} · {c.name} · {sb.name}", request=request)
        return Response({"saved": len(vals)})


class PublishInput(serializers.Serializer):
    published = serializers.BooleanField()


class PublishView(APIView):
    """Publie les résultats (les familles sont prévenues) ou repasse la session en brouillon."""

    permission_classes = [perm_required("examens.write")]

    @extend_schema(request=PublishInput, responses=SessionSerializer)
    def post(self, request, pk):
        s = generics.get_object_or_404(MockSession, pk=pk)
        ser = PublishInput(data=request.data)
        ser.is_valid(raise_exception=True)
        pub = ser.validated_data["published"]
        if pub == s.published:
            return Response(SessionSerializer(s).data)
        s.published = pub
        s.save(update_fields=["published"])
        if pub:
            users = set()
            for st in Student.objects.filter(school_class__in=s.classes.all(), active=True).select_related("parent__user", "user"):
                users.update(u.pk for u in family_users(st))
            notify(users, f"Les résultats du {s.name} sont disponibles.", "note", "examens")
        record("Examens blancs", f"{'Résultats publiés' if pub else 'Session repassée en brouillon'} : {s.name}", request=request)
        return Response(SessionSerializer(s).data)
