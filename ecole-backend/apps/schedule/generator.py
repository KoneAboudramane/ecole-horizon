"""Génération déterministe de l'emploi du temps (port de generateTimetable du prototype).
Garantie : jamais deux cours pour la même classe, le même enseignant ou la même salle au même créneau."""

from apps.academics.horaires import Horaires

SPORT, LAB = "Terrain de sport", "Laboratoire"


def split_hours(h: int) -> list[int]:
    return [1] if h <= 1 else [2] if h == 2 else [2, 1] if h == 3 else [2, 2] if h == 4 else [2, 2, 1]


def generate(classes, assignments, hours_of, horaires=None, homes=None, labs=None, sports=None, blocked=None, avoid=None):
    """classes : [(id, ordre)] ; assignments : [(class_id, subject_code, subject_id, teacher_id)] ; hours_of(class_id, subject_id) → heures.
    Renvoie (cellules [(class_id, day, slot, subject_id, room)], nombre de blocs non placés).
    `homes` {classe: salle principale}, `labs` et `sports` : salles spécialisées de l'école (None = les salles d'origine).
    `blocked` {(enseignant, jour, créneau)} : jamais utilisés ; `avoid` : utilisés seulement en dernier recours."""
    hr = horaires or Horaires()
    blocked, avoid = blocked or set(), avoid or set()
    homes = homes or {}
    labs = [LAB] if labs is None else labs
    sports = [SPORT] if sports is None else sports
    cells, unplaced = [], 0
    teacher_busy, class_busy, room_busy, load = set(), set(), set(), {}
    for ci, cl in enumerate(classes):
        home = homes.get(cl) or f"Salle {ci + 1}"
        subs = [(a, min(5, 2 if a[1] == "eps" else hours_of(cl, a[2]))) for a in assignments if a[0] == cl]
        subs.sort(key=lambda x: (-x[1], x[0][1]))
        blocks = []
        for a, h in subs:
            for length in split_hours(h):
                blocks.append({"code": a[1], "subj": a[2], "teacher": a[3], "len": length})
        blocks.sort(key=lambda b: -b["len"])  # tri stable, comme en JS
        days_used: dict[int, set[int]] = {}

        def try_place(b, strict, soft=True):
            days = sorted(hr.day_order, key=lambda d: (load.get((cl, d), 0), (d + ci) % 6))
            sport = b["code"] == "eps"
            for day in days:
                if strict and day in days_used.get(b["subj"], set()):
                    continue
                if b["len"] == 2:
                    options = [[x, y] for x, y in hr.pairs if hr.is_open(day, y)]
                else:
                    options = [[i] for i in range(hr.slots_open(day))]
                options.sort(key=lambda p: -p[0] if sport else p[0])
                for slots in options:
                    def free(name, slots=slots, day=day):
                        return all((name, day, sl) not in room_busy for sl in slots)

                    pool = sports if sport else labs if (b["code"] == "pc" and b["len"] == 2) else []
                    room = next((r for r in pool if free(r)), None) or (None if sport and sports else home)
                    if room is None:
                        continue
                    if not all((cl, day, sl) not in class_busy and (b["teacher"], day, sl) not in teacher_busy and (room, day, sl) not in room_busy for sl in slots):
                        continue
                    if any((b["teacher"], day, sl) in blocked or (soft and (b["teacher"], day, sl) in avoid) for sl in slots):
                        continue
                    for sl in slots:
                        cells.append((cl, day, sl, b["subj"], room))
                        class_busy.add((cl, day, sl))
                        teacher_busy.add((b["teacher"], day, sl))
                        room_busy.add((room, day, sl))
                    load[(cl, day)] = load.get((cl, day), 0) + len(slots)
                    days_used.setdefault(b["subj"], set()).add(day)
                    return True
            return False

        bi = 0
        while bi < len(blocks):
            b = blocks[bi]
            bi += 1
            if try_place(b, True) or try_place(b, False) or (avoid and try_place(b, False, soft=False)):
                continue
            if b["len"] == 2:
                blocks += [{**b, "len": 1}, {**b, "len": 1}]
            else:
                unplaced += 1
    return cells, unplaced
