from django.db import transaction
from django.db.models import Count, Q
from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import generics, permissions, serializers, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.log import record
from apps.core.permissions import has_perm, perm_required

from . import repartition
from .models import Coefficient, Cursus, Level, SchoolClass, SchoolSettings, SchoolYear, Serie, Subject, Teacher, TeachingAssignment, Term, level_names, valid_groupes
from .serializers import (AssignmentSerializer, ClassSerializer, CoefficientSerializer, CoefficientSetSerializer,
                          SettingsSerializer, SubjectSerializer, TeacherSerializer, TermSerializer, YearSerializer, SerieSerializer, LevelSerializer)


class ReadAllWriteWith:
    """Lecture pour tout compte connecté ; écriture réservée aux permissions données."""

    write_perms: tuple = ()

    def get_permissions(self):
        if self.request.method in permissions.SAFE_METHODS:
            return [permissions.IsAuthenticated()]
        return [perm_required(*self.write_perms)()]


class CursusList(APIView):
    """Cursus de l'école (français par défaut ; arabe ou autre ajouté par l'administrateur de la plateforme), dans l'ordre."""

    @extend_schema(responses=inline_serializer("Cursus", {"id": serializers.IntegerField(), "nom": serializers.CharField(), "langue": serializers.CharField()}, many=True))
    def get(self, request):
        from apps.accounts.perimetre import allowed_cursus
        allowed = allowed_cursus(request.user)       # le personnel ne voit que les cursus de son périmètre
        qs = Cursus.objects.all() if allowed is None else Cursus.objects.filter(pk__in=allowed)
        return Response([{"id": c.pk, "nom": c.nom, "langue": c.langue, "rtl": c.rtl, "nom_ecole": c.nom_ecole} for c in qs])


class CursusClasses(APIView):
    """Classes et niveaux d'un cursus de l'école (pour inscrire un élève dans un autre cursus que celui affiché)."""

    permission_classes = [perm_required("students.write")]

    def get(self, request, pk):
        from apps.core.tenancy import cursus_context
        from apps.students.services import class_free_places
        c = generics.get_object_or_404(Cursus, pk=pk)
        with cursus_context(c):
            classes = [{"id": k.pk, "name": k.name, "level": k.level, "free": class_free_places(k)} for k in SchoolClass.objects.order_by("name")]
            levels = list(Level.objects.values_list("name", flat=True))
        return Response({"classes": classes, "levels": levels})


@extend_schema(responses=inline_serializer("Calendar", {"year": YearSerializer(), "terms": TermSerializer(many=True)}))
class CalendarView(APIView):
    """Année en cours et trimestres."""

    def get(self, request):
        y = SchoolYear.get_current()
        return Response({
            "year": YearSerializer(y).data if y else None,
            "terms": TermSerializer(y.terms.all(), many=True).data if y else [],
        })


