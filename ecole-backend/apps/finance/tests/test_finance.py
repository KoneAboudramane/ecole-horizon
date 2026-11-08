import datetime
import io
import json
import time

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from apps.finance import fees, services
from apps.finance.models import Payment, PaymentIntent
from apps.notifications.models import Notification
from apps.students.services import enroll_student

pytestmark = pytest.mark.django_db
URL = "/api/v1/finance/"


@pytest.fixture(autouse=True)
def frozen_today(monkeypatch):
    monkeypatch.setattr(timezone, "localdate", lambda *a, **k: datetime.date(2026, 12, 14))


@pytest.fixture
def fin(school, users):
    return {**school, **users, "comptable": users["comptable"]}


def pay(client, s, amount=50000, mode="especes", **kw):
    return client.post(URL + "payments/", {"student": s.pk, "amount": amount, "mode": mode, **kw}, format="json")


def test_account_lines(fin, login, client):
    login(fin["comptable"])
    a = client.get(URL + f"students/{fin['A'].pk}/account/").data
    assert [l["amount"] for l in a["lines"]] == [50000, 60000, 60000, 60000] and a["total"] == 230000
    assert [l["overdue"] for l in a["lines"]] == [True, True, False, False] and a["overdue"] == 110000
    pay(client, fin["A"], 100000)
    a = client.get(URL + f"students/{fin['A'].pk}/account/").data
    assert [l["paid"] for l in a["lines"]] == [50000, 50000, 0, 0] and a["balance"] == 130000 and a["overdue"] == 10000


def test_sibling_discount_and_rounding(fin):
    kid = enroll_student(nom="Aka", prenoms="Noé", sexe="M", naissance="2015-03-03", lieu="", school_class=fin["c"], parent_name="M. Aka", parent_phone="0101010101").student
    assert fees.sibling_pct(fin["A"]) == 0 and fees.sibling_pct(kid) == 10
    acc = fees.account(kid, datetime.date(2026, 12, 14))
    assert [l["amount"] for l in acc["lines"]] == [50000, 54000, 54000, 54000]   # 180 000 − 10 % = 162 000
    assert acc["discount_amount"] == 18000
    assert fees.js_round(2.5) == 3 and fees.js_round(0.5) == 1


def test_tarifs_rights(fin, login, client):
    login(fin["eleve"])
    assert len(client.get(URL + "tarifs/").data) == 7
    for r in ("admin", "directeur", "parent"):
        login(fin[r])
        assert client.put(URL + "tarifs/", {"level": "6e", "ins": 1, "sco": 2}, format="json").status_code == 403, r
    login(fin["fondateur"])
    assert client.put(URL + "tarifs/", {"level": "6e", "ins": 55000, "sco": 190000}, format="json").status_code == 200
    login(fin["comptable"])
    assert client.put(URL + "dates/", {"key": "T2", "date": "2027-01-15"}, format="json").status_code == 200


def test_payment_rights_and_receipts(fin, login, client):
    for r in ("directeur", "fondateur", "admin", "enseignant", "parent", "eleve"):
        login(fin[r])
        assert pay(client, fin["A"]).status_code == 403, r
    login(fin["comptable"])
    r1, r2 = pay(client, fin["A"]), pay(client, fin["B"])
    assert r1.status_code == 201 and r1.data["receipt_no"] == "REC-2026-00001" and r2.data["receipt_no"] == "REC-2026-00002"
    assert Notification.objects.filter(user=fin["A"].parent.user, kind="paiement", text__contains="REC-2026-00001").exists()
    login(fin["directeur"])
    assert len(client.get(URL + "payments/").data["results"]) == 2        # lecture seule pour la direction


def test_payment_validation(fin, login, client):
    login(fin["comptable"])
    assert pay(client, fin["A"], 230001).status_code == 400               # plus que le solde dû
    assert pay(client, fin["A"], 0).status_code == 400
    assert pay(client, fin["A"], 1000, mode="virement").status_code == 400   # référence obligatoire
    assert pay(client, fin["A"], 1000, mode="orange", ref="OM1").status_code == 201
    assert pay(client, fin["B"], 1000, mode="orange", ref="OM1").status_code == 400   # même opération encaissée deux fois
    assert pay(client, fin["B"], 1000, mode="wave", ref="OM1").status_code == 201     # autre opérateur : autre référence possible
    assert pay(client, fin["A"], 1000, date="2999-01-01").status_code == 400


