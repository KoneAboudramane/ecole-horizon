"""Reçu d'abonnement en PDF : remis à l'école pour chaque paiement enregistré par l'administration de la plateforme (A5 portrait).

Présentation volontairement classique, celle d'un reçu de carnet : en-tête de l'émetteur (nom, adresse, contacts, mentions légales),
« Reçu N° » et montant encadré, rubriques sur lignes pointillées (reçu de, la somme de, pour, mode de règlement), détail des tranches
à filets fins, « Fait à …, le … », signature et cachet. Encre noire ; la seule couleur est celle du cachet déposé par la plateforme."""
import io

from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.pagesizes import A5
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from apps.finance.receipt import _dfr, _fit, _money, words

from .models import AbonnementPaiement, PlatformSettings
from .pdfutil import logo_reader

NOIR = colors.HexColor("#1a1a1a")
GRIS = colors.HexColor("#555555")
GRIS_CLAIR = colors.HexColor("#8a8a8a")
FILET = colors.HexColor("#b5b5b5")


def emetteur(cfg: PlatformSettings) -> tuple[str, str]:
    """Nom de la plateforme et ses coordonnées (celles de la page d'accueil)."""
    contacts = [cfg.accueil_telephone and f"Tél. {cfg.accueil_telephone}", cfg.accueil_whatsapp and f"WhatsApp {cfg.accueil_whatsapp}", cfg.accueil_email]
    return cfg.accueil_nom or "Plateforme scolaire", " · ".join(c for c in contacts if c)


def _n(v: int) -> str:
    return f"{v:,}".replace(",", " ")


def _rubrique(c, x, y, largeur, libelle, valeur, font="Helvetica-Bold", size=9.5):
    """Une rubrique de reçu : libellé, puis la valeur sur une ligne pointillée qui va jusqu'à la marge."""
    c.setFillColor(GRIS)
    c.setFont("Helvetica", 8.5)
    c.drawString(x, y, libelle)
    lx = x + stringWidth(libelle, "Helvetica", 8.5) + 6
    c.setStrokeColor(FILET)
    c.setLineWidth(0.5)
    c.setDash(0.8, 1.8)
    c.line(lx, y - 2.5, x + largeur, y - 2.5)
    c.setDash()
    c.setFillColor(NOIR)
    c.setFont(font, size)
    c.drawString(lx + 2, y, _fit(c, valeur, font, size, x + largeur - lx - 4))


