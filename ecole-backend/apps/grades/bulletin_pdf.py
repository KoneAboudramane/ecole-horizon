"""Bulletin trimestriel en PDF (trois modèles) avec QR code de vérification signé, dans la langue du cursus (voir bulletin_i18n)."""
import io

from django.core import signing
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from apps.academics.models import Subject, TeachingAssignment
from apps.attendance.models import Absence
from apps.core.pdfutil import hue_color, logo_reader

from . import calc
from .bulletin_i18n import Lang
from .models import Appreciation, CouncilComment, Decision

SALT = "bulletin-v1"
TEMPLATES = ("classique", "moderne", "compact")


# ---------- QR de vérification ----------
def make_token(student_id: int, term_id: int, moyenne, rang, annual: dict | None = None) -> str:
    """Jeton signé : si les notes publiées changent, la page de vérification le signale. Dernière période : la moyenne et le rang annuels aussi."""
    d = {"s": student_id, "t": term_id, "m": None if moyenne is None else round(moyenne, 2), "r": rang}
    if annual and annual.get("moyenne") is not None:
        d.update(a=round(annual["moyenne"], 2), ar=annual["rang"])
    return signing.dumps(d, salt=SALT, compress=True)


def read_token(token: str) -> dict:
    return signing.loads(token, salt=SALT)


def _qr(url: str, size: float = 24 * mm) -> Drawing:
    w = QrCodeWidget(url, barLevel="M")
    x0, y0, x1, y1 = w.getBounds()
    d = Drawing(size, size, transform=[size / (x1 - x0), 0, 0, size / (y1 - y0), 0, 0])
    d.add(w)
    return d


# ---------- styles par modèle ----------
def _styles(tpl: str, accent):
    serif = tpl == "classique"
    base = "Times-Roman" if serif else "Helvetica"
    bold = "Times-Bold" if serif else "Helvetica-Bold"
    sz = 8 if tpl == "compact" else 9
    S = {
        "body": ParagraphStyle("body", fontName=base, fontSize=sz, leading=sz + 2.5),
        "small": ParagraphStyle("small", fontName=base, fontSize=sz - 1.5, leading=sz, textColor=colors.HexColor("#555555")),
        "bold": ParagraphStyle("bold", fontName=bold, fontSize=sz, leading=sz + 2.5),
        "num": ParagraphStyle("num", fontName=base, fontSize=sz, leading=sz + 2.5, alignment=TA_RIGHT),
        "numb": ParagraphStyle("numb", fontName=bold, fontSize=sz, leading=sz + 2.5, alignment=TA_RIGHT),
        "ctr": ParagraphStyle("ctr", fontName=base, fontSize=sz, leading=sz + 2.5, alignment=TA_CENTER),
        "th": ParagraphStyle("th", fontName=bold, fontSize=sz - 1.5, leading=sz,  textColor=colors.white if tpl == "moderne" else colors.black),
        "title": ParagraphStyle("title", fontName=bold, fontSize={"classique": 15, "moderne": 14, "compact": 11}[tpl], leading=18, alignment=TA_CENTER if tpl == "classique" else 0,
                                textColor=accent if tpl != "classique" else colors.black),
        "name": ParagraphStyle("name", fontName=bold, fontSize=sz + 3, leading=sz + 6),
    }
    return S, base, bold


