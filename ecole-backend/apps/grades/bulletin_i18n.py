"""Bulletin dans la langue de son cursus (français, arabe, anglais, espagnol, allemand). L'arabe s'écrit de droite à gauche :
les tableaux sont en miroir, le texte est mis en forme (liaison des lettres, ordre de lecture) et écrit avec une police arabe
(Noto Naskh Arabic, licence OFL, dans `fonts/`) ; les passages en caractères latins (matricule, noms) gardent une police latine."""
import os
from xml.sax.saxutils import escape

from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle

from apps.core.pdfutil import fnum

FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")
AR, AR_BOLD = "NotoNaskhArabic", "NotoNaskhArabic-Bold"

MENTIONS = ("Très bien", "Bien", "Assez bien", "Passable", "Insuffisant")
LABELS = {
    "fr": {
        "year": "Année scolaire {y}", "title": "BULLETIN DE NOTES · {t}", "band": "Bulletin du {t}", "band_year": "Année {y}",
        "matricule": "Matricule : {m}", "classe": "Classe : {c} ({n} élèves)", "ne": "Né(e) le {d}", "lieu": " à {l}", "sexe": "Sexe : {s}", "M": "M", "F": "F",
        "h": ["Matières", "Coef.", "Moy. cl.", "Compo.", "Moy./20", "Points", "Rang", "Moy. classe", "Appréciation"],
        "conduite": "Conduite", "sur": "Sur {m}", "hors": " (hors moyenne)", "cls": "Classe : moy. {a} · max {b} · min {c}",
        "moygen": "Moyenne générale", "rang": "Rang", "mention": "Mention", "assid": "ASSIDUITÉ",
        "absences": "{a} absence(s) dont {j} justifiée(s) · {r} retard(s)", "conseil": "APPRÉCIATION DU CONSEIL DE CLASSE",
        "fin": "FIN D’ANNÉE", "decision": "Décision du conseil de classe : ", "avecmoy": " avec une moyenne annuelle de {m} / 20",
        "bilan": "BILAN DE L’ANNÉE", "bilan_cls": "classe : moy. {a} · max {b} · min {c}", "coef": "coef. {c}", "moyan": "Moyenne annuelle", "rangan": "Rang annuel",
        "pp": "Le professeur principal", "dir": "Le directeur", "parent": "Le parent ou tuteur",
        "qr_t": "Vérifier l’authenticité de ce bulletin",
        "qr_b": "Scannez le code avec un téléphone : la page affiche les résultats enregistrés par l’école. S’ils diffèrent de ce document, celui-ci n’est pas authentique.",
        "prov": "PROVISOIRE", "page": "page {n}", "doc": "Bulletin",
        "mentions": dict(zip(MENTIONS, MENTIONS)),
        "decisions": {"admis": "Admis(e)", "redouble": "Redouble", "exclu": "Exclu(e)", "conseil": "Conseil à réunir"},
    },
    "ar": {
        "year": "السنة الدراسية {y}", "title": "كشف النقاط · {t}", "band": "كشف نقاط {t}", "band_year": "السنة {y}",
        "matricule": "رقم التسجيل: {m}", "classe": "القسم: {c} ({n} تلميذ)", "ne": "تاريخ الميلاد: {d}", "lieu": " في {l}", "sexe": "الجنس: {s}",
        "M": "ذكر", "F": "أنثى",
        "h": ["المواد", "المعامل", "معدل الفروض", "الامتحان", "المعدل/20", "النقاط", "الرتبة", "معدل القسم", "الملاحظة"],
        "conduite": "السلوك", "sur": "من {m}", "hors": " (خارج المعدل)", "cls": "القسم: المعدل {a} · الأعلى {b} · الأدنى {c}",
        "moygen": "المعدل العام", "rang": "الرتبة", "mention": "التقدير", "assid": "المواظبة",
        "absences": "{a} غياب منها {j} مبرر · {r} تأخر", "conseil": "ملاحظة مجلس القسم",
        "fin": "نهاية السنة", "decision": "قرار مجلس القسم: ", "avecmoy": " بمعدل سنوي قدره {m} / 20",
        "bilan": "حصيلة السنة", "bilan_cls": "القسم: المعدل {a} · الأعلى {b} · الأدنى {c}", "coef": "المعامل {c}", "moyan": "المعدل السنوي", "rangan": "الرتبة السنوية",
        "pp": "الأستاذ الرئيسي", "dir": "المدير", "parent": "الولي",
        "qr_t": "التحقق من صحة هذا الكشف",
        "qr_b": "امسح الرمز بالهاتف: تعرض الصفحة النتائج المسجلة لدى المدرسة. إذا اختلفت عن هذه الوثيقة فهي غير صحيحة.",
        "prov": "مؤقت", "page": "صفحة {n}", "doc": "كشف النقاط",
        "mentions": dict(zip(MENTIONS, ("حسن جدا", "حسن", "مستحسن", "مقبول", "غير كاف"))),
        "decisions": {"admis": "ناجح(ة)", "redouble": "يعيد السنة", "exclu": "مفصول(ة)", "conseil": "يعرض على مجلس القسم"},
    },
    "en": {
        "year": "School year {y}", "title": "REPORT CARD · {t}", "band": "Report card · {t}", "band_year": "Year {y}",
        "matricule": "Student no.: {m}", "classe": "Class: {c} ({n} students)", "ne": "Born on {d}", "lieu": " in {l}", "sexe": "Sex: {s}", "M": "M", "F": "F",
        "h": ["Subjects", "Coef.", "Coursework", "Exam", "Avg./20", "Points", "Rank", "Class avg.", "Comments"],
        "conduite": "Conduct", "sur": "Out of {m}", "hors": " (not in average)", "cls": "Class: avg. {a} · max {b} · min {c}",
        "moygen": "Overall average", "rang": "Rank", "mention": "Grade", "assid": "ATTENDANCE",
        "absences": "{a} absence(s), {j} excused · {r} late arrival(s)", "conseil": "CLASS COUNCIL COMMENTS",
        "fin": "END OF YEAR", "decision": "Class council decision: ", "avecmoy": " with a yearly average of {m} / 20",
        "bilan": "YEAR SUMMARY", "bilan_cls": "class: avg. {a} · max {b} · min {c}", "coef": "coef. {c}", "moyan": "Yearly average", "rangan": "Yearly rank",
        "pp": "Form teacher", "dir": "Head teacher", "parent": "Parent or guardian",
        "qr_t": "Check that this report card is genuine",
        "qr_b": "Scan the code with a phone: the page shows the results recorded by the school. If they differ from this document, it is not genuine.",
        "prov": "DRAFT", "page": "page {n}", "doc": "Report card",
        "mentions": dict(zip(MENTIONS, ("Very good", "Good", "Fairly good", "Pass", "Insufficient"))),
        "decisions": {"admis": "Promoted", "redouble": "Repeats the year", "exclu": "Excluded", "conseil": "Council to meet"},
    },
    "es": {
        "year": "Curso escolar {y}", "title": "BOLETÍN DE NOTAS · {t}", "band": "Boletín · {t}", "band_year": "Curso {y}",
        "matricule": "Matrícula: {m}", "classe": "Clase: {c} ({n} alumnos)", "ne": "Nacido(a) el {d}", "lieu": " en {l}", "sexe": "Sexo: {s}", "M": "M", "F": "F",
        "h": ["Asignaturas", "Coef.", "Prom. clase", "Examen", "Media/20", "Puntos", "Puesto", "Media clase", "Observación"],
        "conduite": "Conducta", "sur": "Sobre {m}", "hors": " (fuera de la media)", "cls": "Clase: media {a} · máx. {b} · mín. {c}",
        "moygen": "Media general", "rang": "Puesto", "mention": "Calificación", "assid": "ASISTENCIA",
        "absences": "{a} falta(s), {j} justificada(s) · {r} retraso(s)", "conseil": "OBSERVACIÓN DEL CONSEJO DE CLASE",
        "fin": "FIN DE CURSO", "decision": "Decisión del consejo de clase: ", "avecmoy": " con una media anual de {m} / 20",
        "bilan": "BALANCE DEL CURSO", "bilan_cls": "clase: media {a} · máx. {b} · mín. {c}", "coef": "coef. {c}", "moyan": "Media anual", "rangan": "Puesto anual",
        "pp": "El profesor tutor", "dir": "El director", "parent": "El padre, la madre o el tutor",
        "qr_t": "Verificar la autenticidad de este boletín",
        "qr_b": "Escanee el código con un teléfono: la página muestra los resultados registrados por la escuela. Si difieren de este documento, no es auténtico.",
        "prov": "PROVISIONAL", "page": "página {n}", "doc": "Boletín",
        "mentions": dict(zip(MENTIONS, ("Sobresaliente", "Notable", "Bien", "Aprobado", "Insuficiente"))),
        "decisions": {"admis": "Promociona", "redouble": "Repite curso", "exclu": "Expulsado(a)", "conseil": "Consejo por reunir"},
    },
    "de": {
        "year": "Schuljahr {y}", "title": "ZEUGNIS · {t}", "band": "Zeugnis · {t}", "band_year": "Schuljahr {y}",
        "matricule": "Schülernummer: {m}", "classe": "Klasse: {c} ({n} Schüler)", "ne": "Geboren am {d}", "lieu": " in {l}", "sexe": "Geschlecht: {s}", "M": "M", "F": "W",
        "h": ["Fächer", "Koef.", "Mitarbeit", "Prüfung", "Schnitt/20", "Punkte", "Rang", "Klassenschnitt", "Bemerkung"],
        "conduite": "Betragen", "sur": "Von {m}", "hors": " (nicht im Schnitt)", "cls": "Klasse: Schnitt {a} · max. {b} · min. {c}",
        "moygen": "Gesamtdurchschnitt", "rang": "Rang", "mention": "Prädikat", "assid": "ANWESENHEIT",
        "absences": "{a} Fehltag(e), davon {j} entschuldigt · {r} Verspätung(en)", "conseil": "BEMERKUNG DER KLASSENKONFERENZ",
        "fin": "SCHULJAHRESENDE", "decision": "Beschluss der Klassenkonferenz: ", "avecmoy": " mit einem Jahresdurchschnitt von {m} / 20",
        "bilan": "JAHRESBILANZ", "bilan_cls": "Klasse: Schnitt {a} · max. {b} · min. {c}", "coef": "Koef. {c}", "moyan": "Jahresdurchschnitt", "rangan": "Jahresrang",
        "pp": "Klassenlehrer(in)", "dir": "Schulleitung", "parent": "Erziehungsberechtigte(r)",
        "qr_t": "Echtheit dieses Zeugnisses prüfen",
        "qr_b": "Scannen Sie den Code mit einem Telefon: Die Seite zeigt die von der Schule gespeicherten Ergebnisse. Weichen sie von diesem Dokument ab, ist es nicht echt.",
        "prov": "VORLÄUFIG", "page": "Seite {n}", "doc": "Zeugnis",
        "mentions": dict(zip(MENTIONS, ("Sehr gut", "Gut", "Befriedigend", "Ausreichend", "Ungenügend"))),
        "decisions": {"admis": "Versetzt", "redouble": "Wiederholt das Jahr", "exclu": "Ausgeschlossen", "conseil": "Konferenz einzuberufen"},
    },
}


