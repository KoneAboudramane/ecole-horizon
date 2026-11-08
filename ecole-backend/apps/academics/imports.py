"""Import de classes depuis un fichier Excel ou CSV (mise en route d'une école)."""
from apps.students import csvio

from .models import SchoolClass, groupe_for

COLUMNS = ["nom", "niveau", "serie", "effectif_max"]
LEVELS = ["6e", "5e", "4e", "3e", "2nde", "1ère", "Tle"]
ALIASES = {"classe": "nom", "effectif": "effectif_max", "capacite": "effectif_max", "capacité": "effectif_max"}


def read(raw: bytes) -> list[dict]:
    return csvio.read_rows(raw, COLUMNS)


def validate(rows: list[dict]):
    from .models import Level, Serie
    series = {(lv, c) for lv, c in Serie.objects.values_list("level", "code")}
    levels = {lv.name: lv for lv in Level.objects.all()}
    existing = {c.name.lower() for c in SchoolClass.objects.all()}
    seen, valid, errors = set(), [], []
    for i0, r in enumerate(rows, start=2):
        line, problems = r.get("_line", i0), []
        name = r.get("nom", "").strip()
        level = {lv.lower(): lv for lv in levels}.get(r.get("niveau", "").strip().lower(), "")
        serie = r.get("serie", "").strip().upper()
        if not name:
            problems.append("nom manquant")
        elif name.lower() in existing or name.lower() in seen:
            problems.append("classe déjà existante")
        if not level:
            problems.append(f"niveau inconnu ({', '.join(levels)})")
        cycle = levels[level].cycle if level else "college"
        with_series = bool(level and levels[level].has_series)
        if with_series and (level, serie) not in series:
            known = ", ".join(sorted(c for lv, c in series if lv == level)) or "aucune"
            problems.append(f"série obligatoire en {level}, parmi celles de l’école : {known}")
        raw_max = r.get("effectif_max", "").strip() or "45"
        try:
            mx = int(float(raw_max.replace(",", ".")))
            if not 1 <= mx <= 200:
                raise ValueError
        except ValueError:
            problems.append("effectif maximum invalide (1 à 200)")
            mx = 45
        if problems:
            errors.append({"line": line, "nom": name, "errors": problems})
            continue
        seen.add(name.lower())
        valid.append({"line": line, "nom": name, "level": level, "serie": serie if with_series else "", "max_students": mx, "cycle": cycle})
    return valid, errors


def create(v: dict) -> SchoolClass:
    return SchoolClass.objects.create(name=v["nom"], level=v["level"], serie=v["serie"], groupe=groupe_for(v["level"], v["serie"]),
                                      max_students=v["max_students"], cycle=v["cycle"])


def template() -> bytes:
    from .models import Serie, level_names
    codes = sorted(set(Serie.objects.values_list("code", flat=True))) or ["A", "C", "D"]
    return csvio.make_template("Classes", COLUMNS, [["6e A", "6e", "", 45], ["2nde A", "2nde", "A", 40]], {"niveau": level_names() or LEVELS, "serie": codes},
        ["Une ligne par classe (supprimez les lignes d'exemple).", "nom : nom de la classe, unique (ex. 6e A).", "niveau : 6e, 5e, 4e, 3e, 2nde, 1ère ou Tle.",
         "serie : A, C ou D, obligatoire au lycée, vide au collège.", "effectif_max : capacité de la classe (45 si vide).",
         "Les classes existantes ne sont jamais modifiées : une ligne dont le nom existe déjà est signalée et ignorée.",
         "Rien n'est enregistré avant votre confirmation."])