def test_cancel(fin, login, client):
    login(fin["comptable"])
    p = pay(client, fin["A"], 230000, mode="cheque", ref="CH1").data
    assert client.get(URL + f"students/{fin['A'].pk}/account/").data["balance"] == 0
    assert client.post(URL + f"payments/{p['id']}/cancel/", {"reason": ""}, format="json").status_code == 400
    r = client.post(URL + f"payments/{p['id']}/cancel/", {"reason": "Chèque sans provision"}, format="json")
    assert r.data["status"] == "annule" and "sans provision" in r.data["note"]
    assert client.get(URL + f"students/{fin['A'].pk}/account/").data["balance"] == 230000
    assert client.post(URL + f"payments/{p['id']}/cancel/", {"reason": "bis"}, format="json").status_code == 400
    assert pay(client, fin["A"], 1000, mode="cheque", ref="CH1").status_code == 201   # référence libérée par l'annulation
    login(fin["directeur"])
    assert client.post(URL + f"payments/{p['id']}/cancel/", {"reason": "x"}, format="json").status_code == 403


def test_parent_scoping(fin, login, client):
    login(fin["comptable"])
    pay(client, fin["A"]); pay(client, fin["B"])
    pid = Payment.objects.get(student=fin["B"]).pk
    login(fin["A"].parent.user)
    assert [p["student"] for p in client.get(URL + "payments/").data["results"]] == [fin["A"].pk]
    assert client.get(URL + f"students/{fin['A'].pk}/account/").status_code == 200
    assert client.get(URL + f"students/{fin['B'].pk}/account/").status_code == 404
    assert client.get(URL + f"payments/{pid}/receipt/").status_code == 404
    for url in ("overview/", "overdue/", "statement/"):
        assert client.get(URL + url).status_code == 403, url
    login(fin["A"].user)   # l'élève n'a pas accès aux finances
    assert client.get(URL + f"students/{fin['A'].pk}/account/").status_code == 403


def test_overview_and_overdue(fin, login, client):
    login(fin["comptable"])
    pay(client, fin["A"], 110000)
    o = client.get(URL + "overview/").data
    assert o["expected"] == 460000 and o["due_to_date"] == 220000 and o["collected"] == 110000
    assert o["overdue"] == 110000 and o["overdue_count"] == 1 and o["overdue_by_class"] == {"6e A": 110000}
    assert o["by_mode"] == {"especes": 110000} and o["month_collected"] == 110000
    rows = client.get(URL + "overdue/").data
    assert [r["student"] for r in rows] == [fin["B"].pk] and rows[0]["overdue"] == 110000


def csv_file(text):
    return SimpleUploadedFile("r.csv", text.encode(), content_type="text/csv")


def test_statement_flow(fin, login, client):
    login(fin["comptable"])
    pay(client, fin["A"], 30000, mode="orange", ref="OM-1")            # sera trouvé dans le relevé
    pay(client, fin["B"], 20000, mode="wave", ref="WV-1")              # montant erroné par rapport au relevé
    text = "ref;date;mode;montant;telephone\nOM-1;03/12/2026;orange;30000;0707070707\nWV-1;04/12/2026;wave;25000;0505050505\nMTN-9;05/12/2026;mtn;60 000;0101010101\nbad;;;;\n"
    r = client.post(URL + "statement/import/", {"file": csv_file(text)}, format="multipart")
    assert r.data["created"] == 3 and len(r.data["errors"]) == 1
    assert client.post(URL + "statement/import/", {"file": csv_file(text)}, format="multipart").data["created"] == 0   # rejeu : rien de plus
    issues = {x["ref"]: x["issue"] for x in client.get(URL + "statement/").data}
    assert issues == {"OM-1": "ok", "WV-1": "amount_mismatch", "MTN-9": "unmatched"}
    lines = {x["ref"]: x for x in client.get(URL + "statement/?issues=1").data}
    assert set(lines) == {"WV-1", "MTN-9"}
    fix = client.post(URL + f"statement/{lines['WV-1']['id']}/fix/", format="json")
    assert fix.data["issue"] == "ok" and Payment.objects.get(ref="WV-1").amount == 25000
    m = client.post(URL + f"statement/{lines['MTN-9']['id']}/match/", {"student": fin["A"].pk}, format="json")
    assert m.data["issue"] == "ok" and Payment.objects.get(ref="MTN-9").amount == 60000
    assert client.post(URL + f"statement/{lines['MTN-9']['id']}/match/", {"student": fin["A"].pk}, format="json").status_code == 400
    login(fin["directeur"])
    assert client.get(URL + "statement/").status_code == 200
    assert client.post(URL + f"statement/{lines['WV-1']['id']}/fix/", format="json").status_code == 403