def _arabic_glyphs() -> dict:
    """Police arabe (enregistrée au premier bulletin en arabe) ; renvoie les caractères qu'elle sait écrire."""
    if AR not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(AR, os.path.join(FONT_DIR, "NotoNaskhArabic-Regular.ttf")))
        pdfmetrics.registerFont(TTFont(AR_BOLD, os.path.join(FONT_DIR, "NotoNaskhArabic-Bold.ttf")))
    return pdfmetrics.getFont(AR).face.charToGlyph


def _mirror(cmd, n: int):
    """Commande de style d'un tableau mis en miroir (lecture de droite à gauche)."""
    name, (c0, r0), (c1, r1), *rest = cmd
    col = lambda c: n - 1 - (c if c >= 0 else n + c)  # noqa: E731
    a, b = sorted((col(c0), col(c1)))
    swap = {"LINEAFTER": "LINEBEFORE", "LINEBEFORE": "LINEAFTER", "LEFTPADDING": "RIGHTPADDING", "RIGHTPADDING": "LEFTPADDING"}
    if name == "ALIGN" and rest:
        rest = [{"LEFT": "RIGHT", "RIGHT": "LEFT"}.get(rest[0], rest[0]), *rest[1:]]
    return (swap.get(name, name), (a, r0), (b, r1), *rest)


