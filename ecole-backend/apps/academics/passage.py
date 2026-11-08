"""Moyennes de passage d'une école, avec des exceptions possibles par niveau (module sans dépendance).

Format stocké (JSON) : {"3e": {"admission": 11, "redoublement": 9, "exclusion": null}, ...}
Un niveau absent suit la règle générale de l'école (réglages `passage_*`).
"""
LEVELS = ["6e", "5e", "4e", "3e", "2nde", "1ère", "Tle"]


def _num(v, label: str):
    if v is None or v == "":
        return None
    try:
        n = round(float(v), 2)
    except (TypeError, ValueError):
        raise ValueError(f"{label} : saisissez un nombre.") from None
    if not 0 <= n <= 20:
        raise ValueError(f"{label} : la moyenne doit être comprise entre 0 et 20.")
    return n


def clean(data) -> dict:
    if data in (None, ""):
        return {}
    if not isinstance(data, dict):
        raise ValueError("Règles par niveau invalides.")
    from .models import level_names
    known = level_names() or LEVELS
    out = {}
    for level, r in data.items():
        if level not in known:
            raise ValueError(f"Niveau inconnu : {level}.")
        if not isinstance(r, dict):
            raise ValueError(f"{level} : règle invalide.")
        adm, red, exc = _num(r.get("admission"), f"{level}, admission"), _num(r.get("redoublement"), f"{level}, redoublement"), _num(r.get("exclusion"), f"{level}, exclusion")
        if adm is None or red is None:
            raise ValueError(f"{level} : indiquez la moyenne d’admission et celle de redoublement (ou retirez le niveau pour suivre la règle de l’école).")
        if red > adm:
            raise ValueError(f"{level} : la moyenne de redoublement doit être inférieure ou égale à celle d’admission.")
        if exc is not None and exc >= red:
            raise ValueError(f"{level} : la moyenne d’exclusion doit être inférieure à celle de redoublement.")
        out[level] = {"admission": adm, "redoublement": red, "exclusion": exc}
    return out


def rule_for(cfg, level: str | None) -> dict:
    """Règle applicable à un niveau : l'exception du niveau si elle existe, sinon la règle générale de l'école."""
    own = (cfg.passage_niveaux or {}).get(level or "")
    if own:
        return dict(own)
    return {"admission": float(cfg.passage_admission), "redoublement": float(cfg.passage_redoublement),
            "exclusion": None if cfg.passage_exclusion is None else float(cfg.passage_exclusion)}
