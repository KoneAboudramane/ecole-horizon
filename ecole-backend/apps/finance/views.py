import csv
import io
import json
from collections import defaultdict

from django.conf import settings
from django.http import HttpResponse
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import generics, permissions, serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import SchoolSettings, SchoolYear
from apps.core.log import record
from apps.core.tenancy import tenant_context
from apps.core.pagination import BigPages
from apps.core.permissions import has_perm, perm_required
from apps.notifications.services import notify
from apps.students.models import ENROLLED, Enrollment, Student
from apps.students.phones import parse_date
from apps.students.views import visible_students

from apps.academics.tranches import clean as clean_tranches

from . import fees, services
from .receipt import build_receipt_pdf
from .models import MODES, CashClosing, FeeDate, Payment, PaymentIntent, StatementLine, Tarif
from .serializers import (CancelInput, DateSerializer, IntentInput, IntentSerializer, MatchInput, PaymentInput, PaymentSerializer,
                          StatementSerializer, TarifSerializer, MODE_CODES)

FIN_READ = ("pay.read", "pay.write")


def finance_student(user, pk) -> Student:
    """L'élève demandé, si l'utilisateur a le droit de voir ses finances (comptabilité, direction, fondateur, parent de l'élève)."""
    qs = Student.objects.select_related("school_class", "parent__user")
    if user.role == "parent":
        qs = qs.filter(pk__in=visible_students(user).values("pk"))
    elif not any(has_perm(user, p) for p in FIN_READ):
        raise PermissionDenied()
    s = qs.filter(pk=pk).first()
    if s is None:
        raise NotFound()
    return s


class TarifView(APIView):
    """GET : tarifs par niveau du cursus (tout compte connecté). PUT `{level, ins, sco, complement}` : modification (fondateur, comptable).
    `complement` : ce que paie en plus un élève qui suit déjà un autre cursus de l'école (vide : inscription + scolarité)."""

    def get_permissions(self):
        return [permissions.IsAuthenticated()] if self.request.method == "GET" else [perm_required("tarifs.write")()]

    @extend_schema(responses=TarifSerializer(many=True))
    def get(self, request):
        return Response(TarifSerializer(Tarif.objects.all(), many=True).data)

    @extend_schema(request=TarifSerializer, responses=TarifSerializer)
    def put(self, request):
        ser = TarifSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        t, _ = Tarif.objects.update_or_create(level=d["level"], defaults={"ins": d["ins"], "sco": d["sco"], "complement": d.get("complement")})
        record("Tarifs", f"Tarif modifié : {t.level}", request=request)
        return Response(TarifSerializer(t).data)


class FeeDateView(APIView):
    """Dates d'échéance de l'année en cours. PUT `{key, date}` (fondateur, comptable)."""

    def get_permissions(self):
        return [permissions.IsAuthenticated()] if self.request.method == "GET" else [perm_required("tarifs.write")()]

    @extend_schema(responses=DateSerializer(many=True))
    def get(self, request):
        return Response([{"key": k, "date": d} for k, d in fees.fee_dates().items()])

    @extend_schema(request=DateSerializer, responses=DateSerializer)
    def put(self, request):
        ser = DateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if d["key"] not in dict(fees.fee_keys()):
            raise ValidationError("Cette échéance n’existe pas dans les tranches de l’école.")
        FeeDate.objects.update_or_create(year=SchoolYear.get_current(), key=d["key"], defaults={"date": d["date"]})
        record("Échéance modifiée", f"{d['key']} : {d['date']:%d/%m/%Y}", request=request)
        return Response({"key": d["key"], "date": d["date"]})


class TranchesView(APIView):
    """Tranches de scolarité de l'école. PUT `{tranches: [{label, part}]}` (fondateur, comptable) : nombre, noms et parts relatives.

    Changer les tranches ne perd aucun paiement : les versements couvrent les échéances dans l'ordre et les soldes sont recalculés."""

    def get_permissions(self):
        return [permissions.IsAuthenticated()] if self.request.method == "GET" else [perm_required("tarifs.write")()]

    @extend_schema(responses=inline_serializer("Tranches", {"tranches": serializers.ListField()}))
    def get(self, request):
        return Response({"tranches": fees.school_tranches()})

    @extend_schema(request=inline_serializer("TranchesIn", {"tranches": serializers.ListField()}), responses=inline_serializer("TranchesOut", {"tranches": serializers.ListField()}))
    def put(self, request):
        try:
            data = clean_tranches(request.data.get("tranches"))
        except ValueError as e:
            raise ValidationError(str(e)) from e
        cfg = SchoolSettings.load()
        cfg.tranches = data
        cfg.save(update_fields=["tranches"])
        record("Tranches de scolarité", " · ".join(f"{t['label']} ({t['part']})" for t in data), request=request)
        return Response({"tranches": data})