class PeriodesView(APIView):
    """PUT `{periodes: [{label, start, end, coef}]}` : périodes d'évaluation de l'année en cours (trimestres, semestres ou autre), propres à l'école.

    Les périodes existantes sont conservées dans l'ordre (leurs notes aussi) ; on peut en ajouter ou en retirer à la fin.
    Retirer une période qui a déjà des évaluations, des appréciations ou des avis du conseil est refusé."""

    permission_classes = [perm_required("settings")]
    MAX = 6

    @extend_schema(request=inline_serializer("PeriodesIn", {"periodes": serializers.ListField()}), responses=TermSerializer(many=True))
    def put(self, request):
        from datetime import date

        from apps.grades.models import Appreciation, CouncilComment, Evaluation
        y = SchoolYear.get_current()
        if y is None:
            raise ValidationError("Aucune année scolaire n’est ouverte.")
        rows = request.data.get("periodes")
        if not isinstance(rows, list) or not 1 <= len(rows) <= self.MAX:
            raise ValidationError(f"Indiquez entre 1 et {self.MAX} périodes.")
        clean, prev_end = [], None
        for i, r in enumerate(rows, 1):
            r = r if isinstance(r, dict) else {}
            label = str(r.get("label", "")).strip()[:40]
            try:
                a, b = date.fromisoformat(str(r.get("start"))), date.fromisoformat(str(r.get("end")))
            except ValueError:
                raise ValidationError(f"Période {i} : indiquez une date de début et une date de fin.") from None
            if not label:
                raise ValidationError(f"Période {i} : donnez-lui un nom (1er trimestre, 1er semestre…).")
            if a >= b:
                raise ValidationError(f"Période {i} : la fin doit être après le début.")
            if prev_end and a <= prev_end:
                raise ValidationError(f"Période {i} : elle commence avant la fin de la précédente.")
            prev_end = b
            try:
                coef = int(r.get("coef") if r.get("coef") not in (None, "") else (1 if i == 1 else 2))
            except (TypeError, ValueError):
                coef = 0
            if not 1 <= coef <= 9:
                raise ValidationError(f"Période {i} : le coefficient doit être un nombre entier de 1 à 9.")
            clean.append((label, a, b, coef))
        if len({c[0].lower() for c in clean}) != len(clean):
            raise ValidationError("Deux périodes portent le même nom.")
        existing = list(y.terms.order_by("start", "code"))
        with transaction.atomic():
            for old in existing[len(clean):]:
                n = Evaluation.objects.filter(term=old).count() + Appreciation.objects.filter(term=old).count() + CouncilComment.objects.filter(term=old).count()
                if n:
                    raise ValidationError(f"La période « {old.label} » a déjà des évaluations ou des avis enregistrés : elle ne peut pas être retirée.")
                old.delete()
            taken = {t.code for t in existing[:len(clean)]}
            for i, (label, a, b, coef) in enumerate(clean):
                if i < len(existing):
                    t = existing[i]
                    t.label, t.start, t.end, t.coef = label, a, b, coef
                    t.save(update_fields=["label", "start", "end", "coef"])
                else:
                    n = 1
                    while f"P{n}" in taken or f"T{n}" in taken:
                        n += 1
                    taken.add(f"P{n}")
                    Term.objects.create(year=y, code=f"P{n}", label=label, start=a, end=b, coef=coef)
        record("Périodes d'évaluation", " · ".join(f"{c[0]} (coef. {c[3]})" for c in clean), request=request)
        return Response(TermSerializer(y.terms.all(), many=True).data)


@extend_schema(request=inline_serializer("TermLock", {"locked": serializers.BooleanField()}), responses=TermSerializer)
class TermLockView(APIView):
    """Clôture / réouverture d’une période d’évaluation : la clôture fige les notes (réservé à qui a `grades.locked`)."""

    permission_classes = [perm_required("grades.locked")]

    def post(self, request, pk):
        term = generics.get_object_or_404(Term, pk=pk)
        term.locked = bool(request.data.get("locked", True))
        term.save(update_fields=["locked"])
        record("Période clôturée" if term.locked else "Période rouverte", term.label, request=request)
        return Response(TermSerializer(term).data)


class SubjectViewSet(ReadAllWriteWith, viewsets.ModelViewSet):
    write_perms = ("subjects.write",)
    serializer_class = SubjectSerializer
    pagination_class = None

    def get_queryset(self):
        return Subject.objects.all()

    def perform_create(self, ser):
        obj = ser.save()
        record("Matière créée", obj.name, request=self.request)

    def perform_update(self, ser):
        obj = ser.save()
        record("Matière modifiée", obj.name, request=self.request)

    def perform_destroy(self, obj):
        if obj.assignments.exists():
            raise ValidationError("Cette matière est affectée à des enseignants : retirez d’abord les affectations.")
        # La suppression en cascade effacerait notes, cours placés et examens : on l'interdit dès qu'il y a des données.
        from apps.grades.models import Appreciation
        from apps.mockexams.models import MockMark
        from apps.schedule.models import Cell, TextEntry

        used = obj.evaluations.exists() or Cell.objects.filter(subject=obj).exists() or TextEntry.objects.filter(subject=obj).exists() \
            or Appreciation.objects.filter(subject=obj).exists() or MockMark.objects.filter(subject=obj).exists()
        if used:
            raise ValidationError("Cette matière a déjà des notes, des cours ou des séances enregistrés : elle ne peut plus être supprimée. Mettez son coefficient à 0 pour la retirer des bulletins.")
        record("Matière supprimée", obj.name, request=self.request)
        obj.delete()


