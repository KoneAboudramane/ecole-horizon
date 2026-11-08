"""Import et export CSV des élèves (séparateur « ; » ou « , », UTF-8 avec ou sans BOM)."""
import csv
import datetime as dt
import io
import unicodedata
import zipfile

from apps.academics.models import SchoolClass
from apps.students.models import Student

from .phones import fmt_phone, parse_date, phone_ok

COLUMNS = ["nom", "prenoms", "sexe", "naissance", "lieu", "classe", "parent", "telephone"]
MAX_ROWS = 2000


MAX_CELL = 150
HEADER_ALIASES = {"prenom": "prenoms", "date de naissance": "naissance", "date naissance": "naissance", "lieu de naissance": "lieu",
                  "tel": "telephone", "telephone parent": "telephone", "contact": "telephone", "nom du parent": "parent", "nom parent": "parent"}


def _norm_header(h) -> str:
    h = unicodedata.normalize("NFD", str(h or "").strip().lower())
    h = "".join(c for c in h if unicodedata.category(c) != "Mn")
    return HEADER_ALIASES.get(h, h)


def _clean(v) -> str:
    """Valeur de cellule en texte sûr : dates au format jj/mm/aaaa, téléphones sans perdre le 0 initial, pas de caractères de contrôle."""
    if v is None:
        return ""
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%d/%m/%Y")
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v)
    s = "".join(ch for ch in s if ch >= " " or ch in "\t").replace("\t", " ").strip()
    return s[:MAX_CELL]


def _xlsx_rows(raw: bytes) -> list[list]:
    """Lit la première feuille d'un classeur .xlsx. Les formules ne sont pas exécutées (valeurs enregistrées seulement), les macros sont ignorées."""
    from openpyxl import load_workbook
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            if sum(i.file_size for i in z.infolist()) > 30_000_000:  # classeur « bombe » : très petit compressé, énorme décompressé
                raise ValueError("Classeur trop volumineux.")
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except ValueError:
        raise
    except Exception as e:  # noqa: BLE001 — fichier corrompu ou format non pris en charge
        raise ValueError("Ce fichier Excel ne peut pas être lu. Utilisez le modèle fourni (format .xlsx).") from e
    ws = wb["Élèves"] if "Élèves" in wb.sheetnames else wb.worksheets[0]
    out = []
    for row in ws.iter_rows(values_only=True):
        if len(out) > MAX_ROWS + 1:
            break
        out.append(list(row))
    wb.close()
    return out


def read_rows(raw: bytes, columns: list[str] | None = None) -> list[dict]:
    """Lignes d'un fichier .xlsx (modèle Excel) ou CSV (séparateur « ; » ou « , », UTF-8 avec ou sans BOM)."""
    if raw[:2] == b"PK":
        table = _xlsx_rows(raw)
    elif raw[:4] == b"\xd0\xcf\x11\xe0":
        raise ValueError("Ancien format Excel (.xls) non pris en charge : enregistrez le fichier au format .xlsx puis réessayez.")
    else:
        text = raw.decode("utf-8-sig", errors="replace")
        sample = text[:2000]
        delim = ";" if sample.count(";") >= sample.count(",") else ","
        table = list(csv.reader(io.StringIO(text), delimiter=delim))
    numbered = [(i, r) for i, r in enumerate(table, start=1) if any(_clean(c) for c in r)]  # numéros de ligne du fichier d'origine
    if not numbered:
        raise ValueError("Le fichier est vide.")
    table = [r for _, r in numbered]
    fields = [_norm_header(h) for h in table[0]]
    columns = columns or COLUMNS
    missing = [c for c in columns if c not in fields]
    if missing:
        raise ValueError("Colonnes manquantes : " + ", ".join(missing) + ". Attendu : " + ";".join(columns))
    if len(table) - 1 > MAX_ROWS:
        raise ValueError(f"Fichier trop volumineux ({MAX_ROWS} lignes au maximum).")
    rows = []
    for (n, r) in numbered[1:]:
        d = {"_line": n, **{f: _clean(r[i]) if i < len(r) else "" for i, f in enumerate(fields) if f}}
        if len(d.get("telephone", "")) == 9 and d["telephone"].isdigit():
            d["telephone"] = "0" + d["telephone"]  # Excel supprime le 0 initial des nombres
        rows.append(d)
    return rows


