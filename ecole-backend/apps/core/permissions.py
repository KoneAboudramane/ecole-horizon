"""Matrice des permissions : qui peut faire quoi.

Source de vérité côté serveur. Elle reprend à l'identique la matrice du prototype Angular
(`PERMS` dans `src/app/models.ts`) ; `scripts/check_perms_sync.py` vérifie qu'elles restent alignées.
Le serveur revérifie toujours : le masquage d'un bouton dans l'interface n'est jamais une protection.
"""
from rest_framework.permissions import BasePermission

ROLES = ["fondateur", "directeur", "admin", "enseignant", "educateur", "comptable", "informatique", "personnel", "parent", "eleve"]

ROLE_LABELS = {
    "fondateur": "Fondateur",
    "directeur": "Directeur",
    "admin": "Secrétariat",
    "enseignant": "Enseignant",
    "educateur": "Éducateur",
    "comptable": "Comptable",
    "informatique": "Informatique",
    "personnel": "Personnel",
    "parent": "Parent",
    "eleve": "Élève",
}

# Rôles dont le compte est créé par l'administration (parents et élèves le sont à l'inscription).
STAFF_ROLES = ["fondateur", "directeur", "admin", "enseignant", "educateur", "comptable", "informatique", "personnel"]

PERMS: dict[str, set[str]] = {
    "fondateur": {"pay.read", "tarifs.write", "journal", "stats.academic", "stats.finance", "stats.vie", "roles.manage"},
    "directeur": {
        "subjects.write", "settings", "publish", "conseil", "bulletins.gen", "justifs", "discipline",
        "discipline.validate", "pay.read", "annonces.write", "journal", "grades.locked", "decisions.write",
        "rollover", "edt.write", "examens.write", "devoirs.read", "stats.academic", "stats.finance", "stats.vie", "conduite", "educateurs.write",
    },
    "admin": {
        "students.write", "classes.write", "subjects.write", "accounts", "settings", "bulletins.gen",
        "annonces.write", "journal", "edt.write", "examens.write", "educateurs.write",
    },
    "enseignant": {"appel", "cahier.write", "devoirs.write", "stats.academic"},
    "educateur": {"appel", "justifs", "discipline", "conduite", "stats.vie"},
    "comptable": {"pay.write", "pay.read", "tarifs.write", "rapprochement.write", "stats.finance"},
    # Service informatique : comptes du personnel, journal, réglages techniques (nom, logo, couleur).
    # Aucun accès aux notes, bulletins, paiements, discipline ni dossiers élèves ; ne gère pas les comptes direction/fondateur.
    "informatique": {"accounts", "journal.sys", "settings.tech"},
    # Rôle de base des rôles créés par l'école : voit toute l'école, mais seulement selon les droits que l'école lui donne.
    "personnel": set(),
    "parent": set(),
    "eleve": set(),
}
DEFAULT_PERMS = PERMS  # point de départ de chaque école ; ensuite les droits de chaque rôle sont dans la base (apps.accounts.models.Role)

# Rôles dont les droits ne changent jamais : ils dépendent de la confidentialité des données des enfants.
LOCKED_ROLES = ("parent", "eleve")

