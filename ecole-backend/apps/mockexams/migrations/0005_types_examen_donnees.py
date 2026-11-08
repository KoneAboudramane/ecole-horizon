"""Types d'examen propres à chaque école : le BEPC et le BAC d'origine sont créés (avec leurs coefficients indicatifs),
et chaque session existante y est rattachée. Une session BAC garde ses coefficients par série."""
from django.db import migrations

DEFAULTS = [
    ("BEPC", ["3e"], False, {"*": {"fr": 3, "ma": 3, "an": 2, "hg": 2, "pc": 2, "sv": 1, "eps": 1}}),
    ("BAC", ["Tle"], True, {"A": {"fr": 4, "ph": 4, "hg": 3, "an": 3, "lv2": 2, "ma": 2, "eps": 1},
                            "C": {"ma": 5, "pc": 4, "sv": 2, "ph": 2, "fr": 2, "an": 2, "hg": 2, "eps": 1},
                            "D": {"ma": 4, "pc": 4, "sv": 4, "ph": 2, "fr": 2, "an": 2, "hg": 2, "eps": 1}}),
]


def forwards(apps, schema_editor):
    Etablissement = apps.get_model("core", "Etablissement")
    ExamType = apps.get_model("mockexams", "ExamType")
    MockSession = apps.get_model("mockexams", "MockSession")
    for etab in Etablissement.objects.all():
        types = {}
        for name, levels, per_serie, coefs in DEFAULTS:
            types[name], _ = ExamType.objects.get_or_create(etablissement=etab, name=name, defaults={"levels": levels, "per_serie": per_serie, "coefs": coefs})
        for s in MockSession.objects.filter(etablissement=etab):
            et = types.get(s.type)
            s.exam_type = et
            s.per_serie = bool(et and et.per_serie)
            s.save(update_fields=["exam_type", "per_serie"])


class Migration(migrations.Migration):

    dependencies = [
        ("mockexams", "0004_types_examen"),
        ("core", "0004_abonnement"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
