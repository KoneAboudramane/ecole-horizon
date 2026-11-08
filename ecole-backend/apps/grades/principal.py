"""Professeur principal : l'enseignant que la direction ou le secrétariat place à la tête d'une classe.

Pour SA classe seulement, il voit toutes les notes et tous les résultats (lecture seule : chaque note reste à son enseignant),
rédige l'avis du conseil de classe et suit l'assiduité et la discipline de ses élèves.
"""
from collections import defaultdict

from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import generics, serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import Coefficient, SchoolClass, SchoolSettings, Subject
from apps.attendance.models import Absence
from apps.discipline.models import Incident

from . import calc
from .models import CouncilComment, Evaluation, Grade


def principal_classes(user):
    """Classes dont le compte est professeur principal (aucune pour qui n'est pas enseignant)."""
    return SchoolClass.objects.filter(prof_principal__user=user) if user.is_authenticated else SchoolClass.objects.none()


def is_principal_of(user, school_class_id) -> bool:
    return principal_classes(user).filter(pk=school_class_id).exists()


class MyClassesView(APIView):
    """Classes dont je suis professeur principal : [{id, name}]."""

    @extend_schema(responses={200: {"type": "array", "items": {"type": "object"}}})
    def get(self, request):
        return Response([{"id": c.pk, "name": c.name} for c in principal_classes(request.user)])


class MyClassView(APIView):
    """Tableau de bord du professeur principal pour une période (`?term=T1`) : élèves, évaluations et notes de toutes les
    matières (publiées ou non), résultats calculés, absences, incidents et avis du conseil."""

    @extend_schema(parameters=[OpenApiParameter("term", str)], responses=inline_serializer("MyClass", {"results": serializers.DictField()}))
    def get(self, request, pk):
        from .views import current_term
        cl = generics.get_object_or_404(SchoolClass.objects.select_related("prof_principal__user"), pk=pk)
        if not is_principal_of(request.user, cl.pk):
            raise PermissionDenied("Vous n’êtes pas professeur principal de cette classe.")
        term = current_term(request.query_params.get("term"))
        cfg = SchoolSettings.load()
        stats = calc.compute_class(cl, term, only_published=False, compo_weight=float(cfg.compo_weight))
        students = calc.roster(cl, term.year)
        ids = [s.pk for s in students]
        coefs = dict(Coefficient.objects.filter(groupe=cl.groupe, cursus_id=cl.cursus_id).values_list("subject_id", "value"))
        evs = list(Evaluation.objects.filter(school_class=cl, term=term).select_related("teacher__user").order_by("date", "pk"))
        grades = {f"{e}|{s}": float(v) for e, s, v in Grade.objects.filter(evaluation__in=evs).values_list("evaluation_id", "student_id", "value")}

        absences = Absence.objects.filter(student_id__in=ids, date__gte=term.start, date__lte=term.end).order_by("-date")
        count = defaultdict(lambda: {"absences": 0, "non_justifiees": 0, "retards": 0})
        for a in absences:
            c = count[a.student_id]
            if a.status == "R":
                c["retards"] += 1
            else:
                c["absences"] += 1
                if a.justif != "acceptee":
                    c["non_justifiees"] += 1
        incidents = Incident.objects.filter(student_id__in=ids, date__gte=term.start, date__lte=term.end).exclude(status="refuse").order_by("-date")

        return Response({
            "class": {"id": cl.pk, "name": cl.name}, "term": term.code, "term_label": term.label, "locked": term.locked,
            "students": [{"id": s.pk, "nom": s.nom, "prenoms": s.prenoms, "matricule": s.matricule} for s in students],
            "subjects": [{"id": sb.pk, "name": sb.name, "coef": coefs[sb.pk]} for sb in Subject.objects.filter(pk__in=coefs).order_by("name")],
            "evaluations": [{"id": e.pk, "subject": e.subject_id, "title": e.title, "type": e.type, "date": e.date, "bareme": e.bareme,
                             "coef": float(e.coef), "published": e.published, "teacher_name": e.teacher.user.name if e.teacher else ""} for e in evs],
            "grades": grades,
            "stats": {"effectif": stats["effectif"], "avg": stats["avg"], "max": stats["max"], "min": stats["min"],
                      "results": {str(k): v for k, v in stats["results"].items()}},
            "assiduite": {str(k): v for k, v in count.items()},
            "absences": [{"student": a.student_id, "date": a.date, "slot": a.slot, "status": a.status, "justif": a.justif, "motif": a.motif}
                         for a in absences[:200]],
            "incidents": [{"student": i.student_id, "date": i.date, "type": i.get_type_display(), "gravite": i.gravite,
                           "sanction": i.get_sanction_display(), "description": i.description, "status": i.status} for i in incidents[:200]],
            "council": dict((str(s), t) for s, t in CouncilComment.objects.filter(student_id__in=ids, term=term).values_list("student_id", "text")),
        })


def council_allowed(user, student) -> bool:
    """L'avis du conseil : la direction (droit « conseil ») pour toute l'école, le professeur principal pour sa classe."""
    from apps.core.permissions import has_perm
    return has_perm(user, "conseil") or is_principal_of(user, student.school_class_id)