def build_recu_abonnement(p: AbonnementPaiement, duplicata: bool = False, lien: str | None = None) -> bytes:
    """`lien` : adresse de la page de vérification, imprimée en QR code avec le code du reçu."""
    cfg = PlatformSettings.load()
    nom, contacts = emetteur(cfg)
    w, h = A5
    m = 36
    larg = w - 2 * m
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(w, h))
    c.setTitle(f"Reçu {p.numero}")
    c.setAuthor(nom)
    c.setSubject(f"Reçu d’abonnement — {p.etablissement.nom}")

    # ---- en-tête de l'émetteur ----
    y = h - m - 4
    logo = logo_reader(cfg.accueil_logo) if cfg.accueil_logo else None
    tx = m
    if logo:
        c.drawImage(logo, m, y - 38, width=42, height=42, preserveAspectRatio=True, mask="auto")
        tx = m + 52
    c.setFillColor(NOIR)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(tx, y - 10, _fit(c, nom, "Helvetica-Bold", 13, w - m - tx))
    c.setFont("Helvetica", 7.5)
    c.setFillColor(GRIS)
    ly = y - 22
    for ligne in (cfg.recu_adresse, contacts, cfg.recu_mentions):
        if ligne:
            c.drawString(tx, ly, _fit(c, ligne, "Helvetica", 7.5, w - m - tx))
            ly -= 9.5
    y = min(ly, y - 42) - 6
    c.setStrokeColor(NOIR)
    c.setLineWidth(1.1)
    c.line(m, y, w - m, y)
    c.setLineWidth(0.4)
    c.line(m, y - 2.5, w - m, y - 2.5)

    # ---- « Reçu N° », date, montant encadré ----
    y -= 30
    c.setFillColor(NOIR)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(m, y, "REÇU")
    c.setFont("Helvetica", 10)
    c.drawString(m + stringWidth("REÇU", "Helvetica-Bold", 15) + 8, y, f"N° {p.numero}")
    c.setFont("Helvetica", 8.5)
    c.setFillColor(GRIS)
    c.drawString(m, y - 14, f"Abonnement à la plateforme · le {_dfr(p.date)}")
    bw, bh = 132, 34
    bx, by = w - m - bw, y - 18
    c.setStrokeColor(NOIR)
    c.setLineWidth(0.9)
    c.rect(bx, by, bw, bh, stroke=1, fill=0)
    c.setFont("Helvetica", 7)
    c.setFillColor(GRIS)
    c.drawString(bx + 7, by + bh - 10, "Montant")
    c.setFillColor(NOIR)
    c.setFont("Helvetica-Bold", 14)
    c.drawRightString(bx + bw - 7, by + 8, _money(p.montant))
    y -= 44

    # ---- rubriques ----
    d = p.detail or {}
    lignes = d.get("lignes") or []
    reglees = [ln["libelle"] for ln in lignes if ln["ici"] > 0]
    mode = dict(AbonnementPaiement.MODES).get(p.mode, p.mode)
    somme = f"{words(p.montant)} francs CFA"
    for libelle, valeur, font in (("Reçu de", f"{p.etablissement.nom} (code {p.etablissement.code})", "Helvetica-Bold"),
                                  ("La somme de", somme[:1].upper() + somme[1:], "Helvetica-Oblique"),
                                  ("Pour", "Abonnement à la plateforme" + (f" : {', '.join(reglees).lower()}" if reglees else ""), "Helvetica"),
                                  ("Mode de règlement", mode + (f", n° {p.reference}" if p.reference else ""), "Helvetica")):
        _rubrique(c, m, y, larg, libelle, valeur, font)
        y -= 21

    # ---- détail par tranche ----
    if lignes:
        y -= 6
        right = w - m
        cols = ((m, "Échéance", "l"), (m + 128, "Date", "l"), (m + 220, "Montant", "r"), (m + 282, "Réglé ici", "r"), (right, "Reste", "r"))
        c.setFont("Helvetica-Bold", 7.5)
        c.setFillColor(NOIR)
        for x, t, a in cols:
            (c.drawString if a == "l" else c.drawRightString)(x, y, t)
        c.setStrokeColor(NOIR)
        c.setLineWidth(0.6)
        c.line(m, y - 4, right, y - 4)
        y -= 15
        for ln in lignes:
            c.setFont("Helvetica", 8)
            c.setFillColor(NOIR)
            c.drawString(cols[0][0], y, _fit(c, ln["libelle"], "Helvetica", 8, 122))
            c.drawString(cols[1][0], y, _dfr(ln["echeance"]))
            c.drawRightString(cols[2][0], y, _n(ln["montant"]))
            c.drawRightString(cols[3][0], y, _n(ln["ici"]) if ln["ici"] else "—")
            c.drawRightString(cols[4][0], y, _n(ln["reste"]) if ln["reste"] else "soldée")
            c.setStrokeColor(FILET)
            c.setLineWidth(0.4)
            c.line(m, y - 4, right, y - 4)
            y -= 14
        y -= 4
        reste = d.get("reste_du", 0)
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(NOIR)
        c.drawRightString(right, y, f"Reste à payer : {_money(reste)}" if reste else "Échéancier soldé")
        y -= 13
        c.setFont("Helvetica", 7.8)
        c.setFillColor(GRIS)
        if d.get("prochaine"):
            c.drawRightString(right, y, f"Prochaine échéance le {_dfr(d['prochaine']['echeance'])}.")
            y -= 11
        acces = [f"accès jusqu’au {_dfr(d['acces_jusqu_au'])}" if d.get("acces_jusqu_au") else "",
                 f"année couverte jusqu’au {_dfr(d['periode_fin'])}" if d.get("periode_fin") else ""]
        texte = ", ".join(t for t in acces if t)
        if texte:
            c.drawRightString(right, y, texte[:1].upper() + texte[1:] + ".")

    # ---- « Fait à », signature et cachet ----
    bas = m + 8
    sx = w - m - 160
    c.setFont("Helvetica", 8.5)
    c.setFillColor(NOIR)
    c.drawString(sx, bas + 112, f"Fait à {cfg.recu_ville}, le {_dfr(p.date)}" if cfg.recu_ville else f"Fait le {_dfr(p.date)}")
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(sx, bas + 99, "Le responsable")
    cachet = logo_reader(cfg.recu_cachet) if cfg.recu_cachet else None
    if cachet:
        c.drawImage(cachet, sx + 2, bas + 22, width=68, height=68, preserveAspectRatio=True, mask="auto")
    signature = logo_reader(cfg.recu_signature) if cfg.recu_signature else None
    if signature:
        c.drawImage(signature, sx + 44, bas + 30, width=112, height=46, preserveAspectRatio=True, anchor="sw", mask="auto")
    if p.par:
        c.setFont("Helvetica", 8)
        c.setFillColor(GRIS)
        c.drawString(sx, bas + 14, _fit(c, p.par.full_name, "Helvetica", 8, 160))

    # ---- vérification : petit QR code et code, en bas à gauche ----
    if lien and p.code_verif:
        from reportlab.graphics import renderPDF
        from reportlab.graphics.barcode.qr import QrCodeWidget
        from reportlab.graphics.shapes import Drawing
        q = QrCodeWidget(lien, barLevel="M")
        x1, y1, x2, y2 = q.getBounds()
        taille = 62
        dessin = Drawing(taille, taille, transform=[taille / (x2 - x1), 0, 0, taille / (y2 - y1), 0, 0])
        dessin.add(q)
        renderPDF.draw(dessin, c, m - 5, bas + 4)
        tx = m + taille - 2
        c.setFillColor(NOIR)
        c.setFont("Helvetica", 7.3)
        c.drawString(tx, bas + 48, "Vérifier ce reçu :")
        c.drawString(tx, bas + 38, "scanner le code ci-contre")
        c.drawString(tx, bas + 28, "ou saisir le code")
        c.setFont("Courier-Bold", 10.5)
        c.drawString(tx, bas + 15, p.code_verif)
        c.setFont("Helvetica", 6.3)
        c.setFillColor(GRIS)
        c.drawString(tx, bas + 5, _fit(c, "sur " + lien.split("?")[0].replace("https://", "").replace("http://", ""), "Helvetica", 6.3, sx - tx - 10))

    # ---- pied ----
    c.setStrokeColor(FILET)
    c.setLineWidth(0.4)
    c.line(m, m - 6, w - m, m - 6)
    c.setFont("Helvetica", 6.5)
    c.setFillColor(GRIS_CLAIR)
    enregistre = f"Enregistré le {timezone.localtime(p.created):%d/%m/%Y à %H:%M}. " if p.created else ""
    c.drawCentredString(w / 2, m - 16, enregistre + "Ce reçu ne peut être ni modifié ni annulé ; conservez-le.")

    if duplicata:
        c.saveState()
        c.setFillColor(colors.Color(0, 0, 0, alpha=0.08))
        c.setFont("Helvetica-Bold", 54)
        c.translate(w / 2, h / 2)
        c.rotate(35)
        c.drawCentredString(0, 0, "DUPLICATA")
        c.restoreState()
    c.showPage()
    c.save()
    return buf.getvalue()