class ClassViewSet(ReadAllWriteWith, viewsets.ModelViewSet):
    write_perms = ("classes.write",)
    serializer_class = ClassSerializer
    pagination_class = None

    def get_queryset(self):
        qs = SchoolClass.objects.select_related("prof_principal__user").annotate(n_students=Count("students", filter=Q(students__active=True)))
        u = self.request.user
        if u.role == "eleve":
            return qs.filter(students__user=u)
        if u.role == "parent":
            return qs.filter(students__parent__user=u).distinct()
        return qs

    def perform_create(self, ser):
        obj = ser.save()
        record("Classe créée", obj.name, request=self.request)

    def perform_update(self, ser):
        obj = ser.save()
        record("Classe modifiée", obj.name, request=self.request)

    def perform_destroy(self, obj):
        if obj.students.exists():
            raise ValidationError("Cette classe contient des élèves : transférez-les avant de la supprimer.")
        record("Classe supprimée", obj.name, request=self.request)
        obj.delete()


class PrincipalSetView(APIView):
    """PUT `{teacher: id | null}` : attribue (ou retire) le professeur principal d'une classe. Direction et secrétariat,
    comme la répartition des enseignants. L'enseignant est prévenu."""

    def get_permissions(self):
        return [perm_required("classes.write", "subjects.write")()]

    @extend_schema(request={"application/json": {"type": "object", "properties": {"teacher": {"type": "integer", "nullable": True}}}},
                   responses=ClassSerializer)
    def put(self, request, pk):
        from apps.notifications.services import notify
        cl = generics.get_object_or_404(SchoolClass.objects.select_related("prof_principal__user"), pk=pk)
        tid = request.data.get("teacher")
        teacher = None
        if tid not in (None, ""):
            teacher = Teacher.objects.select_related("user").filter(pk=tid).first()
            if teacher is None:
                raise ValidationError({"teacher": "Enseignant inconnu."})
            if not teacher.user.is_active:
                raise ValidationError({"teacher": "Ce compte enseignant est désactivé."})
        before = cl.prof_principal
        cl.prof_principal = teacher
        cl.save(update_fields=["prof_principal"])
        if teacher and teacher != before:
            notify([teacher.user_id], f"Vous êtes professeur principal de la {cl.name}.", "systeme", "maclasse")
        record("Professeur principal", f"{cl.name} : {teacher.user.name if teacher else 'aucun'}", request=request)
        cl.n_students = cl.students.filter(active=True).count()
        return Response(ClassSerializer(cl).data)


class LevelList(APIView):
    """GET : niveaux de l'école dans l'ordre du cursus. POST `{name, cycle, has_series, after?}` : ajoute un niveau (à la fin,
    ou après le niveau `after`). Direction et secrétariat."""

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.IsAuthenticated()]
        return [perm_required("settings", "classes.write")()]

    @extend_schema(responses=LevelSerializer(many=True))
    def get(self, request):
        return Response(LevelSerializer(Level.objects.all(), many=True).data)

    @extend_schema(request=LevelSerializer, responses=LevelSerializer)
    @transaction.atomic
    def post(self, request):
        ser = LevelSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        names = level_names()
        after = str(request.data.get("after") or "")
        pos = names.index(after) + 1 if after in names else len(names)
        names.insert(pos, ser.validated_data["name"])
        lv = ser.save(order=pos)
        _reorder(names)
        record("Niveau ajouté", f"{lv.name} ({lv.get_cycle_display()}{', à séries' if lv.has_series else ''})", request=request)
        return Response(LevelSerializer(Level.objects.get(pk=lv.pk)).data, status=status.HTTP_201_CREATED)