# Catalogue des droits tel que la direction le voit : (droit, groupe, ce que ça permet). Aucun droit ne peut être inventé par une école.
PERM_CATALOG: list[tuple[str, str, str]] = [
    ("students.write", "Élèves et classes", "Inscrire et modifier les élèves"),
    ("classes.write", "Élèves et classes", "Créer et modifier les classes"),
    ("subjects.write", "Élèves et classes", "Gérer les matières et leurs coefficients"),
    ("appel", "Vie scolaire", "Faire l'appel et saisir les absences"),
    ("justifs", "Vie scolaire", "Traiter les justificatifs d'absence"),
    ("discipline", "Vie scolaire", "Saisir les incidents et sanctions"),
    ("discipline.validate", "Vie scolaire", "Valider les sanctions graves"),
    ("conduite", "Vie scolaire", "Gérer la conduite"),
    ("educateurs.write", "Vie scolaire", "Affecter les éducateurs aux classes"),
    ("cahier.write", "Pédagogie", "Remplir le cahier de textes"),
    ("devoirs.write", "Pédagogie", "Envoyer devoirs, épreuves, supports et cours en direct"),
    ("devoirs.read", "Pédagogie", "Consulter les devoirs et supports (lecture seule)"),
    ("edt.write", "Pédagogie", "Modifier l'emploi du temps"),
    ("examens.write", "Pédagogie", "Organiser les examens blancs"),
    ("publish", "Notes et bulletins", "Publier les notes"),
    ("grades.locked", "Notes et bulletins", "Intervenir dans une période verrouillée (les notes restent à leur enseignant)"),
    ("conseil", "Notes et bulletins", "Tenir le conseil de classe"),
    ("bulletins.gen", "Notes et bulletins", "Générer les bulletins"),
    ("decisions.write", "Notes et bulletins", "Prendre les décisions de fin d'année"),
    ("rollover", "Notes et bulletins", "Passer à la nouvelle année"),
    ("pay.read", "Finances", "Consulter les paiements"),
    ("pay.write", "Finances", "Enregistrer les paiements"),
    ("tarifs.write", "Finances", "Fixer les tarifs"),
    ("rapprochement.write", "Finances", "Rapprocher les paiements mobiles"),
    ("annonces.write", "Communication", "Publier des annonces"),
    ("accounts", "Administration", "Gérer les comptes du personnel"),
    ("settings", "Administration", "Modifier les réglages de l'école"),
    ("settings.tech", "Administration", "Modifier nom, logo et couleur"),
    ("journal", "Administration", "Consulter le journal d'activité"),
    ("journal.sys", "Administration", "Consulter le journal technique"),
    ("roles.manage", "Administration", "Gérer les rôles et les droits"),
    ("stats.academic", "Statistiques", "Voir les statistiques scolaires"),
    ("stats.finance", "Statistiques", "Voir les statistiques financières"),
    ("stats.vie", "Statistiques", "Voir les statistiques de vie scolaire"),
]

# Modèles proposés à la direction pour créer un rôle propre à l'école (elle peut ensuite tout changer).
ROLE_TEMPLATES: list[dict] = [
    {"label": "Surveillant général", "scope": "personnel", "perms": ["appel", "justifs", "discipline", "conduite", "educateurs.write", "stats.vie"]},
    {"label": "Économe", "scope": "personnel", "perms": ["pay.read", "pay.write", "tarifs.write", "rapprochement.write", "stats.finance"]},
    {"label": "Censeur", "scope": "personnel", "perms": ["conseil", "bulletins.gen", "edt.write", "examens.write", "discipline", "stats.academic"]},
    {"label": "Secrétaire", "scope": "personnel", "perms": ["students.write", "classes.write", "annonces.write"]},
]
CUSTOM_BASES = ("personnel", "enseignant", "educateur")  # portée d'un rôle créé par l'école : toute l'école selon ses droits, ses classes d'enseignement, ou les classes confiées par la direction

ALL_PERMS = sorted(set().union(*PERMS.values()))


def perms_of(role: str) -> list[str]:
    """Droits PAR DÉFAUT d'un rôle (point de départ d'une école). Les droits réels sont ceux du rôle de l'école : `perms_for`."""
    return sorted(DEFAULT_PERMS.get(role, set()))


def perms_for(user) -> set[str]:
    """Droits réels d'un compte : ceux du rôle de son école (modifiables), à défaut les droits par défaut.
    Mis en cache sur l'objet compte : chaque requête recharge le compte, donc un changement s'applique à la requête suivante."""
    if user is None or not getattr(user, "is_authenticated", False):
        return set()
    cached = getattr(user, "_perms_cache", None)
    if cached is not None and cached[0] == user.role and cached[1] == getattr(user, "role_ref_id", None):
        return cached[2]
    perms = None
    if user.role in LOCKED_ROLES:
        perms = set()
    else:
        from apps.accounts.models import Role
        role = None
        if getattr(user, "role_ref_id", None):
            role = user.role_ref
        elif user.etablissement_id:
            role = Role.all_objects.filter(etablissement_id=user.etablissement_id, key=user.role).first()
        if role is not None:
            perms = set(role.perms)
    if perms is None:
        perms = set(DEFAULT_PERMS.get(user.role, set()))
    user._perms_cache = (user.role, getattr(user, "role_ref_id", None), perms)
    return perms


def has_perm(user, perm: str) -> bool:
    return bool(user and user.is_authenticated and user.is_active and perm in perms_for(user))


def perm_required(*perms: str):
    """Fabrique une permission DRF : l'utilisateur doit posséder au moins une des permissions données."""

    class _HasPerm(BasePermission):
        message = "Vous n’avez pas le droit d’effectuer cette action."

        def has_permission(self, request, view):
            return any(has_perm(request.user, p) for p in perms)

    _HasPerm.__name__ = "HasPerm_" + "_".join(p.replace(".", "_") for p in perms)
    return _HasPerm