class Lang:
    """Textes, nombres et mise en page du bulletin dans une langue."""

    def __init__(self, code: str):
        self.code = code if code in LABELS else "fr"
        self.rtl = self.code == "ar"
        self.L = LABELS[self.code]
        self.glyphs = _arabic_glyphs() if self.rtl else None
        self._styles = {}

    # --- textes et nombres
    def t(self, key: str, **kw) -> str:
        return self.L[key].format(**kw)

    def num(self, v, digits: int = 2) -> str:
        s = fnum(v, digits)
        return s.replace(",", ".") if self.code == "en" else s

    def rang(self, r, of=None) -> str:
        if r is None:
            return "—"
        if self.code == "fr":
            s = "1er" if r == 1 else f"{r}e"
        elif self.code == "en":
            s = f"{r}{'th' if 10 <= r % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(r % 10, 'th')}"
        elif self.code == "es":
            s = f"{r}.º"
        elif self.code == "de":
            s = f"{r}."
        else:
            s = str(r)
        if not of:
            return s
        return f"{s} من {of}" if self.rtl else f"{s}/{of}"

    def mention(self, m: str) -> str:
        return self.L["mentions"].get(m, m)

    def decision(self, v: str) -> str:
        return self.L["decisions"].get(v, v)

    # --- paragraphes
    def align(self, a: str | None):
        return {"start": TA_RIGHT if self.rtl else TA_LEFT, "end": TA_LEFT if self.rtl else TA_RIGHT, "center": TA_CENTER}[a or "start"]

    def style(self, st: ParagraphStyle, align: str | None = None, size: float | None = None, bold: bool = False) -> ParagraphStyle:
        key = (st.name, align, size, bold)
        if key not in self._styles:
            kw = {"alignment": self.align(align) if align or self.rtl else st.alignment}
            if size:
                kw.update(fontSize=size, leading=size + 3)
            if self.rtl:   # police arabe ; plus d'interligne pour les lettres hautes et les points
                heavy = bold or "Bold" in st.fontName
                kw.update(fontName=AR_BOLD if heavy else AR, leading=(size or st.fontSize) + 5)
            elif bold:
                kw["fontName"] = st.fontName.replace("-Roman", "-Bold") if "-Roman" in st.fontName else (st.fontName if "Bold" in st.fontName else st.fontName + "-Bold")
            self._styles[key] = ParagraphStyle(f"{st.name}-{len(self._styles)}", parent=st, **kw)
        return self._styles[key]

    def p(self, text, st: ParagraphStyle, *, align: str | None = None, size: float | None = None, bold: bool = False, width: float | None = None,
          italic: bool = False) -> Paragraph:
        """Paragraphe d'un texte brut (None : « — »). `width` (points) : largeur de la case, pour couper les lignes d'un texte arabe long.
        Un saut de ligne (« \\n ») force une nouvelle ligne."""
        text = "—" if text is None else str(text)
        sty = self.style(st, align, size, bold)
        if not self.rtl:
            markup = "<br/>".join(escape(x) for x in text.split("\n"))
            return Paragraph(f"<i>{markup}</i>" if italic else markup, sty)
        lines = [ln for part in text.split("\n") for ln in self._wrap(part, sty, width)]
        return Paragraph("<br/>".join(self._visual(ln, "Bold" in sty.fontName) for ln in lines), sty)

    def rich(self, parts: list[tuple[str, bool]], st: ParagraphStyle, *, width: float | None = None) -> Paragraph:
        """Paragraphe dont certains passages sont en gras (en arabe, le paragraphe reste d'un seul tenant)."""
        if self.rtl:
            return self.p("".join(t for t, _ in parts), st, width=width)
        return Paragraph("".join(f"<b>{escape(t)}</b>" if b else escape(t) for t, b in parts), self.style(st))

    def _wrap(self, text: str, sty: ParagraphStyle, width: float | None) -> list[str]:
        """Coupe un texte arabe en lignes, dans l'ordre logique (avant la mise en forme de droite à gauche)."""
        if not width:
            return [text]
        import arabic_reshaper
        out, cur = [], ""
        for w in text.split():
            cand = f"{cur} {w}".strip()
            if cur and stringWidth(arabic_reshaper.reshape(cand), sty.fontName, sty.fontSize) > width - 6:
                out.append(cur)
                cur = w
            else:
                cur = cand
        return [*out, cur] if cur else out or [""]

    def _visual(self, line: str, bold: bool) -> str:
        """Ligne arabe mise en forme (lettres liées, ordre visuel) ; les passages latins gardent une police latine."""
        import arabic_reshaper
        from bidi.algorithm import get_display
        vis = get_display(arabic_reshaper.reshape(line))
        latin = "Helvetica-Bold" if bold else "Helvetica"
        out, run, arabic = [], "", None
        for ch in vis:
            a = ord(ch) in self.glyphs
            if arabic is not None and a != arabic:
                out.append(escape(run) if arabic else f'<font name="{latin}">{escape(run)}</font>')
                run = ""
            run, arabic = run + ch, a
        if run:
            out.append(escape(run) if arabic else f'<font name="{latin}">{escape(run)}</font>')
        return "".join(out)

    def draw(self, c, x: float, y: float, text: str, size: float, *, bold: bool = False, anchor: str = "left"):
        """Écrit une ligne sur la page (filigrane, pied de page), arabe et latin mêlés."""
        if not self.rtl:
            c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
            {"left": c.drawString, "right": c.drawRightString, "center": c.drawCentredString}[anchor](x, y, text)
            return
        import arabic_reshaper
        from bidi.algorithm import get_display
        vis = get_display(arabic_reshaper.reshape(text))
        runs, run, arabic = [], "", None
        for ch in vis:
            a = ord(ch) in self.glyphs
            if arabic is not None and a != arabic:
                runs.append((run, arabic))
                run = ""
            run, arabic = run + ch, a
        if run:
            runs.append((run, arabic))
        fonts = [((AR_BOLD if bold else AR) if a else ("Helvetica-Bold" if bold else "Helvetica"), r) for r, a in runs]
        total = sum(stringWidth(r, f, size) for f, r in fonts)
        x0 = x - total if anchor == "right" else x - total / 2 if anchor == "center" else x
        for f, r in fonts:
            c.setFont(f, size)
            c.drawString(x0, y, r)
            x0 += stringWidth(r, f, size)

    # --- tableaux
    def table(self, rows: list[list], widths: list[float], styles: list, **kw) -> Table:
        """Tableau ; en arabe, mis en miroir (la première colonne à droite)."""
        if self.rtl:
            n = len(widths)
            rows = [list(reversed(r)) for r in rows]
            widths = list(reversed(widths))
            styles = [_mirror(s, n) for s in styles]
        t = Table(rows, colWidths=widths, **kw)
        t.setStyle(TableStyle(styles))
        return t