def _reorder(names: list[str]) -> None:
    for i, n in enumerate(names):
        Level.objects.filter(name=n).update(order=i)


def _level_used(lv) -> list[str]:
    from apps.students.models import Enrollment
    used = list(SchoolClass.objects.filter(level=lv.name).values_list("name", flat=True))
    if Enrollment.objects.filter(level=lv.name, school_class__isnull=True, year__current=True).exists():
        used.append("des élèves à placer")
    return used


class LevelDetail(APIView):
    """PATCH `{name?, cycle?, has_series?}` : le nom et les séries ne changent que si aucune classe n'utilise le niveau ;
    le cycle change toujours (ses classes suivent). DELETE : retire un niveau inutilisé, avec ses séries et coefficients."""

    def get_permissions(self):
        return [perm_required("settings", "classes.write")()]

    @extend_schema(request=LevelSerializer, responses=LevelSerializer)
    @transaction.atomic
    def patch(self, request, pk):
        lv = generics.get_object_or_404(Level, pk=pk)
        ser = LevelSerializer(lv, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        used = _level_used(lv)
        if used and (("name" in d and d["name"] != lv.name) or ("has_series" in d and d["has_series"] != lv.has_series)):
            raise ValidationError(f"Le niveau {lv.name} est utilisé ({', '.join(used)}) : seul son cycle peut changer.")
        old = lv.name
        lv = ser.save()
        if lv.name != old:      # niveau inutilisé : ses séries, coefficients, tarifs et règles suivent le nouveau nom
            from apps.finance.models import Tarif
            Serie.objects.filter(level=old).update(level=lv.name)
            Coefficient.objects.filter(groupe=old).update(groupe=lv.name)
            for c in Coefficient.objects.filter(groupe__startswith=old + " "):
                c.groupe = lv.name + c.groupe[len(old):]
                c.save(update_fields=["groupe"])
            Tarif.objects.filter(level=old).update(level=lv.name)
            cfg = SchoolSettings.load()
            if old in (cfg.passage_niveaux or {}):
                cfg.passage_niveaux[lv.name] = cfg.passage_niveaux.pop(old)
                cfg.save(update_fields=["passage_niveaux"])
        if not lv.has_series:
            for sr in Serie.objects.filter(level=lv.name):
                Coefficient.objects.filter(groupe=sr.groupe).delete()
                sr.delete()
        SchoolClass.objects.filter(level=lv.name).update(cycle=lv.cycle)
        record("Niveau modifié", f"{old} → {lv.name}" if old != lv.name else lv.name, request=request)
        return Response(LevelSerializer(lv).data)

    @transaction.atomic
    def delete(self, request, pk):
        lv = generics.get_object_or_404(Level, pk=pk)
        used = _level_used(lv)
        if used:
            raise ValidationError(f"Le niveau {lv.name} est utilisé ({', '.join(used)}) : déplacez d’abord ces classes ou élèves.")
        for sr in Serie.objects.filter(level=lv.name):
            Coefficient.objects.filter(groupe=sr.groupe).delete()
            sr.delete()
        Coefficient.objects.filter(groupe=lv.name).delete()
        record("Niveau retiré", lv.name, request=request)
        lv.delete()
        _reorder(level_names())
        return Response(status=status.HTTP_204_NO_CONTENT)


class LevelOrder(APIView):
    """POST `{names: [...]}` : nouvel ordre du cursus (tous les niveaux, chacun une fois). Le passage suit cet ordre."""

    permission_classes = [perm_required("settings", "classes.write")]

    @extend_schema(request=inline_serializer("LevelOrderIn", {"names": serializers.ListField(child=serializers.CharField())}), responses=LevelSerializer(many=True))
    @transaction.atomic
    def post(self, request):
        names = request.data.get("names")
        if not isinstance(names, list) or sorted(names) != sorted(level_names()):
            raise ValidationError("Donnez chaque niveau de l’école une fois.")
        _reorder(names)
        record("Ordre des niveaux", " → ".join(names), request=request)
        return Response(LevelSerializer(Level.objects.all(), many=True).data)


class SerieList(APIView):
    """GET : séries du lycée de l'école. POST `{level, code, name?, copy_from?}` : ajoute une série ; `copy_from` (un groupe,
    ex. « Tle C ») recopie ses coefficients. Direction et secrétariat."""

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.IsAuthenticated()]
        return [perm_required("settings", "subjects.write", "classes.write")()]

    @extend_schema(responses=SerieSerializer(many=True))
    def get(self, request):
        return Response(SerieSerializer(Serie.objects.all(), many=True).data)

    @extend_schema(request=SerieSerializer, responses=SerieSerializer)
    @transaction.atomic
    def post(self, request):
        ser = SerieSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if Serie.objects.filter(level=d["level"], code=d["code"]).exists():
            raise ValidationError({"code": f"La série {d['code']} existe déjà en {d['level']}."})
        sr = ser.save()
        src = str(request.data.get("copy_from") or "")
        if src:
            if src not in valid_groupes():
                raise ValidationError({"copy_from": "Groupe à recopier inconnu."})
            Coefficient.objects.bulk_create([Coefficient(groupe=sr.groupe, subject_id=c.subject_id, value=c.value) for c in Coefficient.objects.filter(groupe=src)])
        record("Série ajoutée", f"{sr.groupe}" + (f" (coefficients de {src})" if src else ""), request=request)
        return Response(SerieSerializer(sr).data, status=status.HTTP_201_CREATED)


