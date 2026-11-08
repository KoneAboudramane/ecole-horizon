"""Bulletin dans la langue du cursus : français par défaut ; un cursus arabe a son bulletin entièrement en arabe, de droite à
gauche (tableaux en miroir, police arabe, passages latins dans une police latine), avec le nom de l'école et l'en-tête du cursus."""
import pytest
from reportlab.lib.styles import ParagraphStyle

from apps.academics.models import Cursus, Level, SchoolClass, SchoolSettings, Subject, Coefficient, Term, bootstrap_cursus
from apps.core.tenancy import cursus_context
from apps.grades import bulletin_pdf, calc
from apps.grades.bulletin_i18n import AR, LABELS, Lang, _mirror
from apps.grades.models import Evaluation, Grade
from apps.students.models import Student

pytestmark = pytest.mark.django_db


def test_every_language_has_every_label():
    keys = set(LABELS["fr"])
    for code, labels in LABELS.items():
        assert set(labels) == keys, code
        assert len(labels["h"]) == 9 and set(labels["mentions"]) == set(LABELS["fr"]["mentions"]) and set(labels["decisions"]) == set(LABELS["fr"]["decisions"]), code


def test_numbers_and_ranks_follow_the_language():
    assert (Lang("fr").rang(1, 22), Lang("fr").rang(3)) == ("1er/22", "3e")
    assert (Lang("en").rang(2, 30), Lang("en").num(12.5)) == ("2nd/30", "12.50")
    assert Lang("ar").rang(1, 22) == "1 من 22" and Lang("ar").mention("Bien") == "حسن" and Lang("ar").decision("admis") == "ناجح(ة)"
    assert Lang("xx").code == "fr"                                         # langue inconnue : français


def test_arabic_text_is_shaped_and_latin_keeps_a_latin_font():
    L = Lang("ar")
    p = L.p("رقم التسجيل: HZ26-0001", ParagraphStyle("t", fontName="Helvetica", fontSize=9))
    assert p.style.fontName == AR and p.style.alignment == 2                # police arabe, aligné à droite
    assert '<font name="Helvetica">HZ</font>' in p.text                                                    # passage latin : police latine
    assert any("ﹰ" <= ch <= "﻿" for ch in p.text)                                                 # lettres liées (formes de présentation)
    assert _mirror(("LINEAFTER", (0, 0), (2, -1), 0.4, "x"), 4) == ("LINEBEFORE", (1, 0), (3, -1), 0.4, "x")


@pytest.fixture
def arabe(school):
    c = Cursus.objects.create(nom="Cursus arabe", langue="ar", ordre=1, nom_ecole="مدرسة الأفق")
    bootstrap_cursus(c)
    with cursus_context(c):
        cfg = SchoolSettings.load()
        cfg.entete_pays, cfg.entete_devise = "جمهورية كوت ديفوار", "اتحاد – انضباط – عمل"
        cfg.save()
        Level.objects.create(name="الثالث", order=0)
        k = SchoolClass.objects.create(name="الثالث أ", level="الثالث", groupe="الثالث", cycle="college")
        sb = Subject.objects.create(code="qr", name="القرآن الكريم", short="القرآن")
        Coefficient.objects.create(groupe="الثالث", subject=sb, value=3)
        a = Student.all_objects.get(pk=school["A"].pk)          # relu : date de naissance en date
        st = Student.objects.create(user=a.user, principal=a, matricule=a.matricule, cursus=c, school_class=k, active=True, **{f: getattr(a, f) for f in Student.IDENTITE})
        t = Term.objects.get(code="T1")
        ev = Evaluation.objects.create(school_class=k, subject=sb, term=t, type="devoir", title="تقييم", date=t.start, published=True)
        Grade.objects.create(evaluation=ev, student=st, value=15)
    return {"cursus": c, "student": st, "term": t, "class": k}


def test_arabic_cursus_prints_an_arabic_bulletin(arabe):
    from reportlab.platypus import Table
    captured = []
    real = Table.__init__

    def spy(self, data, *a, **kw):
        captured.extend(str(getattr(c, "text", c)) for row in data for c in (row if isinstance(row, list) else [row]))
        real(self, data, *a, **kw)

    with cursus_context(arabe["cursus"]):
        cfg = SchoolSettings.load()
        stats = calc.compute_class(arabe["class"], arabe["term"], only_published=True)
        Table.__init__ = spy
        try:
            pdf = bulletin_pdf.build_bulletins_pdf([arabe["student"]], arabe["term"], stats, cfg, only_published=True, tpl="classique", verify_base="http://x/")
        finally:
            Table.__init__ = real
    assert pdf.startswith(b"%PDF") and b"NotoNaskhArabic" in pdf                   # police arabe intégrée au PDF
    from bidi.algorithm import get_display
    import arabic_reshaper
    assert any(get_display(arabic_reshaper.reshape("مدرسة الأفق")) in c for c in captured)   # nom de l'école dans la langue du cursus


def test_french_cursus_is_unchanged(school):
    t = Term.objects.get(code="T1")
    stats = calc.compute_class(school["c"], t, only_published=True)
    pdf = bulletin_pdf.build_bulletins_pdf([Student.objects.get(pk=school["A"].pk)], t, stats, SchoolSettings.load(), only_published=True, tpl="classique", verify_base="http://x/")
    assert pdf.startswith(b"%PDF") and b"NotoNaskhArabic" not in pdf
