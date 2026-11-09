import hashlib
import hmac
import time

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.academics.models import SchoolYear
from apps.core.log import record
from apps.notifications.services import notify, users_with_role
from apps.students.models import Sequence, Student

from . import fees
from .models import BulletinDerogation, Payment, PaymentIntent


def fcfa(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def next_receipt(year: int) -> str:
    with transaction.atomic():
        Sequence.objects.get_or_create(name=f"receipt-{year}")
        seq = Sequence.objects.select_for_update().get(name=f"receipt-{year}")
        seq.value += 1
        seq.save(update_fields=["value"])
    return f"REC-{year}-{seq.value:05d}"


def balance_of(student: Student) -> int:
    return fees.account(student, timezone.localdate())["balance"]


def bulletin_access(student: Student) -> dict:
    """Le bulletin de l'année en cours est-il remis à la famille ? Selon le réglage de l'école, il faut avoir réglé les échéances échues
    (« retard ») ou toute la scolarité (« total ») ; une dérogation de la direction lève le blocage pour l'année."""
    from apps.academics.models import SchoolSettings
    mode = SchoolSettings.load().bulletin_blocage
    year = SchoolYear.get_current()
    derog = BulletinDerogation.objects.filter(student=student, year=year).select_related("by").first() if year else None
    amount = 0
    if mode != "aucun":
        acc = fees.account(student, timezone.localdate())
        amount = acc["overdue"] if mode == "retard" else acc["balance"]
    return {"mode": mode, "amount": amount, "locked": bool(amount) and derog is None,
            "derogation": {"note": derog.note, "by": derog.by.full_name if derog.by else "", "date": derog.created.date().isoformat()} if derog else None}


def bulletin_lock_message(acc: dict) -> str:
    what = "des échéances en retard" if acc["mode"] == "retard" else "du reste de la scolarité"
    return f"Le bulletin sera disponible après le règlement {what} ({fcfa(acc['amount'])} FCFA). Rapprochez-vous de la comptabilité de l'école."


@transaction.atomic
def record_payment(*, student: Student, amount: int, mode: str, date=None, ref: str = "", note: str = "", by=None, request=None, silent: bool = False, advance: bool = False) -> Payment:
    """Enregistre un paiement confirmé (`silent` : pas de notification, pour la reprise de paiements anciens). Refus si le montant dépasse le solde dû ou si la référence est déjà encaissée."""
    # Forfait global : le paiement va à l'inscription principale (un seul compte par personne, tous cursus confondus)
    student = Student._base_manager.select_for_update().select_related("school_class", "parent__user").get(pk=student.principal_id or student.pk)
    if amount <= 0:
        raise ValidationError({"amount": "Le montant doit être positif."})
    today = timezone.localdate()
    acc = fees.account(student, today)
    due = acc["balance"]
    surplus = max(0, amount - due)
    if surplus and not advance:     # le comptable confirme explicitement qu'il garde le surplus en avance (code « surplus »)
        raise ValidationError({"amount": f"Le montant dépasse le solde dû ({fcfa(due)} FCFA).", "code": "surplus", "balance": due, "surplus": surplus})
    detail = fees.payment_detail(student, acc["paid"], amount, today)
    ref = ref.strip()
    date = date or timezone.localdate()
    # Le numéro de reçu verrouille la séquence jusqu'à la fin de la transaction : deux encaissements ne peuvent donc pas
    # vérifier la même référence en même temps. Indispensable sous MySQL, qui ignore la contrainte conditionnelle
    # « uniq_confirmed_ref » (en cas de refus, l'annulation de la transaction rend aussi le numéro de reçu).
    receipt_no = next_receipt(date.year)
    if ref and Payment.objects.filter(mode=mode, ref=ref, status="confirme").exists():
        raise ValidationError({"ref": "Cette référence a déjà été encaissée."})
    try:
        with transaction.atomic():
            p = Payment.objects.create(student=student, year=SchoolYear.get_current(), amount=amount, mode=mode, ref=ref, date=date, note=note.strip(),
                                       receipt_no=receipt_no, by=by, advance=surplus, detail=detail)
    except IntegrityError as e:
        raise ValidationError({"ref": "Cette référence a déjà été encaissée."}) from e
    if not silent:
        reste = f"Reste à payer : {fcfa(detail['remaining'])} FCFA." if detail["remaining"] else "Scolarité soldée."
        notify([student.parent.user], f"Paiement de {fcfa(amount)} FCFA reçu pour {student.prenoms}. Reçu {p.receipt_no}. {reste}", "paiement", "payer")
        notify(users_with_role("comptable"), f"Nouveau paiement : {student.nom} {student.prenoms}, {fcfa(amount)} FCFA.", "paiement", "paiements")
    record("Paiement", f"{p.receipt_no} · {student.full_name} · {fcfa(amount)} FCFA", user=by, request=request)
    return p


@transaction.atomic
def cancel_payment(payment: Payment, reason: str, *, by, request=None) -> Payment:
    if payment.status != "confirme":
        raise ValidationError("Ce paiement est déjà annulé.")
    if not reason.strip():
        raise ValidationError({"reason": "Indiquez le motif de l’annulation."})
    payment.status, payment.note = "annule", f"Annulé : {reason.strip()}"
    payment.save(update_fields=["status", "note"])
    record("Annulation de paiement", f"{payment.receipt_no} annulé ({reason.strip()})", user=by, request=request)
    return payment


# --- Mobile money : la confirmation vient uniquement de l'opérateur ---
MAX_SKEW = 300  # secondes


def webhook_signature(secret: str, timestamp: str, body: bytes) -> str:
    return hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


def verify_webhook(timestamp: str, signature: str, body: bytes) -> bool:
    secret = getattr(settings, "MOBILE_MONEY_WEBHOOK_SECRET", "")
    if not secret or not timestamp or not signature:
        return False
    try:
        if abs(time.time() - int(timestamp)) > MAX_SKEW:
            return False  # trop ancien ou trop neuf : on refuse le rejeu
    except ValueError:
        return False
    expected = webhook_signature(secret, timestamp, body)
    return hmac.compare_digest(expected, signature.removeprefix("sha256="))


@transaction.atomic
def settle_intent(reference, *, succeeded: bool, amount: int | None, provider_ref: str) -> tuple[PaymentIntent, str]:
    """Traite le retour de l'opérateur. Idempotent : un même retour rejoué ne crée jamais un second paiement."""
    intent = PaymentIntent.objects.select_for_update().select_related("student__school_class", "student__parent__user").get(reference=reference)
    if intent.status != "pending":
        return intent, "already_processed"
    intent.provider_ref = provider_ref[:80]
    if not succeeded:
        intent.status = "failed"
        intent.save(update_fields=["status", "provider_ref"])
        notify([intent.by_id] if intent.by_id else [], f"Le paiement de {fcfa(intent.amount)} FCFA pour {intent.student.prenoms} n’a pas abouti.", "paiement", "payer")
        return intent, "failed"
    if amount != intent.amount:
        intent.status = "mismatch"
        intent.save(update_fields=["status", "provider_ref"])
        record("Paiement en ligne à vérifier", f"Montant reçu {amount} ≠ demandé {intent.amount} ({intent.mode}, {provider_ref})")
        notify(users_with_role("comptable"), f"Paiement en ligne à vérifier : montant reçu différent pour {intent.student.full_name}.", "paiement", "rapprochement")
        return intent, "mismatch"
    try:
        p = record_payment(student=intent.student, amount=intent.amount, mode=intent.mode, ref=provider_ref, note="Paiement en ligne")
    except ValidationError:  # solde réglé entre-temps, ou référence déjà connue : à traiter par le comptable
        intent.status = "mismatch"
        intent.save(update_fields=["status", "provider_ref"])
        record("Paiement en ligne à vérifier", f"Non imputable : {intent.student.full_name}, {provider_ref}")
        notify(users_with_role("comptable"), f"Paiement en ligne non imputable pour {intent.student.full_name} : à vérifier.", "paiement", "rapprochement")
        return intent, "mismatch"
    intent.status, intent.payment = "succeeded", p
    intent.save(update_fields=["status", "provider_ref", "payment"])
    return intent, "succeeded"