class SerieDetail(APIView):
    """PATCH `{name?, code?}` : renomme (le code seulement si aucune classe ne l'utilise). DELETE : retire une série inutilisée."""

    def get_permissions(self):
        return [perm_required("settings", "subjects.write", "classes.write")()]

    def _used(self, sr) -> list[str]:
        return list(SchoolClass.objects.filter(level=sr.level, serie=sr.code).values_list("name", flat=True))

    @extend_schema(request=SerieSerializer, responses=SerieSerializer)
    @transaction.atomic
    def patch(self, request, pk):
        sr = generics.get_object_or_404(Serie, pk=pk)
        ser = SerieSerializer(sr, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        d.pop("level", None)
        old = sr.groupe
        if "code" in d and d["code"] != sr.code:
            used = self._used(sr)
            if used:
                raise ValidationError({"code": f"Le code ne peut plus changer : la série est utilisée par {', '.join(used)}. Vous pouvez changer son nom."})
            if Serie.objects.filter(level=sr.level, code=d["code"]).exists():
                raise ValidationError({"code": f"La série {d['code']} existe déjà en {sr.level}."})
        sr = ser.save()
        if sr.groupe != old:
            Coefficient.objects.filter(groupe=old).update(groupe=sr.groupe)
        record("Série modifiée", f"{old} → {sr.groupe}" + (f" · {sr.name}" if sr.name else ""), request=request)
        return Response(SerieSerializer(sr).data)

    @transaction.atomic
    def delete(self, request, pk):
        sr = generics.get_object_or_404(Serie, pk=pk)
        used = self._used(sr)
        if used:
            raise ValidationError(f"La série {sr.groupe} est utilisée par {', '.join(used)} : changez d’abord la série de ces classes.")
        Coefficient.objects.filter(groupe=sr.groupe).delete()
        record("Série retirée", sr.groupe, request=request)
        sr.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(request=CoefficientSetSerializer, responses=CoefficientSerializer(many=True))
class CoefficientView(APIView):
    """GET : tous les coefficients. PUT : fixe un coefficient (0 = la matière n'est plus enseignée à ce groupe)."""

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.IsAuthenticated()]
        return [perm_required("subjects.write")()]

    def get(self, request):
        return Response(CoefficientSerializer(Coefficient.objects.select_related("subject"), many=True).data)

    def put(self, request):
        ser = CoefficientSetSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if d["value"] > 0:
            Coefficient.objects.update_or_create(groupe=d["groupe"], subject=d["subject"], defaults={"value": d["value"]})
        else:
            Coefficient.objects.filter(groupe=d["groupe"], subject=d["subject"]).delete()
        record("Coefficient modifié", f"{d['subject'].name} · {d['groupe']} → {d['value']}", request=request)
        return Response({"groupe": d["groupe"], "subject": d["subject"].pk, "value": d["value"]})


