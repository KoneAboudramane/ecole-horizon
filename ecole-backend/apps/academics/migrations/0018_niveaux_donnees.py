"""Niveaux propres à chaque école : ceux d'origine (6e … Tle) dans l'ordre du cursus, puis tout autre niveau déjà utilisé
par une classe (ajouté à la fin, avec le cycle de la classe ; « à séries » si la classe a une série)."""
from django.db import migrations

DEFAULT_LEVELS = [("6e", "college", False), ("5e", "college", False), ("4e", "college", False), ("3e", "college", False),
                  ("2nde", "lycee", True), ("1ère", "lycee", True), ("Tle", "lycee", True)]


def forwards(apps, schema_editor):
    Etablissement = apps.get_model("core", "Etablissement")
    Level = apps.get_model("academics", "Level")
    SchoolClass = apps.get_model("academics", "SchoolClass")
    for etab in Etablissement.objects.all():
        if Level.objects.filter(etablissement=etab).exists():
            continue
        rows = list(DEFAULT_LEVELS)
        known = {n for n, _, _ in rows}
        for c in SchoolClass.objects.filter(etablissement=etab).order_by("id"):
            if c.level and c.level not in known:
                rows.append((c.level, c.cycle or "college", bool(c.serie)))
                known.add(c.level)
        for i, (n, cy, se) in enumerate(rows):
            Level.objects.create(etablissement=etab, name=n, order=i, cycle=cy, has_series=se)


class Migration(migrations.Migration):

    dependencies = [
        ("academics", "0017_niveaux_ecole"),
        ("core", "0004_abonnement"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