def make_template(sheet: str, heads: list[str], examples: list[list], lists: dict[str, list[str]], help_lines: list[str], text_cols: tuple[str, ...] = ()) -> bytes:
    """Modèle Excel générique : en-têtes, exemples, listes déroulantes (colonne → valeurs) et feuille d'aide."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter as L
    from openpyxl.worksheet.datavalidation import DataValidation
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(heads)
    for h in ws[1]:
        h.font, h.fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="0F6B4A")
    for e in examples:
        ws.append(e)
    for i, h in enumerate(heads, start=1):
        ws.column_dimensions[L(i)].width = max(14, len(h) + 6)
        if h in text_cols:
            for r in range(2, 502):
                ws.cell(r, i).number_format = "@"
    ws.freeze_panes = "A2"
    for col, values in lists.items():
        i = heads.index(col) + 1
        if len(",".join(values)) < 250:
            dv = DataValidation(type="list", formula1='"' + ",".join(values) + '"', allow_blank=True, showErrorMessage=True)
        else:
            ref = wb.create_sheet("Listes")
            for k, v in enumerate(values, start=1):
                ref.cell(k, i, v)
            dv = DataValidation(type="list", formula1=f"=Listes!${L(i)}$1:${L(i)}${len(values)}", allow_blank=True, showErrorMessage=True)
        ws.add_data_validation(dv)
        dv.add(f"{L(i)}2:{L(i)}501")
    aide = wb.create_sheet("Aide")
    for line in help_lines:
        aide.append([line])
    aide.column_dimensions["A"].width = 120
    for row in aide.iter_rows():
        row[0].alignment = Alignment(wrap_text=True)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def template_xlsx(classes: list[str]) -> bytes:
    """Modèle Excel : feuille « Élèves » (colonnes et exemples), liste déroulante des classes, feuille « Aide »."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation
    wb = Workbook()
    ws = wb.active
    ws.title = "Élèves"
    heads = ["nom", "prenoms", "sexe", "naissance", "lieu", "classe", "parent", "telephone"]
    ws.append(heads)
    for h in ws[1]:
        h.font, h.fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="0F6B4A")
    ex = classes[0] if classes else "6e A"
    ws.append(["TRAORE", "Mariam", "F", "12/03/2012", "Abidjan", ex, "Traoré Seydou", "0707112233"])
    ws.append(["DIALLO", "Aïcha", "F", "15/11/2011", "Korhogo", ex, "Mme Diallo Awa", "0505667788"])
    for col, w in zip("ABCDEFGH", (18, 20, 8, 14, 16, 12, 24, 16)):
        ws.column_dimensions[col].width = w
    for r in range(2, 502):
        ws.cell(r, 4).number_format = "@"  # texte : évite qu'Excel réinterprète la date
        ws.cell(r, 8).number_format = "@"  # texte : conserve le 0 initial du téléphone
    ws.freeze_panes = "A2"
    cl = wb.create_sheet("Classes")
    for c in classes:
        cl.append([c])
    if classes:
        dv = DataValidation(type="list", formula1=f"=Classes!$A$1:$A${len(classes)}", allow_blank=False, showErrorMessage=True)
        ws.add_data_validation(dv)
        dv.add("F2:F501")
    dv2 = DataValidation(type="list", formula1='"M,F"', allow_blank=False, showErrorMessage=True)
    ws.add_data_validation(dv2)
    dv2.add("C2:C501")
    aide = wb.create_sheet("Aide")
    for line in ["Remplissez la feuille « Élèves » : une ligne par élève (supprimez les deux lignes d'exemple).",
                 "nom, prenoms : obligatoires.", "sexe : M ou F.", "naissance : jj/mm/aaaa (ex. 12/03/2012).",
                 "classe : exactement le nom d'une classe de l'école (liste déroulante).",
                 "parent : nom du parent (avec M. ou Mme si vous voulez). Les frères et sœurs d'un même parent et même téléphone partagent un seul compte parent.",
                 "telephone : 10 chiffres.", "Enregistrez au format .xlsx puis importez le fichier dans la page Élèves.",
                 "Rien n'est enregistré avant votre confirmation : le site vérifie d'abord le fichier et liste les erreurs ligne par ligne."]:
        aide.append([line])
    aide.column_dimensions["A"].width = 120
    for row in aide.iter_rows():
        row[0].alignment = Alignment(wrap_text=True)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def validate_rows(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Renvoie (lignes valides normalisées, erreurs). La numérotation commence à 2 (la ligne 1 est l'en-tête)."""
    classes = {c.name.lower(): c for c in SchoolClass.objects.all()}
    existing = {(s.nom.lower(), s.prenoms.lower(), s.naissance) for s in Student.objects.all()}
    free = {c.pk: c.max_students - c.students.filter(active=True).count() for c in classes.values()}
    seen, valid, errors = set(), [], []
    for i0, r in enumerate(rows, start=2):
        i = r.get("_line", i0)
        problems = []
        if not r.get("nom"):
            problems.append("nom manquant")
        if not r.get("prenoms"):
            problems.append("prénoms manquants")
        sexe = r.get("sexe", "").upper()[:1]
        if sexe not in ("M", "F"):
            sexe = "M" if sexe == "G" else sexe
        if sexe not in ("M", "F"):
            problems.append("sexe invalide (M ou F)")
        naissance = parse_date(r.get("naissance", ""))
        if naissance is None:
            problems.append("date de naissance invalide (jj/mm/aaaa)")
        cls = classes.get(r.get("classe", "").lower())
        if cls is None:
            problems.append(f"classe inconnue « {r.get('classe', '')} »")
        if not r.get("parent"):
            problems.append("parent manquant")
        if not phone_ok(r.get("telephone", "")):
            problems.append("téléphone invalide (10 chiffres)")
        if not problems:
            key = (r["nom"].lower(), r["prenoms"].lower(), naissance)
            if key in existing or key in seen:
                problems.append("doublon (même nom, prénoms et naissance)")
            elif free[cls.pk] <= 0:
                problems.append(f"classe {cls.name} complète")
        if problems:
            errors.append({"line": i, "nom": r.get("nom", ""), "errors": problems})
            continue
        seen.add(key)
        free[cls.pk] -= 1
        valid.append({"line": i, "nom": r["nom"], "prenoms": r["prenoms"], "sexe": sexe, "naissance": naissance,
                      "lieu": r.get("lieu", ""), "school_class": cls, "parent_name": r["parent"],
                      "parent_phone": fmt_phone(r["telephone"])})
    return valid, errors


def export_students(qs) -> str:
    out = io.StringIO()
    out.write("﻿")
    w = csv.writer(out, delimiter=";")
    w.writerow(["matricule"] + COLUMNS)
    for s in qs.select_related("school_class", "parent__user"):
        w.writerow([s.matricule, s.nom, s.prenoms, s.sexe, s.naissance.strftime("%d/%m/%Y"), s.lieu, s.class_label,
                    s.parent.user.full_name, s.parent.user.phone])
    return out.getvalue()