def _annual_table(an: dict, res: dict | None, cfg, S, tpl: str, accent, L: Lang):
    """Bilan de l'année (bulletin de la dernière période) : moyenne de chaque période et son coefficient, moyenne, rang et mention annuels."""
    ps = res["periodes"] if res else [{"label": t["label"], "coef": t["coef"], "moy": None} for t in an["terms"]]
    moy, rang = (res["moyenne"], res["rang"]) if res else (None, None)
    head = [L.p(f"{p['label']}\n{L.t('coef', c=p['coef'])}", S["small"]) for p in ps] + [L.p(L.t("moyan"), S["small"]), L.p(L.t("rangan"), S["small"]), L.p(L.t("mention"), S["small"])]
    vals = [L.p(L.num(p["moy"]), S["body"]) for p in ps] + [L.p(f"{L.num(moy)} / 20", S["body"], size=12, bold=True),
            L.p(L.rang(rang, an["effectif"]), S["body"], size=12, bold=True), L.p(L.mention(calc.mention(moy, cfg.seuils)), S["body"], bold=True)]
    rest = 190 - 44 - 32 - 34
    title = L.rich([(L.t("bilan"), True), (" · " + L.t("bilan_cls", a=L.num(an["avg"]), b=L.num(an["max"]), c=L.num(an["min"])), False)], S["small"])
    return L.table([[title] + [""] * (len(head) - 1), head, vals], [rest / max(1, len(ps)) * mm] * len(ps) + [44 * mm, 32 * mm, 34 * mm],
                   [("SPAN", (0, 0), (-1, 0)), ("BOX", (0, 0), (-1, -1), 0.8, colors.black if tpl == "classique" else accent),
                    ("LINEAFTER", (0, 1), (-2, -1), 0.4, colors.HexColor("#999999")), ("LINEBELOW", (0, 0), (-1, 0), 0.4, colors.HexColor("#999999")),
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#eef4f0") if tpl != "classique" else colors.white), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")])


def _student_story(student, term, stats, cfg, *, only_published: bool, tpl: str, verify_base: str, teachers: dict, subjects: dict, annual: dict | None = None,
                   L: Lang | None = None, school_name: str = ""):
    L = L or Lang("fr")
    school_name = school_name or cfg.name
    accent = hue_color(cfg.hue)
    S, base, bold = _styles(tpl, accent)
    res = stats["results"].get(student.pk)
    moy = res["moyenne"] if res else None
    rang = res["rang"] if res else None
    eff = stats["effectif"]
    ment = L.mention(calc.mention(moy, cfg.seuils))
    cl = student.school_class
    story = []

    # --- en-tête
    logo = logo_reader(cfg.logo)
    left = []
    if logo:
        left.append(Image(logo, width=15 * mm, height=15 * mm, kind="proportional"))
    ident = [L.p(school_name, S["bold"], bold=True), L.p(" · ".join(x for x in (cfg.address, cfg.phone) if x), S["small"])]
    # En-tête officiel choisi par l'école pour ce cursus (pays, devise) ; une ligne vide est omise
    pays, devise = cfg.entete_pays.strip(), cfg.entete_devise.strip()
    right = [L.p(x, S["small"], align="end", italic=x == devise) for x in (pays, devise, L.t("year", y=term.year.label)) if x]
    head = L.table([[left or "", ident, right]], [18 * mm if left else 0.1, 92 * mm, 80 * mm - (0 if left else 0.1)],
                   [("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)])
    if tpl == "moderne":
        white = ParagraphStyle("w", parent=S["body"], textColor=colors.white)
        band = L.table([[L.p(school_name, white, size=15, bold=True), L.p(f"{L.t('band', t=term.label.lower() if L.code == 'fr' else term.label)}\n{L.t('band_year', y=term.year.label)}", white, align="end")]],
                       [110 * mm, 80 * mm],
                       [("BACKGROUND", (0, 0), (-1, -1), accent), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")])
        story += [band, Spacer(1, 4 * mm)]
        if logo:
            story += [head, Spacer(1, 2 * mm)]
    else:
        story += [head, Spacer(1, 3 * mm)]
        if tpl == "classique":
            line = Table([[""]], colWidths=[190 * mm], rowHeights=[1])
            line.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 1.2, colors.black)]))
            story += [line, Spacer(1, 3 * mm)]
        story += [L.p(L.t("title", t=term.label.upper() if L.code != "ar" else term.label), S["title"], align="center" if tpl == "classique" else None), Spacer(1, 3 * mm)]

    # --- identité
    bd = student.naissance.strftime("%d/%m/%Y")
    idt = L.table([[L.p(f"{student.nom} {student.prenoms}", S["name"], bold=True), L.p(L.t("matricule", m=student.matricule), S["body"]),
                    L.p(L.t("classe", c=cl.name, n=eff), S["body"])],
                   [L.p(L.t("ne", d=bd) + (L.t("lieu", l=student.lieu) if student.lieu else ""), S["body"]), L.p(L.t("sexe", s=L.t(student.sexe) if student.sexe in ("M", "F") else student.sexe), S["body"]), ""]],
                  [80 * mm, 50 * mm, 60 * mm],
                  [("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]
                  + ([("BOX", (0, 0), (-1, -1), 0.8, colors.black)] if tpl == "classique" else [("LINEBELOW", (0, -1), (-1, -1), 0.6, accent)]))
    story += [idt, Spacer(1, 3 * mm)]

    # --- notes par matière
    appr = dict(Appreciation.objects.filter(student=student, term=term).values_list("subject_id", "text"))
    widths = [41, 11, 15, 15, 15, 14, 13, 17, 49]
    rows = [[L.p(h, S["th"], width=w * mm) for h, w in zip(L.L["h"], widths)]]
    name_style = S["bold"] if tpl != "classique" else S["body"]
    for r in (res["subjects"] if res else []):
        sb = subjects[r["subject"]]
        pts = None if r["moy"] is None else r["moy"] * r["coef"]
        rows.append([[L.p(sb.name, name_style), L.p(teachers.get(r["subject"], ""), S["small"])] if tpl != "compact" else L.p(sb.name, S["body"]),
                     L.p(str(r["coef"]), S["ctr"], align="center"), L.p(L.num(r["mc"]), S["num"], align="end"), L.p(L.num(r["compo"]), S["num"], align="end"),
                     L.p(L.num(r["moy"]), S["numb"], align="end"), L.p(L.num(pts, 1), S["num"], align="end"), L.p(L.rang(r["rang"]), S["ctr"], align="center"),
                     L.p(L.num(r["class_moy"]), S["num"], align="end"), L.p(appr.get(r["subject"]) or "—", S["small"], width=widths[-1] * mm)])
    cd = res.get("conduite") if res else None
    if cd:
        cpts = cd["note"] * cd["coef"] if cd["in_average"] else None
        rows.append([L.p(L.t("conduite"), name_style), L.p(str(cd["coef"]) if cd["in_average"] else "—", S["ctr"], align="center"),
                     L.p("—", S["num"], align="end"), L.p("—", S["num"], align="end"), L.p(L.num(cd["note"]), S["numb"], align="end"), L.p(L.num(cpts, 1), S["num"], align="end"),
                     L.p("—", S["ctr"], align="center"), L.p("—", S["num"], align="end"),
                     L.p(L.t("sur", m=L.num(cd["max"])) + ("" if cd["in_average"] else L.t("hors")), S["small"], width=widths[-1] * mm)])
    ts = [("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 2 if tpl == "compact" else 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 2 if tpl == "compact" else 3)]
    if tpl == "classique":
        ts += [("GRID", (0, 0), (-1, -1), 0.6, colors.black), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eceeed"))]
    elif tpl == "moderne":
        ts += [("BACKGROUND", (0, 0), (-1, 0), accent), ("LINEBELOW", (0, 1), (-1, -1), 0.4, colors.HexColor("#c9d1cc")), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f7f5")])]
    else:
        ts += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8efeb")), ("LINEBELOW", (0, 1), (-1, -1), 0.3, colors.HexColor("#c9d1cc"))]
    story += [L.table(rows, [w * mm for w in widths], ts, repeatRows=1), Spacer(1, 3 * mm)]

    # --- résultats
    cm = L.t("cls", a=L.num(stats["avg"]), b=L.num(stats["max"]), c=L.num(stats["min"]))
    sums = L.table([[L.p(L.t("moygen"), S["small"]), L.p(L.t("rang"), S["small"]), L.p(L.t("mention"), S["small"]), L.p(cm, S["small"])],
                    [L.p(f"{L.num(moy)} / 20", S["body"], size=13, bold=True), L.p(L.rang(rang, eff), S["body"], size=13, bold=True),
                     L.p(ment, S["body"], size=11, bold=True), ""]], [45 * mm, 35 * mm, 40 * mm, 70 * mm],
                   [("BOX", (0, 0), (-1, -1), 0.8, colors.black if tpl == "classique" else accent), ("LINEAFTER", (0, 0), (2, -1), 0.4, colors.HexColor("#999999")),
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#eef4f0") if tpl != "classique" else colors.white), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")])
    story += [sums, Spacer(1, 3 * mm)]
    an_res = annual["results"].get(student.pk) if annual else None
    if annual:
        story += [KeepTogether([_annual_table(annual, an_res, cfg, S, tpl, accent, L)]), Spacer(1, 3 * mm)]

    # --- assiduité, conseil, décision
    ab = Absence.objects.filter(student=student, date__gte=term.start, date__lte=term.end)
    n_abs, n_ret = ab.filter(status="A").count(), ab.filter(status="R").count()
    n_just = ab.filter(status="A", justif="acceptee").count()
    cc = CouncilComment.objects.filter(student=student, term=term).first()
    # Décision de fin d'année : seulement sur le bulletin de la dernière période (celui qui porte le bilan annuel)
    dec = Decision.objects.filter(student=student, year=term.year).first() if annual else None
    full = 190 * mm
    boxes = [[L.p(L.t("assid"), S["small"], bold=True)], [L.p(L.t("absences", a=n_abs, j=n_just, r=n_ret), S["body"])],
             [L.p(L.t("conseil"), S["small"], bold=True)], [L.p(cc.text if cc and cc.text else "—", S["body"], width=full)]]
    if dec:
        parts = [(L.t("decision"), False), (L.decision(dec.value), True)]
        if an_res and an_res["moyenne"] is not None:
            parts.append((L.t("avecmoy", m=L.num(an_res["moyenne"])), False))
        if dec.comment:
            parts.append((f" · {dec.comment}", False))
        boxes += [[L.p(L.t("fin"), S["small"], bold=True)], [L.rich(parts, S["body"], width=full)]]
    bt = L.table(boxes, [full], [("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#999999")), ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5)])
    story += [KeepTogether([bt]), Spacer(1, 4 * mm)]

    # --- signatures + QR
    # Titre de chaque signataire, et son nom en dessous : professeur principal de la classe, directeur de l'école
    pp = student.school_class.prof_principal

    def who(title, name):
        return [L.p(title, S["small"])] + ([L.p(name, S["small"], bold=True)] if name else [])

    sign = L.table([[who(L.t("pp"), pp.user.name if pp else ""), who(L.t("dir"), cfg.director_name()), who(L.t("parent"), "")]],
                   [55 * mm, 70 * mm, 55 * mm],
                   [("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.HexColor("#888888")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)],
                   rowHeights=[18 * mm])
    foot = [L.p(" · ".join(x for x in (school_name, cfg.address, cfg.phone) if x), S["small"], align="center")]
    story += [KeepTogether([sign, Spacer(1, 3 * mm)] + foot)]
    if only_published and moy is not None:
        url = f"{verify_base.rstrip('/')}/api/v1/public/verify/{make_token(student.pk, term.pk, moy, rang, an_res)}/"
        qr = L.table([[[L.p(L.t("qr_t"), S["small"], bold=True), L.p(L.t("qr_b"), S["small"], width=160 * mm)], _qr(url)]], [160 * mm, 28 * mm],
                     [("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (1, 0), (1, 0), "RIGHT"), ("LEFTPADDING", (0, 0), (-1, -1), 0)])
        story += [Spacer(1, 2 * mm), qr]
    return story


def _page_marks(only_published: bool, school_name: str, accent, L: Lang | None = None):
    L = L or Lang("fr")

    def draw(c, doc):
        if not only_published:
            c.saveState()
            c.setFillColor(colors.Color(0.7, 0.3, 0.07, alpha=0.13))
            c.translate(A4[0] / 2, A4[1] / 2)
            c.rotate(40)
            L.draw(c, 0, 0, L.t("prov"), 80, bold=True, anchor="center")
            c.restoreState()
        c.saveState()
        c.setFillColor(colors.HexColor("#777777"))
        if L.rtl:   # pied de page à gauche, dans le sens de lecture
            L.draw(c, 10 * mm, 6 * mm, f"{school_name} · {L.t('page', n=doc.page)}", 7)
        else:
            L.draw(c, A4[0] - 10 * mm, 6 * mm, f"{school_name} · {L.t('page', n=doc.page)}", 7, anchor="right")
        c.restoreState()
    return draw


def build_bulletins_pdf(students, term, stats, cfg, *, only_published: bool, tpl: str, verify_base: str, annual: dict | None = None) -> bytes:
    """Un bulletin par élève, une page chacun (ou plus), dans un même PDF. `annual` (dernière période) : bilan annuel de la classe (`calc.annual_class`).
    Le bulletin est rédigé dans la langue du cursus de la classe (en arabe : de droite à gauche), au nom de l'école dans cette langue."""
    tpl = tpl if tpl in TEMPLATES else "classique"
    cursus = students[0].school_class.cursus if students and students[0].school_class.cursus_id else None
    L = Lang(cursus.langue if cursus else "fr")
    school_name = (cursus.nom_ecole.strip() if cursus else "") or cfg.name
    teachers = {}
    cl_ids = {s.school_class_id for s in students}
    for a in TeachingAssignment.objects.filter(school_class_id__in=cl_ids).select_related("teacher__user"):
        teachers.setdefault(a.subject_id, a.teacher.user.name)
    subjects = {s.pk: s for s in Subject.objects.all()}
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=10 * mm, rightMargin=10 * mm, topMargin=10 * mm, bottomMargin=12 * mm,
                            title=f"{L.t('doc')} {term.label}" if len(students) != 1 else f"{L.t('doc')} {students[0].nom} {students[0].prenoms} {term.label}", author=school_name)
    story = []
    for i, st in enumerate(students):
        if i:
            story.append(PageBreak())
        story += _student_story(st, term, stats, cfg, only_published=only_published, tpl=tpl, verify_base=verify_base, teachers=teachers, subjects=subjects,
                                annual=annual, L=L, school_name=school_name)
    mark = _page_marks(only_published, school_name, hue_color(cfg.hue), L)
    doc.build(story, onFirstPage=mark, onLaterPages=mark)
    return buf.getvalue()
