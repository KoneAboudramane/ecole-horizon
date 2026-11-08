"""Rôles et droits d'une école : la direction (ou la personne à qui le fondateur a confié ce droit) les gère."""
from django.db import transaction
from django.utils.text import slugify
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.errors import field_error
from apps.core.log import record
from apps.core.permissions import CUSTOM_BASES, LOCKED_ROLES, PERM_CATALOG, ROLE_TEMPLATES, perm_required, perms_for

from .models import Role, User

CATALOG_KEYS = {p for p, _g, _l in PERM_CATALOG}
LABEL_OF = {p: label for p, _g, label in PERM_CATALOG}
NEED_MANAGER = {"detail": "Au moins une personne active doit pouvoir gérer les rôles. Donnez d’abord ce droit à une autre personne."}


def grantable(actor) -> set[str]:
    """Droits que l'acteur peut donner ou retirer : le fondateur, tous ; une personne déléguée, seulement les siens."""
    return set(CATALOG_KEYS) if actor.role == "fondateur" else perms_for(actor) & CATALOG_KEYS


def manager_roles(override: dict[int, list[str]] | None = None, deleted: int | None = None) -> set[int]:
    out = set()
    for r in Role.objects.all():
        if r.pk == deleted:
            continue
        perms = override[r.pk] if override and r.pk in override else r.perms
        if "roles.manage" in perms:
            out.add(r.pk)
    return out


def another_manager_remains(*, exclude_user: int | None = None, override: dict[int, list[str]] | None = None, deleted: int | None = None) -> bool:
    """Reste-t-il au moins un compte actif qui peut gérer les rôles, après le changement prévu ?"""
    ids = manager_roles(override, deleted)
    qs = User.objects.filter(is_active=True, role_ref_id__in=ids)
    if exclude_user:
        qs = qs.exclude(pk=exclude_user)
    return qs.exists()


def role_dict(r: Role, members: int) -> dict:
    return {"id": r.pk, "key": r.key, "label": r.label, "base": r.base, "perms": sorted(r.perms), "locked": r.locked, "builtin": r.builtin, "members": members}


class RoleInput(serializers.Serializer):
    label = serializers.CharField(min_length=2, max_length=60)
    perms = serializers.ListField(child=serializers.CharField(), allow_empty=True)
    scope = serializers.ChoiceField(choices=CUSTOM_BASES, required=False, default="personnel")

    def validate_perms(self, v):
        bad = [p for p in v if p not in CATALOG_KEYS]
        if bad:
            raise serializers.ValidationError("Droit inconnu : " + ", ".join(bad))
        return sorted(set(v))


def label_taken(label: str, exclude_pk=None) -> bool:
    qs = Role.objects.filter(label__iexact=label.strip())
    return (qs.exclude(pk=exclude_pk) if exclude_pk else qs).exists()


def check_grant(actor, old: set[str], new: set[str]):
    over = (old ^ new) - grantable(actor)
    if over:
        names = ", ".join(LABEL_OF.get(p, p) for p in sorted(over))
        return field_error({"perms": [f"Vous ne pouvez pas accorder ni retirer des droits que vous n’avez pas vous-même : {names}."]}, 403)
    return None


