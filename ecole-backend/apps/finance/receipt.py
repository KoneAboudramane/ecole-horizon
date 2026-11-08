"""Reçu de paiement en PDF (reportlab : pur Python, aucune bibliothèque système)."""
import io
from datetime import date as _date

from reportlab.lib import colors
from reportlab.lib.pagesizes import A5
from reportlab.pdfgen import canvas

from apps.core.pdfutil import hue_color, logo_reader

UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze",
         "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"]
TENS = {20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante"}


def _under_100(n: int, plural_ok: bool = True) -> str:
    if n < 20:
        return UNITS[n]
    if n < 70:
        t, u = n - n % 10, n % 10
        if u == 0:
            return TENS[t]
        return f"{TENS[t]} et un" if u == 1 else f"{TENS[t]}-{UNITS[u]}"
    if n < 80:  # 70-79 : soixante-dix...
        return "soixante et onze" if n == 71 else f"soixante-{UNITS[n - 60]}"
    if n == 80:
        return "quatre-vingts" if plural_ok else "quatre-vingt"
    return f"quatre-vingt-{UNITS[n - 80]}"  # 81-99


def _under_1000(n: int, plural_ok: bool = True) -> str:
    h, r = divmod(n, 100)
    if h == 0:
        return _under_100(r, plural_ok)
    head = "cent" if h == 1 else f"{UNITS[h]} cent"
    if r == 0:
        return head + ("s" if h > 1 and plural_ok else "")
    return f"{head} {_under_100(r, plural_ok)}"


def words(n: int) -> str:
    """Montant entier en lettres, en français (orthographe de 1990 simplifiée : traits d'union non systématiques)."""
    if n < 0:
        return "moins " + words(-n)
    if n == 0:
        return "zéro"
    parts = []
    millions, rest = divmod(n, 1_000_000)
    thousands, units = divmod(rest, 1000)
    if millions:
        parts.append(f"{_under_1000(millions)} million{'s' if millions > 1 else ''}")
    if thousands:
        parts.append("mille" if thousands == 1 else f"{_under_1000(thousands, plural_ok=False)} mille")
    if units:
        parts.append(_under_1000(units))
    return " ".join(parts)


def _money(n: int) -> str:
    return f"{n:,}".replace(",", " ") + " FCFA"


def _dfr(d) -> str:
    d = d if isinstance(d, _date) else _date.fromisoformat(str(d))
    return d.strftime("%d/%m/%Y")


def _fit(c, text: str, font: str, size: float, width: float) -> str:
    """Raccourcit un texte (avec …) pour qu'il tienne dans la largeur donnée."""
    from reportlab.pdfbase.pdfmetrics import stringWidth
    if stringWidth(text, font, size) <= width:
        return text
    while text and stringWidth(text + "…", font, size) > width:
        text = text[:-1]
    return text + "…"


def build_receipt_pdf(*, school, payment, student, payer: str, mode_label: str, balance: int, detail: dict | None = None, duplicata: bool = False) -> bytes:
    """Reçu A5 portrait : en-tête, élève, montant, tableau par échéance (dû, déjà payé, réglé par ce reçu, reste), reste global et prochaine échéance."""
    w, h = A5
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(w, h))
    c.setTitle(f"Reçu {payment.receipt_no}")
    c.setAuthor(school.name)
    accent = hue_color(school.hue)
    m = 12 * 2.83
    y = h - m
    x0 = m
    logo = logo_reader(school.logo) if school.logo else None
    if logo:
        c.drawImage(logo, x0, y - 36, width=36, height=36, preserveAspectRatio=True, mask="auto")
        x0 += 44
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(x0, y - 12, _fit(c, school.name, "Helvetica-Bold", 13, w - m - x0 - 100))
    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor("#555555"))
    c.drawString(x0, y - 24, _fit(c, " · ".join(v for v in (school.address, school.phone) if v), "Helvetica", 8, w - m - x0 - 100))
    c.setFillColor(accent)
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(w - m, y - 12, "REÇU DE PAIEMENT")
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(w - m, y - 26, f"N° {payment.receipt_no}")
    y -= 44
    c.setStrokeColor(accent)
    c.setLineWidth(1.4)
    c.line(m, y, w - m, y)
    y -= 16

    rows = [("Date", _dfr(payment.date)), ("Élève", f"{student.full_name} · {student.class_label} · {student.matricule}"), ("Reçu de", payer),
            ("Mode", mode_label + (f" · réf. {payment.ref}" if payment.ref else ""))]
    for label, value in rows:
        c.setFont("Helvetica", 8.5)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(m, y, label)
        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 9.5)
        c.drawString(m + 52, y, _fit(c, value, "Helvetica-Bold", 9.5, w - 2 * m - 52))
        y -= 14
    y -= 4
    c.setFont("Helvetica", 8.5)
    c.setFillColor(colors.HexColor("#555555"))
    c.drawString(m, y, "Montant")
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(m + 52, y - 2, _money(payment.amount))
    y -= 14
    c.setFont("Helvetica-Oblique", 8.5)
    text = f"Arrêté la somme de {words(payment.amount)} francs CFA."
    for part in (text[:70], text[70:140]):
        if part:
            c.drawString(m + 52, y, part)
            y -= 11
    y -= 6

    if detail and detail.get("lines"):
        cols = [m, m + 128, m + 188, m + 248]      # libellé | dû | déjà payé | réglé ici | reste (à droite)
        right = w - m
        c.setFillColor(colors.HexColor("#f1f1f1"))
        c.rect(m, y - 4, right - m, 14, stroke=0, fill=1)
        c.setFillColor(colors.HexColor("#333333"))
        c.setFont("Helvetica-Bold", 7.5)
        c.drawString(cols[0] + 2, y, "Échéance")
        for xr, t in ((cols[1] + 52, "Dû"), (cols[2] + 52, "Déjà payé"), (cols[3] + 52, "Ce reçu"), (right - 2, "Reste")):
            c.drawRightString(xr, y, t)
        y -= 14
        for ln in detail["lines"]:
            if ln["paid_now"] == 0 and ln["remaining"] == 0 and ln["amount"] == 0:
                continue
            now = ln["paid_now"] > 0
            c.setFillColor(colors.black)
            c.setFont("Helvetica-Bold" if now else "Helvetica", 8)
            due = f" ({_dfr(ln['due'])})" if ln.get("due") and ln["remaining"] > 0 else ""
            c.drawString(cols[0] + 2, y, _fit(c, ln["label"] + due, "Helvetica", 8, 124))
            for xr, v in ((cols[1] + 52, ln["amount"]), (cols[2] + 52, ln["paid_before"]), (cols[3] + 52, ln["paid_now"]), (right - 2, ln["remaining"])):
                c.drawRightString(xr, y, f"{v:,}".replace(",", " "))
            c.setStrokeColor(colors.HexColor("#dddddd"))
            c.setLineWidth(0.4)
            c.line(m, y - 3.5, right, y - 3.5)
            y -= 12
        y -= 2
        c.setFont("Helvetica-Bold", 8.5)
        c.setFillColor(colors.black)
        c.drawString(m + 2, y, f"Total de l’année : {_money(detail['total'])}   ·   payé à ce jour : {_money(detail['paid_after'])}")
        y -= 12
        if detail.get("discount_amount"):
            c.setFont("Helvetica", 8)
            c.drawString(m + 2, y, f"Dont remise fratrie : -{_money(detail['discount_amount'])}")
            y -= 12
        c.setFillColor(accent)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(m + 2, y, f"RESTE À PAYER : {_money(detail['remaining'])}" if detail["remaining"] else "SCOLARITÉ SOLDÉE")
        y -= 12
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 8)
        nxt = detail.get("next")
        if nxt and nxt.get("due"):
            c.drawString(m + 2, y, f"Prochaine échéance : {nxt['label']} le {_dfr(nxt['due'])} ({_money(nxt['remaining'])})")
            y -= 11
        if payment.advance:
            c.drawString(m + 2, y, f"Dont {_money(payment.advance)} gardés en avance (déduits de l’année suivante).")
            y -= 11
        if detail.get("reconstructed"):
            c.setFillColor(colors.HexColor("#777777"))
            c.drawString(m + 2, y, "Détail reconstitué d’après les paiements précédents.")
            y -= 11
    else:
        c.setFont("Helvetica", 8.5)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(m, y, f"Solde de scolarité restant à ce jour : {_money(max(balance, 0))}")

    ys = m + 28
    c.setStrokeColor(colors.HexColor("#999999"))
    c.setLineWidth(0.6)
    for xs, label in ((m, "Le comptable"), (w / 2 + 10, "Le parent ou tuteur")):
        c.line(xs, ys, xs + 120, ys)
        c.setFont("Helvetica", 8)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(xs, ys - 10, label)
    c.setFont("Helvetica", 7)
    c.drawCentredString(w / 2, m - 6, f"Reçu édité par {school.name}")

    for flag, label, rgb, size, angle in ((payment.status == "annule", "ANNULÉ", (0.8, 0.1, 0.1), 64, 35), (duplicata, "DUPLICATA", (0.1, 0.3, 0.7), 46, 35)):
        if flag:
            c.saveState()
            c.setFillColor(colors.Color(*rgb, alpha=0.2))
            c.setFont("Helvetica-Bold", size)
            c.translate(w / 2, h / 2 - 10)
            c.rotate(angle)
            c.drawCentredString(0, 0, label)
            c.restoreState()
    c.showPage()
    c.save()
    return buf.getvalue()