# ---------- Mobile money ----------
SECRET = "test-webhook-secret"


@pytest.fixture
def hook(settings, client):
    settings.MOBILE_MONEY_WEBHOOK_SECRET = SECRET
    settings.MOBILE_MONEY_SANDBOX = False

    def send(payload, *, secret=SECRET, ts=None, sign=True):
        body = json.dumps(payload).encode()
        ts = str(ts if ts is not None else int(time.time()))
        headers = {"HTTP_X_TIMESTAMP": ts}
        if sign:
            headers["HTTP_X_SIGNATURE"] = "sha256=" + services.webhook_signature(secret, ts, body)
        client.credentials()
        return client.post("/api/v1/webhooks/mobile-money/", data=body, content_type="application/json", **headers)
    return send


def initiate(client, w, amount=60000, mode="orange"):
    r = client.post(URL + "pay/initiate/", {"student": w["A"].pk, "amount": amount, "mode": mode, "phone": "07 07 07 07 07"}, format="json")
    return r


def test_initiate_rules(fin, login, client):
    login(fin["A"].parent.user)
    r = initiate(client, fin)
    assert r.status_code == 201 and r.data["status"] == "pending" and not Payment.objects.exists()   # rien d'encaissé
    assert initiate(client, fin, amount=999999).status_code == 400
    assert initiate(client, fin, mode="especes").status_code == 400
    assert client.post(URL + "pay/initiate/", {"student": fin["B"].pk, "amount": 1000, "mode": "wave", "phone": "0707070707"}, format="json").status_code == 404  # enfant d'un autre parent
    for r_ in ("comptable", "eleve", "directeur"):
        login(fin[r_])
        assert initiate(client, fin).status_code == 403, r_


def test_webhook_success_is_idempotent(fin, login, client, hook):
    login(fin["A"].parent.user)
    ref = initiate(client, fin).data["reference"]
    evt = {"event": "payment.succeeded", "reference": ref, "provider_ref": "OM-XYZ-1", "amount": 60000}
    r = hook(evt)
    assert r.status_code == 200 and r.json()["status"] == "succeeded"
    p = Payment.objects.get()
    assert p.amount == 60000 and p.mode == "orange" and p.ref == "OM-XYZ-1" and p.by is None
    assert PaymentIntent.objects.get().status == "succeeded"
    assert hook(evt).json()["status"] == "already_processed"            # l'opérateur rejoue : aucun second paiement
    assert Payment.objects.count() == 1
    login(fin["A"].parent.user)
    assert client.get(URL + f"pay/{ref}/").data["status"] == "succeeded"
    assert client.get(URL + f"students/{fin['A'].pk}/account/").data["paid"] == 60000


def test_webhook_rejects_bad_signature_and_replay(fin, login, client, hook):
    login(fin["A"].parent.user)
    ref = initiate(client, fin).data["reference"]
    evt = {"event": "payment.succeeded", "reference": ref, "provider_ref": "OM-1", "amount": 60000}
    assert hook(evt, secret="mauvais-secret").status_code == 401
    assert hook(evt, sign=False).status_code == 401
    assert hook(evt, ts=int(time.time()) - 3600).status_code == 401      # horodatage trop ancien : rejeu refusé
    assert not Payment.objects.exists() and PaymentIntent.objects.get().status == "pending"


