"""Multi-établissement : une seule base, plusieurs écoles, des données strictement cloisonnées.

Principe : chaque requête authentifiée s'exécute « dans » un établissement (variable de contexte). Tous les
modèles métier héritent de `TenantModel` : leur gestionnaire `objects` ne renvoie que les lignes de
l'établissement courant, et l'enregistrement d'une ligne y rattache automatiquement l'établissement.

États du contexte :
- non défini (commandes, tests, tâches internes) : aucun filtre, les créations vont à l'école par défaut ;
- un identifiant : seules les données de cette école sont visibles ;
- `NO_SCHOOL` : requête sans école (super-administrateur seul) : rien n'est visible, rien ne peut être créé.

Cursus (école franco-arabe ou autre) : second niveau de cloisonnement, à l'intérieur de l'école. Un modèle propre à un
cursus déclare `CURSUS_LOOKUP` : « cursus » s'il porte le cursus, sinon le chemin qui y mène (« school_class__cursus »).
Quand la requête précise un cursus (en-tête `X-Cursus`), `objects` ne renvoie que les lignes de ce cursus ; sans cursus
précisé (commandes, tests, anciens clients), aucun filtre de cursus. Une ligne créée reçoit le cursus courant, sinon le
premier cursus de l'école.
"""
from __future__ import annotations

import contextvars
from contextlib import contextmanager

from django.db import models

UNSET = object()
NO_SCHOOL = -1
_current: contextvars.ContextVar = contextvars.ContextVar("etablissement", default=UNSET)
_cursus: contextvars.ContextVar = contextvars.ContextVar("cursus", default=UNSET)


def current():
    return _current.get()


def set_current(value):
    return _current.set(value)


def reset_current(token):
    _current.reset(token)


@contextmanager
def tenant_context(etab):
    """Exécute un bloc dans un établissement (instance, identifiant, `NO_SCHOOL` ou `None` pour « sans filtre »)."""
    value = UNSET if etab is None else (etab.pk if hasattr(etab, "pk") else etab)
    token = _current.set(value)
    try:
        yield
    finally:
        _current.reset(token)


def current_cursus():
    return _cursus.get()


def set_cursus(value):
    return _cursus.set(value)


def reset_cursus(token):
    _cursus.reset(token)


@contextmanager
def cursus_context(cursus):
    """Exécute un bloc dans un cursus (instance ou identifiant) ; `None` : sans filtre de cursus (toute l'école)."""
    token = _cursus.set(UNSET if cursus is None else (cursus.pk if hasattr(cursus, "pk") else cursus))
    try:
        yield
    finally:
        _cursus.reset(token)


def default_cursus_id(etab_id: int) -> int:
    """Premier cursus de l'école (le cursus français, créé avec elle)."""
    from apps.academics.models import DEFAULT_CURSUS, Cursus
    c = Cursus.all_objects.filter(etablissement_id=etab_id).order_by("ordre", "id").values_list("pk", flat=True).first()
    return c or Cursus.all_objects.create(etablissement_id=etab_id, **DEFAULT_CURSUS).pk


def _fill_cursus(obj):
    """Rattache une nouvelle ligne au cursus courant, sinon au premier cursus de son école."""
    if getattr(obj, "CURSUS_LOOKUP", None) == "cursus" and obj.cursus_id is None:
        cur = _cursus.get()
        obj.cursus_id = cur if cur is not UNSET else default_cursus_id(obj.etablissement_id)
        return True
    return False


def default_etablissement_id() -> int:
    from .models import Etablissement
    obj = Etablissement.objects.order_by("id").first()
    if obj is None:
        obj = Etablissement.objects.create(code="principal", nom="Établissement principal")
    return obj.pk


def current_or_default() -> int:
    """Établissement auquel rattacher une nouvelle ligne."""
    cur = _current.get()
    if cur is UNSET:
        return default_etablissement_id()
    if cur == NO_SCHOOL:
        raise PermissionError("Aucun établissement sélectionné : cette opération doit se faire dans une école.")
    return cur


class TenantQuerySet(models.QuerySet):
    def bulk_create(self, objs, *a, **kw):
        objs = list(objs)
        for o in objs:
            if o.etablissement_id is None:
                o.etablissement_id = current_or_default()
            _fill_cursus(o)
        return super().bulk_create(objs, *a, **kw)


class TenantManagerMixin:
    def get_queryset(self):
        qs = super().get_queryset()
        cur = _current.get()
        if cur is not UNSET:
            qs = qs.filter(etablissement_id=cur)
        lookup, cursus = getattr(self.model, "CURSUS_LOOKUP", None), _cursus.get()
        if lookup and cursus is not UNSET:
            qs = qs.filter(**{f"{lookup}_id": cursus})
        return qs


class TenantManager(TenantManagerMixin, models.Manager.from_queryset(TenantQuerySet)):
    pass


class Lazy(models.Manager):
    """Fait passer un queryset construit à la demande (donc dans le bon établissement) là où DRF attend un
    gestionnaire : `PrimaryKeyRelatedField(queryset=Lazy(Student, lambda: Student.objects.filter(active=True)))`."""

    def __init__(self, model, fn):
        super().__init__()
        self.model = model  # le générateur de schéma OpenAPI en a besoin
        self._fn = fn

    def all(self):
        return self._fn()


class TenantModel(models.Model):
    etablissement = models.ForeignKey("core.Etablissement", on_delete=models.CASCADE, related_name="+", verbose_name="établissement")

    objects = TenantManager()
    all_objects = models.Manager()  # sans filtre : réservé au code de plateforme (connexion, vérification publique)

    class Meta:
        abstract = True

    def save(self, *a, **kw):
        if self.etablissement_id is None:
            self.etablissement_id = current_or_default()
            fields = kw.get("update_fields")
            if fields is not None:
                kw["update_fields"] = list(fields) + ["etablissement"]
        if _fill_cursus(self) and kw.get("update_fields") is not None:
            kw["update_fields"] = list(kw["update_fields"]) + ["cursus"]
        super().save(*a, **kw)
