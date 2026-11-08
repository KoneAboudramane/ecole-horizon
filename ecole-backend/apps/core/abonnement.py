"""Échéancier de l'abonnement d'une école.

Rien n'est figé ici : tarifs, fin d'année scolaire, nombre de tranches, écart entre tranches, dates du renouvellement et arrondi
viennent des réglages de la plateforme (PlatformSettings), que l'administrateur change à tout moment. Ils ne servent qu'à proposer
un échéancier : pour chaque école, l'administrateur peut fixer lui-même le total, le nombre de tranches, chaque date et chaque montant,
puis modifier une tranche non soldée. L'école garde l'accès jusqu'à l'échéance de sa première tranche non soldée.
"""
import calendar
from datetime import date, timedelta

from django.db import transaction
from django.db.models import Max

from .models import AbonnementTranche, Etablissement, PlatformSettings, add_months

NATURES = ("inscription", "renouvellement")
TRANCHES_MAX = 12


class EcheancierInvalide(ValueError):
    pass


def jour_mois(texte: str) -> tuple[int, int]:
    """« 31/07 » → (31, 7)."""
    try:
        j, m = (int(p) for p in texte.strip().split("/"))
    except ValueError:
        raise EcheancierInvalide(f"Date « {texte.strip()} » : écrivez JJ/MM, par exemple 31/07.") from None
    if not (1 <= m <= 12 and 1 <= j <= 31):
        raise EcheancierInvalide(f"Date « {texte.strip()} » : jour ou mois impossible.")
    return j, m


def le(annee: int, jm: tuple[int, int]) -> date:
    """Le jour/mois dans l'année donnée ; un jour trop grand prend le dernier jour du mois (29/02 → fin février)."""
    j, m = jm
    return date(annee, m, min(j, calendar.monthrange(annee, m)[1]))


def dates_renouvellement(cfg: PlatformSettings) -> list[tuple[int, int]]:
    return [jour_mois(t) for t in cfg.renouvellement_dates.split(",") if t.strip()]


def fin_annee_scolaire(d: date, cfg: PlatformSettings | None = None) -> date:
    """Fin de l'année scolaire couverte par une inscription à la date `d`. Dans les 3 derniers mois de l'année, on s'inscrit pour la suivante."""
    jm = jour_mois((cfg or PlatformSettings.load()).fin_annee)
    fin = le(d.year, jm)
    return le(d.year + 1, jm) if d > add_months(fin, -3) else fin


def decouper(total: int, n: int, arrondi: int = 0) -> list[int]:
    """Répartit `total` en `n` tranches, arrondies au multiple de `arrondi` ; la première absorbe l'écart."""
    if n == 1:
        return [total]
    base = total // n
    if arrondi:
        base = base // arrondi * arrondi or total // n
    return [total - base * (n - 1)] + [base] * (n - 1)


def prochaine_nature(etab: Etablissement) -> str:
    """Une école jamais inscrite commence par l'inscription ; ensuite, ce sont des renouvellements."""
    return "renouvellement" if etab.tranches.exists() or etab.paiements_abonnement.exists() else "inscription"


def _fin_courante(etab: Etablissement) -> date | None:
    return etab.tranches.aggregate(m=Max("periode_fin"))["m"]


def periode(etab: Etablissement, nature: str, jour: date, cfg: PlatformSettings) -> tuple[date, date]:
    """(début, fin) de la période qu'ouvre un paiement : l'année en cours pour une inscription, l'année suivante pour un renouvellement."""
    jm = jour_mois(cfg.fin_annee)
    if nature == "inscription":
        return jour, fin_annee_scolaire(jour, cfg)
    precedente = _fin_courante(etab) or etab.abonnement_fin or jour
    fin = fin_annee_scolaire(precedente + timedelta(days=1), cfg)
    return le(fin.year - 1, jm), fin


def nombre_propose(nature: str, cfg: PlatformSettings) -> int:
    return max(1, cfg.inscription_tranches if nature == "inscription" else len(dates_renouvellement(cfg)))


def plan(etab: Etablissement, nature: str, nombre: int, jour: date, total: int | None = None) -> list[dict]:
    """Échéancier proposé pour une nouvelle période, sans rien enregistrer."""
    cfg = PlatformSettings.load()
    if nature not in NATURES:
        raise EcheancierInvalide("Nature inconnue.")
    if not 1 <= nombre <= TRANCHES_MAX:
        raise EcheancierInvalide(f"Entre 1 et {TRANCHES_MAX} tranches.")
    total = cfg.tarif(nature, etab.multi_cursus) if total is None else total
    debut, fin = periode(etab, nature, jour, cfg)
    if nature == "inscription":
        dates = [add_months(debut, i * max(1, cfg.inscription_ecart_mois)) for i in range(nombre)]
    else:
        # Chaque date réglée tombe à sa première occurrence depuis le début de la période ; au-delà, une tranche par mois.
        dates = sorted(d if (d := le(debut.year, jm)) >= debut else le(debut.year + 1, jm) for jm in dates_renouvellement(cfg)) or [debut]
        dates = dates[:nombre]
        while len(dates) < nombre:
            dates.append(add_months(dates[-1], 1))
    return [{"nature": nature, "numero": i + 1, "nombre": nombre, "echeance": d, "montant": m, "periode_fin": fin}
            for i, (d, m) in enumerate(zip(dates, decouper(total, nombre, cfg.arrondi)))]


def impayees(etab: Etablissement):
    return [t for t in etab.tranches.all() if t.reste > 0]


def echeance_calculee(etab: Etablissement) -> date | None:
    """Échéance d'accès d'après l'échéancier : la première tranche non soldée, sinon la fin de l'année couverte (None sans échéancier)."""
    reste = impayees(etab)
    return reste[0].echeance if reste else _fin_courante(etab)