def test_webhook_tampered_body_is_rejected(fin, login, client, settings):
    settings.MOBILE_MONEY_WEBHOOK_SECRET = SECRET
    login(fin["A"].parent.user)
    ref = initiate(client, fin).data["reference"]
    ts = str(int(time.time()))
    signed = json.dumps({"event": "payment.succeeded", "reference": ref, "provider_ref": "X", "amount": 1000}).encode()
    forged = json.dumps({"event": "payment.succeeded", "reference": ref, "provider_ref": "X", "amount": 60000}).encode()
    sig = services.webhook_signature(SECRET, ts, signed)
    client.credentials()
    r = client.post("/api/v1/webhooks/mobile-money/", data=forged, content_type="application/json", HTTP_X_TIMESTAMP=ts, HTTP_X_SIGNATURE=sig)
    assert r.status_code == 401 and not Payment.objects.exists()


def test_webhook_amount_mismatch_and_failure(fin, login, client, hook):
    login(fin["A"].parent.user)
    ref = initiate(client, fin).data["reference"]
    r = hook({"event": "payment.succeeded", "reference": ref, "provider_ref": "OM-2", "amount": 30000})
    assert r.json()["status"] == "mismatch" and not Payment.objects.exists()
    assert Notification.objects.filter(user=fin["comptable"], text__contains="vérifier").exists()
    login(fin["A"].parent.user)
    ref2 = initiate(client, fin).data["reference"]
    assert hook({"event": "payment.failed", "reference": ref2, "provider_ref": "", "amount": 0}).json()["status"] == "failed"
    assert Notification.objects.filter(user=fin["A"].parent.user, text__contains="n’a pas abouti").exists()
    assert hook({"event": "payment.succeeded", "reference": ref2, "provider_ref": "late", "amount": 60000}).json()["status"] == "already_processed"


def test_webhook_unknown_and_unconfigured(fin, hook, settings, client):
    assert hook({"event": "payment.succeeded", "reference": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "provider_ref": "A", "amount": 1}).status_code == 400
    assert hook({"event": "autre"}).status_code == 400
    settings.MOBILE_MONEY_WEBHOOK_SECRET = ""
    assert client.post("/api/v1/webhooks/mobile-money/", data=b"{}", content_type="application/json").status_code == 503


def test_sandbox(fin, login, client, settings):
    settings.MOBILE_MONEY_SANDBOX = False
    login(fin["A"].parent.user)
    ref = initiate(client, fin).data["reference"]
    assert client.post(URL + f"pay/{ref}/sandbox-confirm/").status_code == 404   # désactivé par défaut
    settings.MOBILE_MONEY_SANDBOX = True
    assert client.post(URL + f"pay/{ref}/sandbox-confirm/").data["status"] == "succeeded"
    assert Payment.objects.get().mode == "orange"


def test_sandbox_can_simulate_a_refusal(fin, login, client, settings):
    settings.MOBILE_MONEY_SANDBOX = True
    login(fin["A"].parent.user)
    ref = initiate(client, fin).data["reference"]
    r = client.post(URL + f"pay/{ref}/sandbox-confirm/?fail=1").data
    assert r["status"] == "failed" and r["payment"] is None and Payment.objects.count() == 0