class TeacherListView(generics.ListAPIView):
    """Enseignants. Les fiches sont créées automatiquement avec le compte (rôle « enseignant »)."""

    serializer_class = TeacherSerializer
    pagination_class = None

    def get_permissions(self):
        return [perm_required(*[p for p in ("classes.write", "subjects.write", "settings", "accounts", "appel", "journal", "discipline")])()]

    def get_queryset(self):
        return Teacher.objects.select_related("user").prefetch_related("subjects").filter(user__is_active=True)


class TeacherDetailView(generics.RetrieveUpdateAPIView):
    """Matières enseignées par un enseignant (secrétariat et direction)."""

    serializer_class = TeacherSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        return Teacher.objects.select_related("user").prefetch_related("subjects")

    def get_permissions(self):
        return [perm_required("classes.write", "subjects.write")()]

    def perform_update(self, ser):
        t = ser.save()
        record("Enseignant modifié", t.user.name, request=self.request)


@extend_schema(request=AssignmentSerializer, responses=AssignmentSerializer(many=True))
class AssignmentView(APIView):
    """GET : affectations (`?class=`). PUT : affecte un enseignant à (classe, matière) ; `teacher: null` retire l'affectation."""

    def get_permissions(self):
        if self.request.method == "GET":
            return [perm_required(*[p for p in ("classes.write", "subjects.write", "appel", "journal", "discipline", "settings")])()]
        return [perm_required("classes.write", "subjects.write")()]

    def get(self, request):
        qs = TeachingAssignment.objects.all()
        if request.query_params.get("class"):
            qs = qs.filter(school_class_id=request.query_params["class"])
        if request.user.role == "enseignant":
            qs = qs.filter(teacher__user=request.user)
        return Response(AssignmentSerializer(qs, many=True).data)

    def put(self, request):
        ser = AssignmentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        cls, subj, teacher = d["school_class"], d["subject"], d["teacher"]
        if not Coefficient.objects.filter(groupe=cls.groupe, subject=subj).exists():
            raise ValidationError("Cette matière n’est pas enseignée à ce groupe de classes (coefficient absent).")
        if teacher is None:
            TeachingAssignment.objects.filter(school_class=cls, subject=subj).delete()
            record("Affectation retirée", f"{cls.name} · {subj.name}", request=request)
            return Response(status=status.HTTP_204_NO_CONTENT)
        obj, _ = TeachingAssignment.objects.update_or_create(school_class=cls, subject=subj, defaults={"teacher": teacher})
        teacher.subjects.add(subj)
        record("Affectation", f"{teacher.user.name} → {cls.name} · {subj.name}", request=request)
        return Response(AssignmentSerializer(obj).data)


