"""Reprise de paiements déjà encaissés (avant l'utilisation de la plateforme) depuis un fichier Excel ou CSV."""
import unicodedata
from datetime import timedelta

from django.utils import timezone

from apps.students import csvio
from apps.students.models import Student
from apps.students.phones import parse_date

from . import fees
from .models import MODES, Payment

COLUMNS = ["matricule", "montant", "date", "mode", "reference", "note"]
MODE_ALIASES = {"espece": "especes", "especes": "especes", "cash": "especes", "liquide": "especes", "virement": "virement", "banque": "virement",
                "cheque": "cheque", "orange": "orange", "orange money": "orange", "mtn": "mtn", "mtn money": "mtn", "moov": "moov",
                "moov money": "moov", "wave": "wave"}


def _ascii(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.strip().lower()) if unicodedata.category(c) != "Mn")


def read(raw: bytes) -> list[dict]:
    return csvio.read_rows(raw, COLUMNS)


def validate(rows: list[dict]):
    """Chaque ligne est contrôlée dans l'ordre des dates, en tenant compte des lignes précédentes du même élève (solde restant)."""
    today = timezone.localdate()
    students = {s.matricule.lower(): s for s in Student.objects.filter(active=True).select_related("school_class", "parent__user")}
    used = {(p.mode, p.ref) for p in Payment.objects.filter(status="confirme").exclude(ref="")}
    balance: dict[int, int] = {}
    seen_refs: set[tuple] = set()
    parsed, errors = [], []
    for i0, r in enumerate(rows, start=2):
        line, problems = r.get("_line", i0), []
        st = students.get(r.get("matricule", "").strip().lower())
        if st is None:
            problems.append("matricule inconnu (ou élève inactif)")
        amt_raw = r.get("montant", "").replace(" ", "").replace(" ", "").replace("\xa0", "")
        try:
            amt = int(float(amt_raw.replace(",", ".")))
            if amt <= 0 or float(amt_raw.replace(",", ".")) != amt:
                raise ValueError
        except ValueError:
            amt = 0
            problems.append("montant invalide (entier positif en FCFA)")
        d = parse_date(r.get("date", ""))
        if d is None:
            problems.append("date invalide (jj/mm/aaaa)")
        elif d > today:
            problems.append("date dans le futur")
        elif d < today - timedelta(days=366 * 5):
            problems.append("date trop ancienne")
        mode = MODE_ALIASES.get(_ascii(r.get("mode", "")))
        if not mode:
            problems.append("mode inconnu (" + ", ".join(m for m, _ in MODES) + ")")
        ref = r.get("reference", "").strip()[:60]
        if ref and mode:
            if (mode, ref) in used or (mode, ref) in seen_refs:  # la première ligne du fichier garde la référence
                problems.append("référence déjà encaissée")
            else:
                seen_refs.add((mode, ref))
        parsed.append((d or today, i0, line, st, amt, mode, ref, r.get("note", "").strip()[:200], problems))
    # contrôle du solde : on traite chronologiquement
    valid = []
    for d, _, line, st, amt, mode, ref, note, problems in sorted(parsed, key=lambda t: (t[0], t[1])):
        if not problems and st is not None:
            if st.pk not in balance:
                balance[st.pk] = fees.account(st, today)["balance"]
            if amt > balance[st.pk]:
                problems.append(f"dépasse le solde dû ({balance[st.pk]} FCFA)")
            else:
                balance[st.pk] -= amt
                valid.append({"line": line, "student": st, "amount": amt, "mode": mode, "date": d, "ref": ref, "note": note or "Repris de l'existant (import)"})
                continue
        if problems:
            errors.append({"line": line, "nom": st.full_name if st else r_name(rows, line), "errors": problems})
    errors.sort(key=lambda e: e["line"])
    return valid, errors


def r_name(rows, line):
    for i0, r in enumerate(rows, start=2):
        if r.get("_line", i0) == line:
            return r.get("matricule", "")
    return ""


def template() -> bytes:
    return csvio.make_template("Paiements", COLUMNS,
        [["RC-0001", 50000, "15/09/2026", "especes", "", ""], ["RC-0002", 75000, "02/10/2026", "orange", "OM123456", "Tranche 1"]],
        {"mode": [m for m, _ in MODES]},
        ["Reprise de paiements déjà encaissés (une ligne par paiement). Supprimez les lignes d'exemple.", "matricule : celui de l'élève (page Élèves).",
         "montant : entier en FCFA, sans espace.", "date : jj/mm/aaaa, aujourd'hui au plus.", "mode : especes, virement, cheque, orange, mtn, moov ou wave.",
         "reference : numéro de transaction ou de chèque (facultatif) ; une même référence ne peut être encaissée qu'une fois.",
         "Un paiement ne peut pas dépasser le solde dû par l'élève : les lignes sont contrôlées dans l'ordre des dates.",
         "Chaque paiement reçoit un numéro de reçu à l'import ; aucune notification n'est envoyée aux parents.",
         "Un paiement importé se corrige en l'annulant (avec motif) depuis la page Paiements. Rien n'est enregistré avant votre confirmation."],
        text_cols=("date", "matricule"))
