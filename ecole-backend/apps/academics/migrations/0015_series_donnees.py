"""Séries propres à chaque école et coefficients par niveau du collège.

- Chaque école reçoit ses séries : celles d'origine (2nde A, C ; 1ère et Tle A, C, D) et toutes celles déjà utilisées par ses classes.
- Les groupes de coefficients prennent leur nouveau nom : « 6e et 5e » (c1) devient « 6e » et « 5e » (mêmes coefficients recopiés),
  « 4e et 3e » (c2) devient « 4e » et « 3e », « 2A » devient « 2nde A », « TD » devient « Tle D »…
- Le groupe de chaque classe est recalculé. Rien n'est perdu : chaque coefficient existant se retrouve sous son nouveau nom.
"""
from django.db import migrations

DEFAULT_SERIES = {"2nde": ["A", "C"], "1ère": ["A", "C", "D"], "Tle": ["A", "C", "D"]}
PREFIX = {"2": "2nde", "1": "1ère", "T": "Tle"}
SPLIT = {"c1": ("6e", "5e"), "c2": ("4e", "3e")}


def new_groupe(level, serie):
    if level in ("6e", "5e", "4e", "3e"):
        return level
    return f"{level} {serie.strip().upper()}" if serie else level


def forwards(apps, schema_editor):
    Etablissement = apps.get_model("core", "Etablissement")
    Serie = apps.get_model("academics", "Serie")
    SchoolClass = apps.get_model("academics", "SchoolClass")
    Coefficient = apps.get_model("academics", "Coefficient")
    for etab in Etablissement.objects.all():
        wanted = {(lv, c) for lv, codes in DEFAULT_SERIES.items() for c in codes}
        wanted |= {(c.level, c.serie.strip().upper()) for c in SchoolClass.objects.filter(etablissement=etab, level__in=PREFIX.values()) if c.serie}
        for g in Coefficient.objects.filter(etablissement=etab).values_list("groupe", flat=True).distinct():
            if g[:1] in PREFIX and g not in SPLIT and len(g) >= 2 and " " not in g:
                wanted.add((PREFIX[g[0]], g[1:]))
        for lv, code in sorted(wanted):
            Serie.objects.get_or_create(etablissement=etab, level=lv, code=code)
    for c in SchoolClass.objects.all():
        c.serie = c.serie.strip().upper()
        c.groupe = new_groupe(c.level, c.serie)
        c.save(update_fields=["serie", "groupe"])
    for co in list(Coefficient.objects.all()):
        g = co.groupe
        if g in SPLIT:
            for lv in SPLIT[g]:
                Coefficient.objects.get_or_create(etablissement_id=co.etablissement_id, groupe=lv, subject_id=co.subject_id, defaults={"value": co.value})
            co.delete()
        elif g[:1] in PREFIX and " " not in g:
            co.groupe = f"{PREFIX[g[0]]} {g[1:]}"
            co.save(update_fields=["groupe"])


class Migration(migrations.Migration):

    dependencies = [
        ("academics", "0014_series_ecole"),
        ("core", "0004_abonnement"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
