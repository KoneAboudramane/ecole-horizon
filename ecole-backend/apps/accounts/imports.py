"""Import de comptes du personnel (enseignants, comptable, éducateurs, secrétariat) depuis un fichier Excel ou CSV."""
import re
import unicodedata

from django.core.exceptions import ValidationError as DjValidationError
from django.core.validators import validate_email

from apps.academics.models import Subject
from apps.students import csvio
from apps.students.phones import fmt_phone, phone_ok

from .models import User
from .serializers import staff_email_taken

COLUMNS = ["nom", "role", "email", "telephone", "identifiant", "matieres"]
ROLES = {"enseignant": "enseignant", "enseignante": "enseignant", "professeur": "enseignant", "comptable": "comptable",
         "educateur": "educateur", "educatrice": "educateur", "secretariat": "admin", "secretaire": "admin", "admin": "admin"}
ROLE_VALUES = ["enseignant", "comptable", "educateur", "secretariat"]  # la direction, le fondateur et l'informatique se créent à la main
TITLES = {"m", "mr", "mme", "mlle", "dr", "pr", "prof", "monsieur", "madame"}


def _ascii(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def read(raw: bytes) -> list[dict]:
    return csvio.read_rows(raw, COLUMNS)


def _username(name: str, taken: set[str]) -> str:
    words = [w for w in re.split(r"[^a-z0-9]+", _ascii(name)) if w and w not in TITLES]
    base = ".".join(words[:2]) or "compte"
    base = base if len(base) >= 3 else base + "00"
    u, n = base, 1
    while u in taken:
        n += 1
        u = f"{base}{n}"
    return u


def validate(rows: list[dict]):
    taken = {u.lower() for u in User.objects.values_list("username", flat=True)}
    subjects = {}
    for s in Subject.objects.all():
        for k in (s.name, s.code, s.short):
            subjects[_ascii(k)] = s
    emails_seen: set[str] = set()
    valid, errors = [], []
    for i0, r in enumerate(rows, start=2):
        line, problems = r.get("_line", i0), []
        name = r.get("nom", "").strip()
        role = ROLES.get(_ascii(r.get("role", "").strip()))
        email = r.get("email", "").strip().lower()
        if not name:
            problems.append("nom manquant")
        if not role:
            problems.append("rôle inconnu (enseignant, comptable, educateur, secretariat)")
        try:
            validate_email(email)
            if email in emails_seen or staff_email_taken(email):
                problems.append("e-mail déjà utilisé par un autre compte du personnel")
        except DjValidationError:
            problems.append("e-mail manquant ou invalide")
        tel = r.get("telephone", "").strip()
        if tel and not phone_ok(tel):
            problems.append("téléphone invalide (10 chiffres)")
        uname = _ascii(r.get("identifiant", "").strip()).replace(" ", "")
        if uname and (len(uname) < 3 or uname in taken):
            problems.append("identifiant trop court ou déjà utilisé")
        subs = []
        if role == "enseignant":
            for tok in filter(None, (t.strip() for t in re.split(r"[/,;|]", r.get("matieres", "")))):
                s = subjects.get(_ascii(tok))
                if s is None:
                    problems.append(f"matière inconnue « {tok} »")
                elif s not in subs:
                    subs.append(s)
        if problems:
            errors.append({"line": line, "nom": name, "errors": problems})
            continue
        uname = uname or _username(name, taken)
        taken.add(uname)
        emails_seen.add(email)
        valid.append({"line": line, "nom": name, "role": role, "email": email, "phone": fmt_phone(tel) if tel else "", "username": uname, "subjects": subs})
    return valid, errors


def template(subject_names: list[str]) -> bytes:
    return csvio.make_template("Personnel", COLUMNS,
        [["Mme Konan Aya", "enseignant", "aya.konan@exemple.ci", "0707112233", "", subject_names[0] if subject_names else "Mathématiques"],
         ["M. Koffi Serge", "comptable", "serge.koffi@exemple.ci", "", "", ""]],
        {"role": ROLE_VALUES}, ["Une ligne par personne (supprimez les lignes d'exemple).", "nom : nom complet.",
         "role : enseignant, comptable, educateur ou secretariat. La direction, le fondateur et le service informatique se créent à la main.",
         "email : obligatoire, un par personne (sert au « mot de passe oublié »).", "telephone : 10 chiffres (facultatif).",
         "identifiant : facultatif ; vide = prénom.nom généré automatiquement.",
         "matieres : pour les enseignants, noms de matières séparés par « / » (ex. Mathématiques / Physique-Chimie).",
         "Chaque personne reçoit un mot de passe provisoire, affiché une seule fois, à changer à la première connexion.",
         "Les comptes existants ne sont jamais modifiés. Rien n'est enregistré avant votre confirmation."], text_cols=("telephone",))