class RepartitionView(APIView):
    """Répartition des enseignants entre les classes.
    GET : charge de chaque enseignant (heures par semaine, classes, maximum) et, par matière, les classes sans enseignant.
    POST `{subjects?: [id], reset?: bool, commit?: bool}` : propose (ou, avec `commit`, enregistre) une répartition équilibrée."""

    def get_permissions(self):
        return [perm_required("classes.write", "subjects.write")()]

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        ld = repartition.loads()
        coef = {(c.groupe, c.subject_id): c.value for c in Coefficient.objects.all()}
        classes = list(SchoolClass.objects.all())
        taught = {(a.school_class_id, a.subject_id): a.teacher_id for a in TeachingAssignment.objects.all()}
        teachers = [{"id": t.pk, "name": t.user.name, "subject_ids": [s.pk for s in t.subjects.all()], "max_hours": t.max_hours,
                     **ld.get(t.pk, {"hours": 0, "classes": 0})}
                    for t in Teacher.objects.select_related("user").prefetch_related("subjects").filter(user__is_active=True)]
        subjects = []
        for s in Subject.objects.all():
            cl = [c for c in classes if (c.groupe, s.pk) in coef]
            if not cl:
                continue
            subjects.append({"id": s.pk, "name": s.name, "teachers": sum(1 for t in teachers if s.pk in t["subject_ids"]),
                             "classes": [{"id": c.pk, "name": c.name, "teacher": taught.get((c.pk, s.pk)),
                                          "hours": repartition.weekly_hours(s.code, coef[(c.groupe, s.pk)])} for c in cl]})
        return Response({"teachers": teachers, "subjects": subjects})

    @extend_schema(request=None, responses={200: {"type": "object"}})
    @transaction.atomic
    def post(self, request):
        ids = request.data.get("subjects") or None
        reset = bool(request.data.get("reset"))
        items, missing = repartition.plan(ids, reset)
        if request.data.get("commit"):
            if reset:
                qs = TeachingAssignment.objects.all()
                if ids:
                    qs = qs.filter(subject_id__in=ids)
                qs.delete()
            for it in items:
                TeachingAssignment.objects.update_or_create(school_class_id=it["school_class"], subject_id=it["subject"], defaults={"teacher_id": it["teacher"]})
            record("Répartition des enseignants", f"{len(items)} affectation(s) enregistrée(s), {len(missing)} sans enseignant", request=request)
        return Response({"assignments": items, "missing": missing, "committed": bool(request.data.get("commit"))})


class PublicSchoolView(APIView):
    """Identité de l'école pour l'écran de connexion (nom, logo, couleur) : volontairement publique, rien de confidentiel."""

    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []

    @extend_schema(responses=inline_serializer("PublicSchool", {"name": serializers.CharField(), "logo": serializers.CharField(), "hue": serializers.IntegerField(), "code": serializers.CharField(), "multi": serializers.BooleanField()}))
    def get(self, request):
        from apps.core.models import Etablissement
        from apps.core.tenancy import tenant_context
        code = request.query_params.get("ecole", "").strip().lower()
        if code:
            etab = Etablissement.objects.filter(code=code, actif=True).first()
        else:
            actifs = list(Etablissement.objects.filter(actif=True)[:2])
            etab = actifs[0] if len(actifs) == 1 else None
        from apps.core.accueil import public_accueil
        accueil = public_accueil(request)                          # page d'accueil : commune à toutes les écoles, gérée par la plateforme
        if etab is None:  # plusieurs écoles et aucun code : écran de connexion neutre
            return Response({"name": "Plateforme scolaire", "logo": "", "hue": 155, "code": "", "multi": True, "accueil": accueil})
        with tenant_context(etab):
            s = SchoolSettings.load()
        return Response({"name": s.name, "logo": s.logo, "hue": s.hue, "code": etab.code, "multi": False, "accueil": accueil})


TECH_FIELDS = {"name", "logo", "hue"}


@extend_schema(request=SettingsSerializer, responses=SettingsSerializer)
class SettingsView(APIView):
    """Réglages de l'établissement : lecture pour tous les comptes, modification par `settings` (direction, secrétariat)."""

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.IsAuthenticated()]
        return [perm_required("settings", "settings.tech")()]

    def get(self, request):
        return Response(SettingsSerializer(SchoolSettings.load()).data)

    def patch(self, request):
        obj = SchoolSettings.load()
        if not has_perm(request.user, "settings"):  # service informatique : seulement l'habillage
            interdits = set(request.data) - TECH_FIELDS
            if interdits:
                return Response({"detail": "Vous pouvez modifier seulement le nom, le logo et la couleur de l’établissement."}, status=403)
        ser = SettingsSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        if "name" in ser.validated_data:  # la liste des établissements de la plateforme reprend le nom affiché
            from apps.core.models import Etablissement
            Etablissement.objects.filter(pk=obj.etablissement_id).update(nom=obj.name[:120])
        record("Paramètres modifiés", ", ".join(ser.validated_data.keys()), request=request)
        return Response(SettingsSerializer(obj).data)


