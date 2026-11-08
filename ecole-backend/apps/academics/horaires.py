"""Horaires de cours d'une école : créneaux, pauses et créneaux ouverts chaque jour.

Module sans dépendance (utilisable par les modèles et par l'emploi du temps).
Format stocké (JSON), propre à chaque établissement :
  creneaux : [{"debut": "07h30", "fin": "08h30"}, ...]   dans l'ordre de la journée
  pauses   : {"2": "Récréation"}                           pause juste avant le créneau n° 2 (numérotation à partir de 0)
  ouverts  : [8, 8, 5, 8, 8, 4, 0]                         nombre de créneaux de cours, lundi à dimanche (0 = pas de cours)
"""
import re

DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
MAX_SLOTS = 12
_TIME = re.compile(r"^([01]\d|2[0-3])h([0-5]\d)$")


def default_horaires() -> dict:
    """Horaires d'origine : créneaux d'une heure de 7h30 à 17h30, mercredi matin et samedi matin seulement."""
    return {
        "creneaux": [{"debut": a, "fin": b} for a, b in [("07h30", "08h30"), ("08h30", "09h30"), ("09h45", "10h45"), ("10h45", "11h45"),
                                                         ("11h45", "12h45"), ("14h30", "15h30"), ("15h30", "16h30"), ("16h30", "17h30")]],
        "pauses": {"2": "Récréation", "5": "Pause déjeuner"},
        "ouverts": [8, 8, 5, 8, 8, 4, 0],
    }


def _minutes(t: str) -> int:
    h, m = t.split("h")
    return int(h) * 60 + int(m)


def clean(data) -> dict:
    """Vérifie et normalise des horaires. Lève ValueError(message) si quelque chose est incohérent."""
    if not isinstance(data, dict):
        raise ValueError("Horaires invalides.")
    cr = data.get("creneaux")
    if not isinstance(cr, list) or not 1 <= len(cr) <= MAX_SLOTS:
        raise ValueError(f"Indiquez entre 1 et {MAX_SLOTS} créneaux par jour.")
    slots, prev_end = [], -1
    for i, c in enumerate(cr, 1):
        d, f = (str(c.get("debut", "")).strip().lower(), str(c.get("fin", "")).strip().lower()) if isinstance(c, dict) else ("", "")
        if not _TIME.match(d) or not _TIME.match(f):
            raise ValueError(f"Créneau {i} : écrivez les heures sous la forme 07h30.")
        if _minutes(d) >= _minutes(f):
            raise ValueError(f"Créneau {i} : l’heure de fin doit être après l’heure de début.")
        if _minutes(d) < prev_end:
            raise ValueError(f"Créneau {i} : il commence avant la fin du créneau précédent.")
        prev_end = _minutes(f)
        slots.append({"debut": d, "fin": f})
    pauses_in = data.get("pauses") or {}
    if not isinstance(pauses_in, dict):
        raise ValueError("Pauses invalides.")
    pauses = {}
    for k, v in pauses_in.items():
        try:
            idx = int(k)
        except (TypeError, ValueError):
            raise ValueError("Pause invalide.") from None
        label = str(v or "").strip()[:40]
        if not 1 <= idx < len(slots):
            raise ValueError("Une pause se place entre deux créneaux.")
        if label:
            pauses[str(idx)] = label
    ouverts = data.get("ouverts")
    if isinstance(ouverts, list) and len(ouverts) == len(DAYS) - 1:
        ouverts = [*ouverts, 0]   # anciens horaires, sans dimanche
    if not isinstance(ouverts, list) or len(ouverts) != len(DAYS):
        raise ValueError("Indiquez le nombre de créneaux pour chaque jour, du lundi au dimanche.")
    try:
        ouverts = [int(x) for x in ouverts]
    except (TypeError, ValueError):
        raise ValueError("Nombre de créneaux invalide.") from None
    if any(not 0 <= x <= len(slots) for x in ouverts):
        raise ValueError("Un jour ne peut pas avoir plus de cours que de créneaux.")
    if not any(ouverts):
        raise ValueError("Au moins un jour doit avoir des cours.")
    return {"creneaux": slots, "pauses": pauses, "ouverts": ouverts}


class Horaires:
    """Lecture pratique des horaires (déjà normalisés)."""

    def __init__(self, data: dict | None = None):
        d = data or default_horaires()
        self.slots = [(c["debut"], c["fin"]) for c in d["creneaux"]]
        self.pauses = {int(k): v for k, v in (d.get("pauses") or {}).items()}
        self.ouverts = list(d["ouverts"]) + [0] * (len(DAYS) - len(d["ouverts"]))
        self.data = d

    def slots_open(self, day: int) -> int:
        return self.ouverts[day] if 0 <= day < len(self.ouverts) else 0

    def is_open(self, day: int, slot: int) -> bool:
        return 0 <= slot < self.slots_open(day)

    @property
    def breaks(self) -> dict[int, str]:
        """Pause avant le créneau i, avec ses heures : « Récréation · 09h30 à 09h45 »."""
        out = {}
        for i, label in self.pauses.items():
            if 0 < i < len(self.slots):
                a, b = self.slots[i - 1][1], self.slots[i][0]
                out[i] = f"{label} · {a} à {b}" if a != b else label
        return out

    @property
    def pairs(self) -> list[tuple[int, int]]:
        """Couples de créneaux qui se suivent sans pause : possibles pour un cours de deux heures."""
        return [(i, i + 1) for i in range(len(self.slots) - 1) if (i + 1) not in self.pauses]

    @property
    def day_order(self) -> list[int]:
        """Jours dans l'ordre de préférence pour placer les cours (mercredi, samedi et dimanche en dernier)."""
        return [d for d in (0, 1, 3, 4, 2, 5, 6) if self.ouverts[d] > 0]
