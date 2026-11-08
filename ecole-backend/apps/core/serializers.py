from rest_framework import serializers

from .tenancy import UNSET, current_cursus, current_or_default, default_cursus_id


def _cursus_for_new() -> int:
    """Cursus que recevra une nouvelle ligne : le cursus courant, sinon le premier cursus de l'école."""
    cur = current_cursus()
    return cur if cur is not UNSET else default_cursus_id(current_or_default())


class UniqueInSchoolMixin:
    """Rétablit le contrôle « existe déjà » pour les unicités qui portent désormais sur (établissement, champ).

    DRF ne génère pas de validateur quand une contrainte contient un champ absent du formulaire (l'établissement) ;
    on le fait ici, dans l'école courante (le gestionnaire `objects` filtre déjà par établissement).
    """

    def run_validation(self, data=serializers.empty):
        attrs = super().run_validation(data)
        model = self.Meta.model
        for c in model._meta.constraints:
            fields = getattr(c, "fields", None)
            if not fields or getattr(c, "condition", None) or "etablissement" not in fields:
                continue
            others = [f for f in fields if f not in ("etablissement", "cursus")]
            values = {}
            if "cursus" in fields:   # unicité dans le cursus de la ligne (cursus courant pour une création)
                values["cursus_id"] = self.instance.cursus_id if self.instance is not None else _cursus_for_new()
            for f in others:
                if f in attrs:
                    values[f] = attrs[f]
                elif self.instance is not None:
                    values[f] = getattr(self.instance, f)
            if len([f for f in values if f != "cursus_id"]) != len(others):
                continue
            qs = model.objects.filter(**values)
            if self.instance is not None:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({others[0]: "Cette valeur existe déjà."})
        return attrs
