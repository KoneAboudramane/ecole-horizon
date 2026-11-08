"""Import de matières depuis un fichier Excel ou CSV (mise en route d'une école : chaque école saisit ses propres matières)."""
from django.utils.text import slugify

from apps.students import csvio

from .models import Subject

COLUMNS = ["matiere", "abreviation"]


def read(raw: bytes) -> list[dict]:
    return csvio.read_rows(raw, COLUMNS)


def make_code(name: str, taken: set[str]) -> str:
    """Code technique unique (lettres minuscules, 12 caractères au plus) tiré du nom de la matière."""
    base = (slugify(name).replace("-", "")[:12] or "mat")
    code, n = base, 2
    while code in taken:
        suffix = str(n)
        code, n = base[: 12 - len(suffix)] + suffix, n + 1
    return code


def default_short(name: str) -> str:
    return name.strip()[:4].title()


def validate(rows: list[dict]):
    existing = {s.name.lower() for s in Subject.objects.all()}
    seen, valid, errors = set(), [], []
    for i0, r in enumerate(rows, start=2):
        line, problems = r.get("_line", i0), []
        name = r.get("matiere", "").strip()
        short = r.get("abreviation", "").strip() or default_short(name)
        if not name:
            problems.append("nom de la matière manquant")
        elif len(name) > 60:
            problems.append("nom trop long (60 caractères au maximum)")
        elif name.lower() in existing or name.lower() in seen:
            problems.append("matière déjà existante")
        if len(short) > 12:
            problems.append("abréviation trop longue (12 caractères au maximum)")
        if problems:
            errors.append({"line": line, "nom": name, "errors": problems})
            continue
        seen.add(name.lower())
        valid.append({"line": line, "nom": name, "short": short})
    return valid, errors


def create_all(valid: list[dict]) -> list[Subject]:
    taken = set(Subject.objects.values_list("code", flat=True))
    out = []
    for v in valid:
        code = make_code(v["nom"], taken)
        taken.add(code)
        out.append(Subject.objects.create(code=code, name=v["nom"], short=v["short"]))
    return out


def template() -> bytes:
    return csvio.make_template("Matières", COLUMNS, [["Mathématiques", "Maths"], ["Français", "Fr"]], {},
        ["Une ligne par matière (supprimez les lignes d'exemple).", "matiere : nom de la matière, unique dans l'école.",
         "abreviation : nom court affiché dans les tableaux (4 premières lettres du nom si vide).",
         "Les coefficients se règlent ensuite dans la page « Matières et coefficients ».",
         "Les matières existantes ne sont jamais modifiées : une ligne dont le nom existe déjà est signalée et ignorée.",
         "Rien n'est enregistré avant votre confirmation."])