class RoleList(APIView):
    permission_classes = [perm_required("roles.manage")]

    @extend_schema(responses={200: {"type": "object"}})
    def get(self, request):
        counts = {}
        for rid in User.objects.filter(role_ref__isnull=False).values_list("role_ref_id", flat=True):
            counts[rid] = counts.get(rid, 0) + 1
        return Response({
            "roles": [role_dict(r, counts.get(r.pk, 0)) for r in Role.objects.all()],
            "catalog": [{"perm": p, "group": g, "label": label} for p, g, label in PERM_CATALOG],
            "grantable": sorted(grantable(request.user)),
            "templates": ROLE_TEMPLATES,
        })

    @extend_schema(request=RoleInput, responses={201: {"type": "object"}})
    @transaction.atomic
    def post(self, request):
        s = RoleInput(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        if label_taken(d["label"]):
            return field_error({"label": ["Un rôle porte déjà ce nom."]})
        denied = check_grant(request.user, set(), set(d["perms"]))
        if denied:
            return denied
        base = slugify(d["label"])[:36] or "role"
        key, n = base, 2
        while Role.objects.filter(key=key).exists():
            key, n = f"{base}-{n}", n + 1
        r = Role.objects.create(key=key, label=d["label"].strip(), base=d["scope"], perms=d["perms"])
        record("Rôle créé", f"{r.label} : {len(r.perms)} droit(s)", request=request)
        return Response(role_dict(r, 0), status=status.HTTP_201_CREATED)


class RoleDetail(APIView):
    permission_classes = [perm_required("roles.manage")]

    def get_role(self, pk) -> Role:
        from rest_framework.generics import get_object_or_404
        return get_object_or_404(Role.objects.all(), pk=pk)

    @extend_schema(request=RoleInput, responses={200: {"type": "object"}})
    @transaction.atomic
    def patch(self, request, pk):
        r = self.get_role(pk)
        if r.locked:
            return Response({"detail": "Les droits des parents et des élèves ne changent pas : ils protègent les données des enfants."}, status=400)
        if r.base == "fondateur" and request.user.role != "fondateur":
            return Response({"detail": "Seul le fondateur modifie le rôle de fondateur."}, status=403)
        s = RoleInput(data={"label": r.label, "perms": r.perms, "scope": r.base if r.base in CUSTOM_BASES else "personnel", **request.data}, partial=True)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        new_perms = set(d["perms"])
        if r.base == "fondateur" and "roles.manage" not in new_perms:
            return Response({"detail": "Le fondateur garde toujours le droit de gérer les rôles."}, status=400)
        if label_taken(d["label"], exclude_pk=r.pk):
            return field_error({"label": ["Un rôle porte déjà ce nom."]})
        denied = check_grant(request.user, set(r.perms), new_perms)
        if denied:
            return denied
        if "roles.manage" in r.perms and "roles.manage" not in new_perms and not another_manager_remains(override={r.pk: sorted(new_perms)}):
            return Response(NEED_MANAGER, status=400)
        added, removed = sorted(new_perms - set(r.perms)), sorted(set(r.perms) - new_perms)
        r.label, r.perms = d["label"].strip(), sorted(new_perms)
        r.save()
        if added or removed:
            record("Droits d’un rôle modifiés", f"{r.label} : " + ", ".join([f"+{p}" for p in added] + [f"-{p}" for p in removed]), request=request)
        else:
            record("Rôle renommé", r.label, request=request)
        return Response(role_dict(r, r.members.count()))

    @extend_schema(responses={204: None})
    @transaction.atomic
    def delete(self, request, pk):
        r = self.get_role(pk)
        if r.locked or r.base == "fondateur":
            return Response({"detail": "Ce rôle ne peut pas être supprimé."}, status=400)
        n = r.members.count()
        if n:
            return Response({"detail": f"{n} compte(s) ont ce rôle : changez d’abord leur rôle, puis supprimez-le."}, status=400)
        if "roles.manage" in r.perms and not another_manager_remains(deleted=r.pk):
            return Response(NEED_MANAGER, status=400)
        label = r.label
        r.delete()
        record("Rôle supprimé", label, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class RoleChoices(APIView):
    """Rôles proposés quand on crée ou modifie un compte du personnel."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: {"type": "array"}})
    def get(self, request):
        from apps.core.permissions import has_perm
        if not (has_perm(request.user, "accounts") or has_perm(request.user, "roles.manage")):
            return Response({"detail": "Vous n’avez pas le droit d’effectuer cette action."}, status=403)
        return Response([{"id": r.pk, "key": r.key, "label": r.label, "base": r.base} for r in Role.objects.exclude(base__in=LOCKED_ROLES)])