def test_reminders_only_reach_families_with_overdue(fin, login, client, users):
    from apps.notifications.models import Notification
    login(fin["comptable"])
    a, b = fin["A"], fin["B"]
    pay(client, b, 10_000_000_00 // 100_00)  # B règle une partie seulement : le but est de tester l'envoi, pas le montant
    r = client.post(URL + "reminders/", {"students": [a.pk, b.pk]}, format="json")
    assert r.status_code == 200 and r.data["sent"] in (1, 2)
    assert Notification.objects.filter(user=a.parent.user, text__startswith="Rappel").exists()
    assert client.post(URL + "reminders/", {"students": []}, format="json").status_code == 400
    login(users["educateur"])
    assert client.post(URL + "reminders/", {"students": [a.pk]}, format="json").status_code == 403


def test_receipt(fin, login, client):
    login(fin["comptable"])
    p = pay(client, fin["A"], 50000).data
    r = client.get(URL + f"payments/{p['id']}/receipt/").data
    assert r["receipt_no"] == "REC-2026-00001" and r["student"]["class"] == "6e A" and r["payer"] == "M. Aka"
    login(fin["A"].parent.user)
    assert client.get(URL + f"payments/{p['id']}/receipt/").status_code == 200


def test_receipt_pdf(fin, login, client):
    login(fin["comptable"])
    p = pay(client, fin["A"], 50000).data
    r = client.get(URL + f"payments/{p['id']}/receipt.pdf")
    assert r.status_code == 200 and r["Content-Type"] == "application/pdf"
    body = b"".join(r.streaming_content) if r.streaming else r.content
    assert body.startswith(b"%PDF") and len(body) > 1500
    assert "recu-REC-2026-00001.pdf" in r["Content-Disposition"] and "no-store" in r["Cache-Control"]
    # le parent concerné peut le télécharger ; l'élève d'une autre famille non ; sans connexion non
    login(fin["A"].parent.user)
    assert client.get(URL + f"payments/{p['id']}/receipt.pdf").status_code == 200
    login(fin["B"].parent.user)
    assert client.get(URL + f"payments/{p['id']}/receipt.pdf").status_code == 404
    login(fin["enseignant"])
    assert client.get(URL + f"payments/{p['id']}/receipt.pdf").status_code in (403, 404)
    client.credentials()
    assert client.get(URL + f"payments/{p['id']}/receipt.pdf").status_code == 401


def test_receipt_pdf_cancelled_still_renders(fin, login, client):
    login(fin["comptable"])
    p = pay(client, fin["A"], 50000).data
    assert client.post(URL + f"payments/{p['id']}/cancel/", {"reason": "erreur de saisie"}, format="json").status_code == 200
    r = client.get(URL + f"payments/{p['id']}/receipt.pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")


@pytest.mark.parametrize("n,txt", [
    (0, "zéro"), (1, "un"), (21, "vingt et un"), (71, "soixante et onze"), (80, "quatre-vingts"), (91, "quatre-vingt-onze"),
    (100, "cent"), (200, "deux cents"), (280, "deux cent quatre-vingts"), (1000, "mille"), (2000, "deux mille"),
    (80000, "quatre-vingt mille"), (50000, "cinquante mille"), (230000, "deux cent trente mille"),
    (1_500_000, "un million cinq cent mille"), (2_000_000, "deux millions"),
])
def test_amount_in_words(n, txt):
    from apps.finance.receipt import words
    assert words(n) == txt


def _pay_xlsx(rows):
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active; ws.title = "Paiements"
    for r in rows:
        ws.append(r)
    buf = io.BytesIO(); wb.save(buf)
    return SimpleUploadedFile("paiements.xlsx", buf.getvalue())


def test_import_paiements_anciens(fin, login, client):
    A, B = fin["A"], fin["B"]
    hdr = ["matricule", "montant", "date", "mode", "reference", "note"]
    rows = [hdr,
            [A.matricule, 100000, "15/09/2026", "espèces", "", ""],
            [A.matricule, 100000, "02/10/2026", "Orange Money", "OM1", "Tranche 2"],
            [A.matricule, 100000, "03/10/2026", "wave", "", ""],      # dépasse le solde (230 000 - 200 000 = 30 000)
            [B.matricule, 10000, "01/01/2030", "espece", "", ""],      # futur
            ["XX-0000", 5000, "01/10/2026", "espece", "", ""],         # matricule inconnu
            [B.matricule, 5000, "01/10/2026", "orange", "OM1", ""],   # référence déjà utilisée dans le fichier
            [B.matricule, "abc", "01/10/2026", "espece", "", ""],
            [B.matricule, 5000, "01/10/2026", "troc", "", ""]]
    login(fin["admin"])
    assert client.post(URL + "payments/import/", {"file": _pay_xlsx(rows)}, format="multipart").status_code == 403  # secrétariat : pas d'encaissement
    login(fin["comptable"])
    Notification.objects.all().delete()
    r = client.post(URL + "payments/import/", {"file": _pay_xlsx(rows)}, format="multipart")
    assert r.status_code == 200 and r.data["valid"] == 2 and len(r.data["errors"]) == 6, r.data
    assert Payment.objects.count() == 0  # simple vérification
    msgs = {e["line"]: " ".join(e["errors"]) for e in r.data["errors"]}
    assert "solde" in msgs[4] and "futur" in msgs[5] and "matricule" in msgs[6] and "référence" in msgs[7] and "montant" in msgs[8] and "mode" in msgs[9]
    r = client.post(URL + "payments/import/?commit=1", {"file": _pay_xlsx(rows)}, format="multipart")
    assert r.status_code == 201 and len(r.data["created"]) == 2 and Payment.objects.count() == 2
    assert fees.account(A, datetime.date(2026, 12, 14))["paid"] == 200000
    assert {p.date for p in Payment.objects.all()} == {datetime.date(2026, 9, 15), datetime.date(2026, 10, 2)}
    assert Notification.objects.count() == 0  # aucune notification pour des paiements anciens
    # ré-importer le même fichier : la référence est déjà encaissée, le solde est entamé
    r = client.post(URL + "payments/import/?commit=1", {"file": _pay_xlsx(rows)}, format="multipart")
    assert Payment.objects.count() == 2 and r.data["valid"] == 0  # tout est refusé : soldes et références déjà pris
    assert client.get(URL + "payments/import/modele/").content[:2] == b"PK"


def test_school_defines_its_own_tranches(fin, login, client):
    login(fin["comptable"])
    a = client.get(URL + f"students/{fin['A'].pk}/account/").data
    assert [l["label"] for l in a["lines"]] == ["Inscription", "1re tranche", "2e tranche", "3e tranche"]
    r = client.put(URL + "tranches/", {"tranches": [{"label": "Rentrée", "part": 50}, {"label": "Février", "part": 30}, {"label": "Mai", "part": 20}, {"label": "Juin", "part": 5}]}, format="json")
    assert r.status_code == 200 and len(r.data["tranches"]) == 4
    a = client.get(URL + f"students/{fin['A'].pk}/account/").data
    assert [l["key"] for l in a["lines"]] == ["INS", "T1", "T2", "T3", "T4"] and [l["label"] for l in a["lines"]][1] == "Rentrée"
    amounts = [l["amount"] for l in a["lines"]][1:]
    assert sum(amounts) == 180000 and amounts[0] == 85714 and amounts[-1] == 180000 - sum(amounts[:-1])   # la dernière reçoit le reste
    # deux tranches égales (semestres) : montants entiers, total exact
    client.put(URL + "tranches/", {"tranches": [{"label": "1er semestre", "part": 1}, {"label": "2e semestre", "part": 1}]}, format="json")
    a = client.get(URL + f"students/{fin['A'].pk}/account/").data
    assert [l["amount"] for l in a["lines"]] == [50000, 90000, 90000] and a["total"] == 230000
    # une échéance qui n'existe pas dans les tranches de l'école est refusée
    assert client.put(URL + "dates/", {"key": "T3", "date": "2026-12-01"}, format="json").status_code == 400
    assert client.put(URL + "dates/", {"key": "T2", "date": "2027-01-10"}, format="json").status_code == 200
    # refus des réglages incohérents
    for bad in ([], [{"label": "A", "part": 0}], [{"label": "A", "part": 1}, {"label": "a", "part": 1}], "x", [{"label": "A", "part": "ab"}]):
        assert client.put(URL + "tranches/", {"tranches": bad}, format="json").status_code == 400, bad
    login(fin["directeur"])                      # la direction lit mais ne modifie pas les tarifs
    assert client.get(URL + "tranches/").status_code == 200
    assert client.put(URL + "tranches/", {"tranches": [{"label": "A", "part": 1}]}, format="json").status_code == 403


def test_payments_survive_a_change_of_tranches(fin, login, client):
    login(fin["comptable"])
    pay(client, fin["A"], 100000)
    client.put(URL + "tranches/", {"tranches": [{"label": "1er semestre", "part": 1}, {"label": "2e semestre", "part": 1}]}, format="json")
    a = client.get(URL + f"students/{fin['A'].pk}/account/").data
    assert a["paid"] == 100000 and a["balance"] == 130000 and [l["paid"] for l in a["lines"]] == [50000, 50000, 0]