class ReportsView(APIView):
    """Soldes reportés de l'année précédente (année en cours) : `{ "<élève>": montant }`. Parent : ses enfants ; comptabilité et direction : tous."""

    @extend_schema(responses=inline_serializer("Reports", {"reports": serializers.DictField(), "credits": serializers.DictField()}))
    def get(self, request):
        u = request.user
        qs = Enrollment.objects.filter(year=SchoolYear.get_current(), report__gt=0)
        if u.role == "parent":
            qs = qs.filter(student__in=visible_students(u))
        elif not any(has_perm(u, p) for p in FIN_READ):
            raise PermissionDenied()
        credits = Enrollment.objects.filter(year=SchoolYear.get_current(), credit__gt=0)
        if u.role == "parent":
            credits = credits.filter(student__in=visible_students(u))
        return Response({"reports": {str(sid): r for sid, r in qs.values_list("student_id", "report")},
                         "credits": {str(sid): c for sid, c in credits.values_list("student_id", "credit")}})


@extend_schema(responses=inline_serializer("Account", {"total": serializers.IntegerField(), "paid": serializers.IntegerField(),
                                                       "balance": serializers.IntegerField(), "lines": serializers.ListField()}))
class AccountView(APIView):
    """Situation d'un élève : échéancier, payé, solde, retard, remise fratrie. Parent : ses enfants ; comptabilité et direction : tous."""

    def get(self, request, pk):
        s = finance_student(request.user, pk)
        return Response({"student": s.pk, **fees.account(s, timezone.localdate())})


class AccountsView(APIView):
    """Comptes des élèves (`{accounts: {id: compte}}`), calculés par le serveur (forfait global des élèves inscrits dans plusieurs
    cursus compris). Comptabilité et direction : toute l'école (ou leur périmètre) ; parent et élève : leurs inscriptions.
    Une inscription dans un autre cursus renvoie le compte de la personne (porté par son inscription principale)."""

    def get(self, request):
        from apps.core.tenancy import cursus_context
        today, out = timezone.localdate(), {}
        u = request.user
        if u.role in ("parent", "eleve"):
            for s in visible_students(u):
                out[s.pk] = fees.account(s, today)
        elif any(has_perm(u, p) for p in FIN_READ):
            rows = _stats(today, u)
            with cursus_context(None):
                others = dict(Student.objects.filter(principal_id__in=[s.pk for s, _ in rows]).values_list("pk", "principal_id"))
            by_root = {s.pk: acc for s, acc in rows}
            out = {**by_root, **{sid: by_root[root] for sid, root in others.items()}}
        else:
            raise PermissionDenied()
        return Response({"accounts": out})


