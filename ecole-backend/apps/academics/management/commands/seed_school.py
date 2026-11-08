from datetime import date

from django.core.management.base import BaseCommand

from apps.core.commandutil import add_ecole_option, in_school
from apps.academics.models import Coefficient, Level, SchoolClass, SchoolYear, Subject, Teacher, TeachingAssignment, Term, ensure_default_cursus, ensure_levels, ensure_series, groupe_for

SUBJECTS = [("fr", "Français", "Fran."), ("ma", "Mathématiques", "Maths"), ("an", "Anglais", "Angl."),
            ("hg", "Histoire-Géographie", "HG"), ("sv", "SVT", "SVT"), ("pc", "Physique-Chimie", "PC"),
            ("eps", "EPS", "EPS"), ("edhc", "EDHC", "EDHC"), ("ph", "Philosophie", "Philo"),
            ("lv2", "Espagnol (LV2)", "LV2"), ("ar", "Arabe", "Arabe")]

# Coefficients de démonstration, à confirmer avec l'école
_C1 = dict(fr=4, ma=4, an=2, hg=2, sv=2, pc=2, eps=1, edhc=1, ar=2)
_C2 = dict(fr=4, ma=4, an=3, hg=2, sv=2, pc=2, eps=1, edhc=1, ar=2)
COEF = {           # un groupe par niveau au collège, par série au lycée (voir groupe_for)
    "6e": _C1, "5e": _C1, "4e": _C2, "3e": _C2,
    "2nde A": dict(fr=4, an=3, hg=3, ma=2, pc=2, sv=2, lv2=2, eps=1, ar=1),
    "2nde C": dict(ma=5, pc=4, sv=2, fr=3, an=2, hg=2, lv2=1, eps=1, ar=1),
    "1ère A": dict(fr=4, ph=4, hg=3, an=3, lv2=2, ma=2, sv=1, eps=1, ar=1),
    "1ère C": dict(ma=5, pc=4, sv=2, fr=2, ph=2, an=2, hg=2, eps=1, ar=1),
    "1ère D": dict(ma=4, pc=4, sv=4, fr=2, ph=2, an=2, hg=2, eps=1, ar=1),
    "Tle A": dict(ph=5, fr=4, hg=3, an=3, lv2=2, ma=2, eps=1, ar=1),
    "Tle C": dict(ma=5, pc=4, sv=2, ph=2, fr=2, an=2, hg=2, eps=1, ar=1),
    "Tle D": dict(ma=4, pc=4, sv=4, ph=2, fr=2, an=2, hg=2, eps=1, ar=1),
}
CLASSES = [("6e", ""), ("6e", ""), ("5e", ""), ("4e", ""), ("3e", ""), ("3e", ""), ("2nde", "A"), ("2nde", "C"),
           ("1ère", "A"), ("1ère", "C"), ("1ère", "D"), ("Tle", "A"), ("Tle", "C"), ("Tle", "D")]
NAMES = ["6e A", "6e B", "5e A", "4e A", "3e A", "3e B", "2nde A", "2nde C", "1ère A", "1ère C", "1ère D", "Tle A", "Tle C", "Tle D"]


class Command(BaseCommand):
    help = "Crée l'année 2026-2027, les trimestres, matières, coefficients et classes (idempotent)."

    def add_arguments(self, p):
        add_ecole_option(p)
        p.add_argument("--sans-matieres", action="store_true", help="Ne crée ni matières ni coefficients : l'école les saisit elle-même.")

    def handle(self, *args, **opts):
        with in_school(opts.get("ecole", "")):
            self._seed(avec_matieres=not opts.get("sans_matieres"))

    def _seed(self, avec_matieres=True):
        y, _ = SchoolYear.objects.get_or_create(label="2026-2027", defaults={"current": True})
        for code, label, a, b in [("T1", "1er trimestre", date(2026, 9, 7), date(2026, 12, 18)),
                                  ("T2", "2e trimestre", date(2027, 1, 4), date(2027, 3, 26)),
                                  ("T3", "3e trimestre", date(2027, 4, 5), date(2027, 6, 30))]:
            Term.objects.get_or_create(year=y, code=code, defaults={"label": label, "start": a, "end": b, "coef": 1 if code == "T1" else 2})
        ensure_default_cursus()
        ensure_levels()
        ensure_series()
        from apps.mockexams.models import ensure_exam_types
        ensure_exam_types()
        if avec_matieres:
            subj = {c: Subject.objects.get_or_create(code=c, defaults={"name": n, "short": s})[0] for c, n, s in SUBJECTS}
            for g, table in COEF.items():
                for c, v in table.items():
                    Coefficient.objects.get_or_create(groupe=g, subject=subj[c], defaults={"value": v})
        for name, (level, serie) in zip(NAMES, CLASSES):
            SchoolClass.objects.get_or_create(name=name, defaults={
                "level": level, "serie": serie, "groupe": groupe_for(level, serie),
                "cycle": Level.objects.get(name=level).cycle, "max_students": 45})
        from apps.finance.models import FeeDate, Tarif
        for lv, ins, sco in [("6e", 50000, 180000), ("5e", 50000, 180000), ("4e", 50000, 195000), ("3e", 50000, 195000),
                             ("2nde", 60000, 240000), ("1ère", 60000, 255000), ("Tle", 60000, 270000)]:
            Tarif.objects.get_or_create(level=lv, defaults={"ins": ins, "sco": sco})
        for k, d in [("INS", date(2026, 9, 7)), ("T1", date(2026, 9, 30)), ("T2", date(2027, 1, 10)), ("T3", date(2027, 4, 5))]:
            FeeDate.objects.get_or_create(year=y, key=k, defaults={"date": d})
        # Le compte de démonstration « enseignant » (seed_demo) enseigne les maths au collège
        t = Teacher.objects.filter(user__username="enseignant").first()
        if t:
            t.subjects.add(subj["ma"])
            for c in SchoolClass.objects.filter(cycle="college"):
                TeachingAssignment.objects.get_or_create(school_class=c, subject=subj["ma"], defaults={"teacher": t})
        self.stdout.write(self.style.SUCCESS(f"Année {y} : {Subject.objects.count()} matières, {SchoolClass.objects.count()} classes."))
