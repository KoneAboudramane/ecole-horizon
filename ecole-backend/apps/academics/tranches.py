"""Tranches de scolarité d'une école : nombre, noms et parts relatives (module sans dépendance).

Format stocké (JSON) : [{"label": "1re tranche", "part": 1}, ...]
La scolarité annuelle est partagée au prorata des parts ; la dernière tranche reçoit le reste (le total est toujours exact).
Les clés d'échéance sont T1, T2… dans l'ordre ; « INS » (inscription) vient toujours en premier.
"""
MAX_TRANCHES = 10
MAX_PART = 1000


def ordinal(i: int) -> str:
    return f"{i}re tranche" if i == 1 else f"{i}e tranche"


def default_tranches() -> list[dict]:
    """Trois tranches égales (réglage d'origine)."""
    return [{"label": ordinal(i), "part": 1} for i in (1, 2, 3)]


def clean(data) -> list[dict]:
    if not isinstance(data, list) or not 1 <= len(data) <= MAX_TRANCHES:
        raise ValueError(f"Indiquez entre 1 et {MAX_TRANCHES} tranches.")
    out = []
    for i, t in enumerate(data, 1):
        if not isinstance(t, dict):
            raise ValueError("Tranche invalide.")
        label = str(t.get("label", "")).strip()[:40] or ordinal(i)
        try:
            part = int(t.get("part", 1))
        except (TypeError, ValueError):
            raise ValueError(f"Tranche {i} : la part doit être un nombre entier.") from None
        if not 1 <= part <= MAX_PART:
            raise ValueError(f"Tranche {i} : la part doit être comprise entre 1 et {MAX_PART}.")
        out.append({"label": label, "part": part})
    if len({t["label"].lower() for t in out}) != len(out):
        raise ValueError("Deux tranches portent le même nom.")
    return out


def keys(tranches: list[dict]) -> list[tuple[str, str]]:
    """[("INS", "Inscription"), ("T1", libellé), ...] — dans l'ordre de paiement."""
    return [("INS", "Inscription")] + [(f"T{i}", t["label"]) for i, t in enumerate(tranches, 1)]