class PaymentList(generics.ListCreateAPIView):
    """GET : paiements (`student`, `class`, `mode`, `status`, `from`, `to`). POST : encaissement (comptable)."""

    serializer_class = PaymentSerializer
    pagination_class = BigPages

    def get_permissions(self):
        if self.request.method == "POST":
            return [perm_required("pay.write")()]
        return [] if getattr(self.request.user, "role", "") == "parent" else [perm_required(*FIN_READ)()]

    def get_queryset(self):
        u, p = self.request.user, self.request.query_params
        qs = Payment.objects.select_related("student__school_class", "by")
        if u.role == "parent":
            qs = qs.filter(student__in=visible_students(u))
        for key, field in (("student", "student_id"), ("class", "student__school_class_id"), ("mode", "mode"), ("status", "status")):
            if p.get(key):
                qs = qs.filter(**{field: p[key]})
        if p.get("year") == "all":      # tout l'historique
            pass
        elif p.get("year"):             # une année passée, par son libellé (ex. 2025-2026)
            qs = qs.filter(year__label=p["year"])
        else:                           # par défaut : l'année scolaire en cours
            qs = qs.filter(year=SchoolYear.get_current())
        if p.get("from"):
            qs = qs.filter(date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(date__lte=p["to"])
        return qs

    @extend_schema(request=PaymentInput, responses=PaymentSerializer)
    def create(self, request, *args, **kwargs):
        ser = PaymentInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        p = services.record_payment(student=d["student"], amount=d["amount"], mode=d["mode"], date=d.get("date"), ref=d["ref"],
                                    note=d["note"], by=request.user, request=request, advance=d["advance"])
        return Response(PaymentSerializer(p).data, status=status.HTTP_201_CREATED)


class CancelView(APIView):
    permission_classes = [perm_required("pay.write")]

    @extend_schema(request=CancelInput, responses=PaymentSerializer)
    def post(self, request, pk):
        p = generics.get_object_or_404(Payment.objects.select_related("student__school_class", "by"), pk=pk)
        ser = CancelInput(data=request.data)
        ser.is_valid(raise_exception=True)
        return Response(PaymentSerializer(services.cancel_payment(p, ser.validated_data["reason"], by=request.user, request=request)).data)


def _receipt_payment(pk):
    return generics.get_object_or_404(Payment.objects.select_related("student__school_class", "student__parent__user", "year"), pk=pk)


def _check_receipt(user, p) -> None:
    """Comptabilité, direction, parent de l'élève ; et, pour l'année en cours, le secrétariat qui valide les réinscriptions
    sur présentation du reçu."""
    try:
        finance_student(user, p.student_id)
    except (PermissionDenied, NotFound):
        validates = any(has_perm(user, x) for x in ("students.write", "classes.write", "rollover"))
        if not (validates and p.year_id and p.year_id == getattr(SchoolYear.get_current(), "pk", None)):
            raise


def _duplicata(request, p) -> bool:
    """`?duplicata=1` : réimpression d'un reçu déjà remis ; elle est marquée « Duplicata » et tracée dans le journal."""
    if request.query_params.get("duplicata") != "1":
        return False
    record("Duplicata de reçu", f"{p.receipt_no} · {p.student.full_name}", request=request)
    return True


class ReceiptView(APIView):
    """Données du reçu (pour l'impression ou le PDF) : ce qui a été payé par échéance et ce qui reste. Comptabilité, direction, ou parent concerné."""

    @extend_schema(responses=inline_serializer("Receipt", {"receipt_no": serializers.CharField()}))
    def get(self, request, pk):
        p = _receipt_payment(pk)
        _check_receipt(request.user, p)
        cfg = SchoolSettings.load()
        today = timezone.localdate()
        acc = fees.account(p.student, today)
        return Response({"receipt_no": p.receipt_no, "status": p.status, "date": p.date, "amount": p.amount, "mode": p.mode, "ref": p.ref,
                         "year": p.year.label if p.year else "", "advance": p.advance, "detail": fees.detail_of(p, today),
                         "duplicata": _duplicata(request, p),
                         "school": {"name": cfg.name, "address": cfg.address, "phone": cfg.phone},
                         "student": {"name": p.student.full_name, "matricule": p.student.matricule, "class": p.student.class_label},
                         "payer": p.student.parent.user.full_name, "balance_after_today": acc["balance"]})


class ReceiptPdfView(APIView):
    """Reçu en PDF, mêmes droits d'accès que `receipt/`."""

    @extend_schema(responses={(200, "application/pdf"): OpenApiTypes.BINARY})
    def get(self, request, pk):
        p = _receipt_payment(pk)
        _check_receipt(request.user, p)
        today = timezone.localdate()
        acc = fees.account(p.student, today)
        pdf = build_receipt_pdf(school=SchoolSettings.load(), payment=p, student=p.student, payer=p.student.parent.user.full_name,
                                mode_label=dict(MODES).get(p.mode, p.mode), balance=acc["balance"], detail=fees.detail_of(p, today),
                                duplicata=_duplicata(request, p))
        resp = HttpResponse(pdf, content_type="application/pdf")
        resp["Content-Disposition"] = f'inline; filename="recu-{p.receipt_no}.pdf"'
        resp["Cache-Control"] = "private, no-store"
        return resp


# --- Historique des années, relevé d'un élève, caisse ---
class YearsView(APIView):
    """Historique par année scolaire : encaissé, nombre de paiements, annulés, impayés et avances reportés sur l'année suivante."""

    permission_classes = [perm_required(*FIN_READ)]

    @extend_schema(responses=inline_serializer("FinanceYear", {"label": serializers.CharField()}, many=True))
    def get(self, request):
        years = list(SchoolYear.objects.order_by("label"))
        out = []
        for i, y in enumerate(years):
            pays = Payment.objects.filter(year=y)
            ok = pays.filter(status="confirme")
            nxt = years[i + 1] if i + 1 < len(years) else None
            enr = Enrollment.objects.filter(year=nxt) if nxt else Enrollment.objects.none()
            out.append({"label": y.label, "current": y.current, "collected": ok.aggregate(s=Sum("amount"))["s"] or 0, "count": ok.count(),
                        "cancelled": pays.filter(status="annule").count(), "advances": ok.aggregate(s=Sum("advance"))["s"] or 0,
                        "carried_over": enr.aggregate(s=Sum("report"))["s"] or 0 if nxt else None,
                        "carried_credit": enr.aggregate(s=Sum("credit"))["s"] or 0 if nxt else None})
        return Response(list(reversed(out)))


class StudentStatementView(APIView):
    """Relevé de paiements d'un élève sur toutes les années, avec la situation de l'année en cours. Comptabilité, direction, ou parent concerné."""

    @extend_schema(responses=inline_serializer("StudentStatement", {"student": serializers.IntegerField()}))
    def get(self, request, pk):
        s = finance_student(request.user, pk)
        today = timezone.localdate()
        cfg = SchoolSettings.load()
        years = []
        by_year: dict[str, list] = defaultdict(list)
        for p in Payment.objects.filter(student=s).select_related("year").order_by("date", "id"):
            by_year[p.year.label if p.year else ""].append(p)
        for label in sorted(by_year, reverse=True):
            ps = by_year[label]
            enr = Enrollment.objects.filter(student=s, year__label=label).first()
            years.append({"label": label, "report": enr.report if enr else 0, "credit": enr.credit if enr else 0,
                          "paid": sum(p.amount for p in ps if p.status == "confirme"),
                          "payments": [{"id": p.pk, "receipt_no": p.receipt_no, "date": p.date, "amount": p.amount, "mode": p.mode, "status": p.status,
                                        "advance": p.advance} for p in ps]})
        return Response({"student": s.pk, "name": s.full_name, "matricule": s.matricule, "class": s.class_label, "school": cfg.name,
                         "account": fees.account(s, today), "years": years})


def _cash_day(day):
    pays = Payment.objects.filter(date=day).select_related("student", "by")
    ok = [p for p in pays if p.status == "confirme"]
    by_mode: dict[str, dict] = {}
    for p in ok:
        row = by_mode.setdefault(p.mode, {"mode": p.mode, "count": 0, "total": 0})
        row["count"] += 1
        row["total"] += p.amount
    return ok, by_mode, [p for p in pays if p.status == "annule"]


def _closing_data(c):
    return {"id": c.pk, "date": c.date, "expected": c.expected_cash, "counted": c.counted_cash, "gap": c.counted_cash - c.expected_cash,
            "note": c.note, "by": c.by.full_name if c.by else ""}


class CashView(APIView):
    """Journée de caisse (`?date=`, aujourd'hui par défaut) : encaissements par mode, annulations, espèces attendues et clôture éventuelle."""

    permission_classes = [perm_required(*FIN_READ)]

    @extend_schema(responses=inline_serializer("CashDay", {"date": serializers.DateField()}))
    def get(self, request):
        day = parse_date(request.query_params.get("date") or "") or timezone.localdate()
        ok, by_mode, cancelled = _cash_day(day)
        closing = CashClosing.objects.filter(date=day).select_related("by").first()
        return Response({"date": day, "total": sum(p.amount for p in ok), "count": len(ok), "by_mode": sorted(by_mode.values(), key=lambda r: r["mode"]),
                         "expected_cash": by_mode.get("especes", {}).get("total", 0),
                         "cancelled": [{"receipt_no": p.receipt_no, "student": p.student.full_name, "amount": p.amount, "note": p.note} for p in cancelled],
                         "closing": _closing_data(closing) if closing else None})


class CashCloseView(APIView):
    """Clôture de caisse du jour : le comptable saisit les espèces réellement comptées ; l'écart avec les reçus est conservé. Une seule clôture par jour."""

    permission_classes = [perm_required("pay.write")]

    @extend_schema(request=inline_serializer("CashCloseIn", {"date": serializers.DateField(required=False), "counted": serializers.IntegerField(), "note": serializers.CharField(required=False)}),
                   responses=inline_serializer("CashClosing", {"gap": serializers.IntegerField()}))
    def post(self, request):
        day = parse_date(str(request.data.get("date") or "")) or timezone.localdate()
        try:
            counted = int(request.data.get("counted"))
        except (TypeError, ValueError) as e:
            raise ValidationError({"counted": "Indiquez les espèces comptées."}) from e
        if counted < 0:
            raise ValidationError({"counted": "Le montant ne peut pas être négatif."})
        if day > timezone.localdate():
            raise ValidationError({"date": "On ne peut pas clôturer un jour à venir."})
        if CashClosing.objects.filter(date=day).exists():
            raise ValidationError("La caisse de ce jour est déjà clôturée.")
        _, by_mode, _ = _cash_day(day)
        expected = by_mode.get("especes", {}).get("total", 0)
        note = str(request.data.get("note") or "").strip()[:300]
        if counted != expected and not note:
            raise ValidationError({"note": "Il y a un écart : expliquez-le en une phrase."})
        c = CashClosing.objects.create(date=day, expected_cash=expected, counted_cash=counted, note=note, by=request.user)
        record("Clôture de caisse", f"{day:%d/%m/%Y} · attendu {services.fcfa(expected)} · compté {services.fcfa(counted)} FCFA", request=request)
        return Response(_closing_data(c), status=status.HTTP_201_CREATED)


def _stats(today, user=None):
    """Chiffres globaux : une ligne par personne (son compte porte le forfait de tous ses cursus), tous cursus confondus ;
    un compte limité à certains cursus ne voit que les élèves qui y sont inscrits."""
    from django.db.models import Q
    from apps.accounts.perimetre import allowed_cursus
    from apps.core.tenancy import cursus_context
    dates = fees.fee_dates()
    tranches = fees.school_tranches()
    year = SchoolYear.get_current()
    paid = dict(Payment.objects.filter(status="confirme", year=year).values_list("student_id").annotate(s=Sum("amount")))
    reports = dict(Enrollment.objects.filter(year=year).values_list("student_id", "report"))
    for sid, cr in Enrollment.objects.filter(year=year, credit__gt=0).values_list("student_id", "credit"):
        paid[sid] = paid.get(sid, 0) + cr
    report_date = fees.report_due(year)
    pct = SchoolSettings.load().remise_fratrie
    first_child: dict[int, int] = {}
    with cursus_context(None):
        qs = Student.objects.filter(principal__isnull=True).filter(ENROLLED | Q(autres_cursus__active=True) | Q(autres_cursus__sortie="placer"))
        allowed = allowed_cursus(user) if user is not None else None
        if allowed is not None:
            qs = qs.filter(Q(cursus__in=allowed) | Q(autres_cursus__cursus__in=allowed))
        students = list(qs.distinct().select_related("school_class", "parent__user", "cursus").order_by("id"))     # dont les élèves à placer
    for s in students:
        first_child.setdefault(s.parent_id, s.pk)
    rows = []
    for s in students:
        d = min(100, pct) if pct and first_child[s.parent_id] != s.pk else 0
        rows.append((s, fees.account(s, today, paid=paid.get(s.pk, 0), pct=d, dates=dates, tranches=tranches,
                                         report=reports.get(s.pk, 0), report_date=report_date)))
    return rows


class OverviewView(APIView):
    permission_classes = [perm_required(*FIN_READ)]

    @extend_schema(responses=inline_serializer("FinanceOverview", {"expected": serializers.IntegerField()}))
    def get(self, request):
        today = timezone.localdate()
        expected = due = overdue = n_over = 0
        over_by_class: dict[str, int] = defaultdict(int)
        for s, acc in _stats(today, request.user):
            expected += acc["total"]
            due += sum(line["amount"] for line in acc["lines"] if line["due"] and line["due"] <= today)
            if acc["overdue"] > 0:
                overdue += acc["overdue"]
                n_over += 1
                over_by_class[s.class_label] += acc["overdue"]
        by_month: dict[str, int] = defaultdict(int)
        by_mode: dict[str, int] = defaultdict(int)
        collected = 0
        for date, mode, amount in Payment.objects.filter(status="confirme").values_list("date", "mode", "amount"):
            collected += amount
            by_month[date.strftime("%Y-%m")] += amount
            by_mode[mode] += amount
        return Response({"expected": expected, "due_to_date": due, "overdue": overdue, "overdue_count": n_over, "collected": collected,
                         "by_month": dict(sorted(by_month.items())), "by_mode": by_mode, "overdue_by_class": over_by_class,
                         "month_collected": by_month.get(today.strftime("%Y-%m"), 0)})


class OverdueView(APIView):
    """Impayés : élèves ayant au moins une échéance dépassée non soldée (`?class=`), du plus gros retard au plus petit."""

    permission_classes = [perm_required(*FIN_READ)]

    @extend_schema(responses=inline_serializer("OverdueRow", {"student": serializers.IntegerField()}, many=True))
    def get(self, request):
        cls = request.query_params.get("class")
        rows = [{"student": s.pk, "name": s.full_name, "class": s.class_label, "class_id": s.school_class_id,
                 "parent": s.parent.user.full_name, "phone": s.parent.user.phone, "overdue": acc["overdue"], "balance": acc["balance"],
                 "overdue_keys": [line["key"] for line in acc["lines"] if line["overdue"]],
                 "overdue_labels": [line["label"] for line in acc["lines"] if line["overdue"]]}
                for s, acc in _stats(timezone.localdate(), request.user) if acc["overdue"] > 0 and (not cls or str(s.school_class_id) == cls)]
        return Response(sorted(rows, key=lambda r: -r["overdue"]))


class ReminderView(APIView):
    """Relance par notification les familles dont une échéance est dépassée. Corps : `{students: [ids]}` (les élèves sans retard sont ignorés)."""

    permission_classes = [perm_required("pay.write")]

    @extend_schema(request=inline_serializer("ReminderIn", {"students": serializers.ListField(child=serializers.IntegerField())}),
                   responses=inline_serializer("ReminderOut", {"sent": serializers.IntegerField()}))
    def post(self, request):
        ids = {int(i) for i in (request.data.get("students") or []) if str(i).isdigit()}
        if not ids:
            raise ValidationError({"students": "Indiquez au moins un élève."})
        sent = 0
        for s, acc in _stats(timezone.localdate(), request.user):
            if s.pk in ids and acc["overdue"] > 0:
                notify([s.parent.user], f"Rappel : {services.fcfa(acc['overdue'])} FCFA de scolarité restent à régler pour {s.prenoms}.", "paiement", "payer")
                sent += 1
        record("Relances", f"{sent} famille(s) relancée(s)", request=request)
        return Response({"sent": sent})


# --- Rapprochement avec le relevé de l'opérateur ---
class StatementList(generics.ListAPIView):
    """Relevé importé. `?issues=1` : seulement les lignes sans paiement rattaché ou au montant différent."""

    serializer_class = StatementSerializer
    pagination_class = None
    permission_classes = [perm_required("rapprochement.write", "pay.read")]

    def get_queryset(self):
        return StatementLine.objects.select_related("payment")

    def list(self, request, *args, **kwargs):
        rows = StatementSerializer(self.get_queryset(), many=True).data
        if request.query_params.get("issues") == "1":
            rows = [r for r in rows if r["issue"] != "ok"]
        return Response(rows)


class StatementImport(APIView):
    """Import CSV du relevé : colonnes `ref;date;mode;montant;telephone`. Les lignes déjà connues sont ignorées ; celles dont
    la référence correspond à un paiement enregistré sont rattachées automatiquement."""

    permission_classes = [perm_required("rapprochement.write")]
    parser_classes = [MultiPartParser]

    @extend_schema(request={"multipart/form-data": inline_serializer("StatementCsv", {"file": serializers.FileField()})},
                   responses=inline_serializer("StatementResult", {"created": serializers.IntegerField()}))
    def post(self, request):
        f = request.FILES.get("file")
        if not f or f.size > 2_000_000:
            raise ValidationError({"file": "Joignez un fichier CSV (2 Mo au maximum)."})
        text = f.read().decode("utf-8-sig", errors="replace")
        delim = ";" if text[:2000].count(";") >= text[:2000].count(",") else ","
        rd = csv.DictReader(io.StringIO(text), delimiter=delim)
        rd.fieldnames = [(x or "").strip().lower() for x in (rd.fieldnames or [])]
        need = ["ref", "date", "mode", "montant", "telephone"]
        if any(c not in rd.fieldnames for c in need):
            raise ValidationError({"file": "Colonnes attendues : " + ";".join(need)})
        created, skipped, errors = 0, 0, []
        for i, r in enumerate(rd, start=2):
            ref, mode, d = (r.get("ref") or "").strip(), (r.get("mode") or "").strip().lower(), parse_date(r.get("date") or "")
            amt = (r.get("montant") or "").replace(" ", "")
            if not ref or mode not in MODE_CODES or d is None or not amt.isdigit() or int(amt) <= 0:
                errors.append({"line": i, "error": "ligne invalide (ref, date, mode ou montant)"})
                continue
            pay = Payment.objects.filter(mode=mode, ref=ref, status="confirme").first()
            _, new = StatementLine.objects.get_or_create(mode=mode, ref=ref, defaults={"date": d, "amount": int(amt), "phone": (r.get("telephone") or "").strip(), "payment": pay})
            created += new
            skipped += not new
        record("Import du relevé", f"{created} ligne(s), {len(errors)} erreur(s)", request=request)
        return Response({"created": created, "skipped": skipped, "errors": errors})


class StatementMatch(APIView):
    """Rattache une ligne du relevé à un élève : crée le paiement correspondant (montant, date, référence du relevé)."""

    permission_classes = [perm_required("rapprochement.write")]

    @extend_schema(request=MatchInput, responses=StatementSerializer)
    @transaction.atomic
    def post(self, request, pk):
        line = generics.get_object_or_404(StatementLine.objects.select_for_update(), pk=pk)
        if line.payment_id:
            raise ValidationError("Cette ligne est déjà rattachée à un paiement.")
        ser = MatchInput(data=request.data)
        ser.is_valid(raise_exception=True)
        p = services.record_payment(student=ser.validated_data["student"], amount=line.amount, mode=line.mode, date=line.date,
                                    ref=line.ref, note="Rattaché depuis le relevé", by=request.user, request=request)
        line.payment = p
        line.save(update_fields=["payment"])
        record("Rapprochement", f"{line.ref} rattaché à {p.student.full_name}", request=request)
        return Response(StatementSerializer(line).data)


class StatementFix(APIView):
    """Corrige le montant du paiement d'après le relevé (le relevé de l'opérateur fait foi)."""

    permission_classes = [perm_required("rapprochement.write")]

    @extend_schema(request=None, responses=StatementSerializer)
    def post(self, request, pk):
        line = generics.get_object_or_404(StatementLine.objects.select_related("payment"), pk=pk)
        if not line.payment or line.payment.amount == line.amount:
            raise ValidationError("Aucun écart à corriger sur cette ligne.")
        old = line.payment.amount
        line.payment.amount, line.payment.note = line.amount, "Montant corrigé d’après le relevé"
        line.payment.save(update_fields=["amount", "note"])
        record("Rapprochement", f"Montant corrigé : {line.ref} ({old} → {line.amount})", request=request)
        return Response(StatementSerializer(line).data)


# --- Paiement mobile money ---
class InitiateView(APIView):
    """Un parent lance un paiement pour son enfant. Rien n'est encaissé ici : seul le retour signé de l'opérateur confirme."""

    @extend_schema(request=IntentInput, responses=IntentSerializer)
    def post(self, request):
        if request.user.role != "parent":
            raise PermissionDenied("Seul un parent peut payer en ligne.")
        ser = IntentInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if not visible_students(request.user).filter(pk=d["student"].pk).exists():
            raise NotFound()
        due = services.balance_of(d["student"])
        if d["amount"] > due:
            raise ValidationError({"amount": f"Le montant dépasse le solde dû ({services.fcfa(due)} FCFA)."})
        intent = PaymentIntent.objects.create(student=d["student"], amount=d["amount"], mode=d["mode"], phone=d["phone"], by=request.user)
        record("Paiement en ligne initié", f"{d['student'].full_name} · {d['amount']} FCFA · {d['mode']}", request=request)
        return Response(IntentSerializer(intent).data, status=status.HTTP_201_CREATED)


class IntentStatus(APIView):
    @extend_schema(responses=IntentSerializer)
    def get(self, request, reference):
        qs = PaymentIntent.objects.all() if any(has_perm(request.user, p) for p in FIN_READ) else PaymentIntent.objects.filter(by=request.user)
        return Response(IntentSerializer(generics.get_object_or_404(qs, reference=reference)).data)


class SandboxConfirm(APIView):
    """Bac à sable (développement uniquement, `MOBILE_MONEY_SANDBOX=1`) : simule le retour de l'opérateur via le même service.
    `?fail=1` simule un paiement refusé."""

    @extend_schema(request=None, responses=IntentSerializer)
    def post(self, request, reference):
        if not settings.MOBILE_MONEY_SANDBOX:
            raise NotFound()
        intent = generics.get_object_or_404(PaymentIntent, reference=reference, by=request.user)
        ok = request.query_params.get("fail") != "1"
        intent, _ = services.settle_intent(intent.reference, succeeded=ok, amount=intent.amount, provider_ref=f"SBX-{str(intent.reference)[:8].upper()}")
        return Response(IntentSerializer(intent).data)


class MobileMoneyWebhook(APIView):
    """Appelé par l'opérateur. Authentifié par signature HMAC-SHA256 de `horodatage.corps` (en-têtes `X-Timestamp` et
    `X-Signature`), tolérance de 5 minutes. Corps : `{event, reference, provider_ref, amount}`. Idempotent."""

    authentication_classes: list = []
    permission_classes = [permissions.AllowAny]
    throttle_classes: list = []

    @extend_schema(request=inline_serializer("WebhookBody", {"event": serializers.CharField(), "reference": serializers.UUIDField(),
                                                              "provider_ref": serializers.CharField(), "amount": serializers.IntegerField()}),
                   responses=inline_serializer("WebhookOut", {"status": serializers.CharField()}))
    def post(self, request):
        if not getattr(settings, "MOBILE_MONEY_WEBHOOK_SECRET", ""):
            return Response({"detail": "Webhook non configuré."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        body = request.body
        if not services.verify_webhook(request.headers.get("X-Timestamp", ""), request.headers.get("X-Signature", ""), body):
            record("Webhook refusé", "Signature invalide ou expirée")
            return Response({"detail": "Signature invalide."}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            data = json.loads(body)
            ref, event, amount, prov = data["reference"], data["event"], data.get("amount"), str(data.get("provider_ref", ""))
            intent = PaymentIntent.objects.filter(reference=ref).first()
        except (ValueError, KeyError, TypeError):
            return Response({"detail": "Corps invalide."}, status=status.HTTP_400_BAD_REQUEST)
        if intent is None or event not in ("payment.succeeded", "payment.failed") or (event == "payment.succeeded" and not prov):
            return Response({"detail": "Événement inconnu."}, status=status.HTTP_400_BAD_REQUEST)
        with tenant_context(intent.etablissement_id):  # l'opérateur n'est connecté à aucune école : on se place dans celle du paiement
            _, outcome = services.settle_intent(intent.reference, succeeded=event == "payment.succeeded", amount=amount, provider_ref=prov)
        return Response({"status": outcome})


@extend_schema(request={"multipart/form-data": inline_serializer("ImportPaymentsFile", {"file": serializers.FileField()})}, responses={200: {"type": "object"}})
class PaymentImportView(APIView):
    """Reprise de paiements déjà encaissés (Excel ou CSV). Sans `?commit=1` : simple vérification. Aucune notification aux parents."""

    permission_classes = [perm_required("pay.write")]
    parser_classes = [MultiPartParser]

    def post(self, request):
        from . import imports
        f = request.FILES.get("file")
        if not f:
            raise ValidationError({"file": "Joignez un fichier Excel (.xlsx) ou CSV."})
        if f.size > 2_000_000:
            raise ValidationError({"file": "Fichier trop volumineux (2 Mo au maximum)."})
        try:
            rows = imports.read(f.read())
        except ValueError as e:
            raise ValidationError({"file": str(e)}) from e
        valid, errors = imports.validate(rows)
        out = {"total": len(rows), "valid": len(valid), "errors": errors, "created": []}
        if request.query_params.get("commit") != "1":
            return Response(out)
        total = 0
        for v in valid:
            try:
                p = services.record_payment(student=v["student"], amount=v["amount"], mode=v["mode"], date=v["date"], ref=v["ref"], note=v["note"],
                                            by=request.user, request=request, silent=True)
            except ValidationError as e:  # concurrence : solde réglé entre-temps, référence prise…
                out["errors"].append({"line": v["line"], "nom": v["student"].full_name, "errors": [str(e.detail)]})
                continue
            total += p.amount
            out["created"].append({"matricule": p.receipt_no, "name": v["student"].full_name})
        out["valid"] = len(out["created"])
        record("Import de paiements", f"{f.name[:60]} : {len(out['created'])} paiement(s), {total} FCFA, {len(out['errors'])} erreur(s)", request=request)
        return Response(out, status=status.HTTP_201_CREATED if out["created"] else status.HTTP_200_OK)


@extend_schema(responses={(200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): OpenApiTypes.BINARY})
class PaymentImportTemplateView(APIView):
    permission_classes = [perm_required("pay.write")]

    def get(self, request):
        from . import imports
        r = HttpResponse(imports.template(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        r["Content-Disposition"] = 'attachment; filename="modele-import-paiements.xlsx"'
        return r