# ---------- Import de classes par fichier ----------
@extend_schema(request={"multipart/form-data": inline_serializer("ImportClassesFile", {"file": serializers.FileField()})}, responses={200: {"type": "object"}})
class ClassImportView(APIView):
    """Import de classes (Excel ou CSV). Sans `?commit=1` : simple vérification."""

    parser_classes = [MultiPartParser]

    def get_permissions(self):
        return [perm_required("classes.write")()]

    def post(self, request):
        from . import imports
        f = request.FILES.get("file")
        if not f:
            raise ValidationError({"file": "Joignez un fichier Excel (.xlsx) ou CSV."})
        if f.size > 2_000_000:
            raise ValidationError({"file": "Fichier trop volumineux (2 Mo au maximum)."})
        try:
            rows = imports.read(f.read())
        except ValueError as e:
            raise ValidationError({"file": str(e)}) from e
        valid, errors = imports.validate(rows)
        out = {"total": len(rows), "valid": len(valid), "errors": errors, "created": []}
        if request.query_params.get("commit") != "1":
            return Response(out)
        with transaction.atomic():
            for v in valid:
                c = imports.create(v)
                out["created"].append({"matricule": "", "name": c.name})
        record("Import de classes", f"{f.name[:60]} : {len(out['created'])} créée(s), {len(errors)} erreur(s)", request=request)
        return Response(out, status=201 if out["created"] else 200)


@extend_schema(request={"multipart/form-data": inline_serializer("ImportSubjectsFile", {"file": serializers.FileField()})}, responses={200: {"type": "object"}})
class SubjectImportView(APIView):
    """Import de matières (Excel ou CSV). Sans `?commit=1` : simple vérification."""

    parser_classes = [MultiPartParser]

    def get_permissions(self):
        return [perm_required("subjects.write")()]

    def post(self, request):
        from . import subject_imports as imports
        f = request.FILES.get("file")
        if not f:
            raise ValidationError({"file": "Joignez un fichier Excel (.xlsx) ou CSV."})
        if f.size > 2_000_000:
            raise ValidationError({"file": "Fichier trop volumineux (2 Mo au maximum)."})
        try:
            rows = imports.read(f.read())
        except ValueError as e:
            raise ValidationError({"file": str(e)}) from e
        valid, errors = imports.validate(rows)
        out = {"total": len(rows), "valid": len(valid), "errors": errors, "created": []}
        if request.query_params.get("commit") != "1":
            return Response(out)
        with transaction.atomic():
            out["created"] = [{"matricule": "", "name": s.name} for s in imports.create_all(valid)]
        record("Import de matières", f"{f.name[:60]} : {len(out['created'])} créée(s), {len(errors)} erreur(s)", request=request)
        return Response(out, status=201 if out["created"] else 200)


@extend_schema(responses={(200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): OpenApiTypes.BINARY})
class SubjectImportTemplateView(APIView):
    def get_permissions(self):
        return [perm_required("subjects.write")()]

    def get(self, request):
        from . import subject_imports as imports
        r = HttpResponse(imports.template(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        r["Content-Disposition"] = 'attachment; filename="modele-import-matieres.xlsx"'
        return r


@extend_schema(responses={(200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): OpenApiTypes.BINARY})
class ClassImportTemplateView(APIView):
    def get_permissions(self):
        return [perm_required("classes.write")()]

    def get(self, request):
        from . import imports
        r = HttpResponse(imports.template(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        r["Content-Disposition"] = 'attachment; filename="modele-import-classes.xlsx"'
        return r