def recalculer_fin(etab: Etablissement) -> None:
    """Remet l'échéance d'accès sur l'échéancier (un délai accordé à la main tombe au paiement suivant)."""
    fin = echeance_calculee(etab)
    if fin is not None and fin != etab.abonnement_fin:
        etab.abonnement_fin = fin
        etab.save(update_fields=["abonnement_fin"])


def ouvrir(etab: Etablissement, nature: str, tranches: list[dict], jour: date) -> None:
    """Enregistre l'échéancier d'une nouvelle période, tel que l'administrateur l'a fixé (dates et montants)."""
    if nature not in NATURES:
        raise EcheancierInvalide("Nature inconnue.")
    if not 1 <= len(tranches) <= TRANCHES_MAX:
        raise EcheancierInvalide(f"Entre 1 et {TRANCHES_MAX} tranches.")
    dates = [t["echeance"] for t in tranches]
    if dates != sorted(dates):
        raise EcheancierInvalide("Les tranches doivent se suivre dans l’ordre des dates.")
    if sum(t["montant"] for t in tranches) <= 0:
        raise EcheancierInvalide("Le total de l’échéancier doit être supérieur à 0.")
    fin = periode(etab, nature, jour, PlatformSettings.load())[1]
    AbonnementTranche.objects.bulk_create(
        AbonnementTranche(etablissement=etab, nature=nature, numero=i + 1, nombre=len(tranches), echeance=t["echeance"], montant=t["montant"], periode_fin=fin)
        for i, t in enumerate(tranches))


def numero_recu(annee: int) -> str:
    """Prochain numéro de reçu d'abonnement de l'année : AB-2026-0001, AB-2026-0002…"""
    from .models import AbonnementPaiement
    prefixe = f"AB-{annee}-"
    faits = [int(n[len(prefixe):]) for n in AbonnementPaiement.objects.filter(numero__startswith=prefixe).values_list("numero", flat=True)
             if n[len(prefixe):].isdigit()]
    return f"{prefixe}{max(faits, default=0) + 1:04d}"


ALPHABET_CODE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # sans 0/O ni 1/I/L : lisible et facile à saisir


def code_verification() -> str:
    """Code secret d'un reçu, ex. 7K3F-Q9XD (40 bits : impossible à deviner)."""
    import secrets
    from .models import AbonnementPaiement
    while True:
        c = "".join(secrets.choice(ALPHABET_CODE) for _ in range(8))
        c = f"{c[:4]}-{c[4:]}"
        if not AbonnementPaiement.objects.filter(code_verif=c).exists():
            return c


def normaliser_code(saisie: str) -> str:
    """« 7k3f q9xd », « 7K3FQ9XD » → « 7K3F-Q9XD »."""
    c = "".join(ch for ch in saisie.upper() if ch.isalnum())
    return f"{c[:4]}-{c[4:]}" if len(c) == 8 else ""


def libelle(t: AbonnementTranche) -> str:
    return t.get_nature_display() + ("" if t.nombre == 1 else f" — tranche {t.numero}/{t.nombre}")


@transaction.atomic
def encaisser(etab: Etablissement, montant: int, jour: date, nature: str | None = None, nombre: int = 1,
              echeancier: list[dict] | None = None) -> dict:
    """Applique un paiement aux tranches dans l'ordre. Sans tranche en attente, ouvre d'abord la période suivante :
    avec l'échéancier fourni, sinon avec celui proposé par les réglages (`nombre` tranches).
    Renvoie le détail pour le reçu : chaque tranche en attente (déjà réglé, réglé par ce paiement, reste), le reste dû et la suite."""
    if not impayees(etab):
        nature = nature or prochaine_nature(etab)
        tranches = echeancier or [{"echeance": t["echeance"], "montant": t["montant"]} for t in plan(etab, nature, nombre, jour)]
        ouvrir(etab, nature, tranches, jour)
    reste = impayees(etab)
    du = sum(t.reste for t in reste)
    if montant > du:
        raise EcheancierInvalide(f"Le montant dépasse le reste dû ({du:,} FCFA).".replace(",", " "))
    lignes = []
    for t in reste:
        part = max(0, min(montant, t.reste))
        lignes.append({"libelle": libelle(t), "echeance": t.echeance.isoformat(), "montant": t.montant, "deja": t.regle, "ici": part, "reste": t.reste - part})
        if part:
            t.regle += part
            t.save(update_fields=["regle"])
            montant -= part
    recalculer_fin(etab)
    suite = next((ln for ln in lignes if ln["reste"] > 0), None)
    return {"lignes": lignes, "reste_du": sum(ln["reste"] for ln in lignes), "periode_fin": (_fin_courante(etab) or jour).isoformat(),
            "acces_jusqu_au": etab.abonnement_fin.isoformat() if etab.abonnement_fin else None,
            "prochaine": {"libelle": suite["libelle"], "echeance": suite["echeance"], "reste": suite["reste"]} if suite else None}


def modifier_tranche(t: AbonnementTranche, echeance: date | None = None, montant: int | None = None) -> None:
    """Change la date ou le montant d'une tranche non soldée. Le montant ne descend pas sous ce qui est déjà réglé (0 annule la tranche)."""
    if t.reste <= 0:
        raise EcheancierInvalide("Cette tranche est déjà réglée.")
    if montant is not None:
        if montant < t.regle:
            raise EcheancierInvalide(f"Déjà {t.regle:,} FCFA réglés sur cette tranche : le montant ne peut pas être inférieur.".replace(",", " "))
        t.montant = montant
    if echeance is not None:
        t.echeance = echeance
    t.save(update_fields=["montant", "echeance"])
    recalculer_fin(t.etablissement)
