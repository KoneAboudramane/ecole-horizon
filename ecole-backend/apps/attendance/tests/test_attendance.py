import datetime

import pytest
from django.utils import timezone

from apps.attendance.models import Absence, AppelSession
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db
TODAY = lambda: timezone.localdate().isoformat()  # noqa: E731


def appel(client, w, a="A", b="P", date=None, slot="Matin"):
    return client.put("/api/v1/attendance/appel/", {"school_class": w["c"].pk, "date": date or TODAY(), "slot": slot,
                      "entries": [{"student": w["A"].pk, "status": a}, {"student": w["B"].pk, "status": b}]}, format="json")


def test_appel_rights(school, users, login, client):
    login(school["prof"])
    assert appel(client, school).status_code == 200
    login(school["hors"])
    assert appel(client, school).status_code == 403          # classe non affectée
    login(users["educateur"])
    assert appel(client, school).status_code == 200          # l'éducateur fait l'appel de toutes les classes
    for r in ("comptable", "parent", "eleve", "directeur"):
        login(users[r])
        assert appel(client, school).status_code == 403, r


def test_appel_creates_absence_notifies_family_once(school, login, client):
    login(school["prof"])
    r = appel(client, school)
    assert r.data == {"absents": 1, "notified": 1}
    assert Absence.objects.get().student == school["A"]
    assert Notification.objects.filter(user=school["A"].parent.user, kind="absence").count() == 1
    assert Notification.objects.filter(user=school["A"].user).count() == 1
    appel(client, school)                                     # même appel renvoyé : pas de doublon
    assert Notification.objects.filter(user=school["A"].parent.user).count() == 1
    assert AppelSession.objects.count() == 1


def test_appel_correction_keeps_justif_and_clears(school, login, client):
    login(school["prof"])
    appel(client, school)
    Absence.objects.update(justif="acceptee", motif="Palu")
    appel(client, school, a="R")                              # absent → retard : justificatif conservé
    ab = Absence.objects.get()
    assert ab.status == "R" and ab.justif == "acceptee"
    appel(client, school, a="P")                              # finalement présent
    assert Absence.objects.count() == 0 and AppelSession.objects.count() == 1


def test_appel_validation(school, login, client):
    login(school["prof"])
    future = (timezone.localdate() + datetime.timedelta(days=1)).isoformat()
    assert appel(client, school, date=future).status_code == 400
    r = client.put("/api/v1/attendance/appel/", {"school_class": school["c"].pk, "date": TODAY(), "slot": "Matin",
                   "entries": [{"student": 99999, "status": "A"}]}, format="json")
    assert r.status_code == 400
    assert appel(client, school, slot="Nuit").status_code == 400
    g = client.get(f"/api/v1/attendance/appel/?class={school['c'].pk}&date={TODAY()}&slot=Matin").data
    assert g["done"] is False and len(g["entries"]) == 2


def test_justification_flow(school, users, login, client):
    login(school["prof"])
    appel(client, school)
    ab = Absence.objects.get()
    parent, other = school["A"].parent.user, school["B"].parent.user
    login(other)
    assert client.post(f"/api/v1/absences/{ab.pk}/justify/", {"motif": "Malade"}, format="json").status_code == 404
    login(parent)
    assert client.post(f"/api/v1/absences/{ab.pk}/justify/", {"motif": "x"}, format="json").status_code == 400
    r = client.post(f"/api/v1/absences/{ab.pk}/justify/", {"motif": "Paludisme, certificat joint"}, format="json")
    assert r.status_code == 200 and r.data["justif"] == "en_attente"
    assert client.post(f"/api/v1/absences/{ab.pk}/justify/", {"motif": "encore"}, format="json").status_code == 400
    assert client.post(f"/api/v1/absences/{ab.pk}/decide/", {"accept": True}, format="json").status_code == 403
    assert Notification.objects.filter(user=users["educateur"], kind="absence").exists()
    login(users["educateur"])
    assert client.post(f"/api/v1/absences/{ab.pk}/decide/", {"accept": False}, format="json").data["justif"] == "refusee"
    assert client.post(f"/api/v1/absences/{ab.pk}/decide/", {"accept": True}, format="json").status_code == 400  # plus en attente
    login(parent)  # refusé → la famille peut redéposer
    assert client.post(f"/api/v1/absences/{ab.pk}/justify/", {"motif": "Voici le certificat"}, format="json").status_code == 200
    login(users["directeur"])
    assert client.post(f"/api/v1/absences/{ab.pk}/decide/", {"accept": True}, format="json").data["justif"] == "acceptee"


def test_lates_cannot_be_justified(school, login, client):
    login(school["prof"])
    appel(client, school, a="R")
    login(school["A"].parent.user)
    assert client.post(f"/api/v1/absences/{Absence.objects.get().pk}/justify/", {"motif": "Embouteillage"}, format="json").status_code == 400


def test_absence_list_scoping_and_summary(school, users, login, client):
    login(school["prof"])
    appel(client, school, a="A", b="A")
    assert len(client.get("/api/v1/absences/").data["results"]) == 2
    login(school["hors"])
    assert client.get("/api/v1/absences/").data["results"] == []   # aucune de ses classes
    login(school["A"].parent.user)
    rows = client.get("/api/v1/absences/").data["results"]
    assert [r["student"] for r in rows] == [school["A"].pk]
    assert client.get(f"/api/v1/students/{school['A'].pk}/attendance/").data == {"absences": 1, "justified": 0, "pending": 0, "lates": 0}
    assert client.get(f"/api/v1/students/{school['B'].pk}/attendance/").status_code == 404
    login(users["comptable"])
    assert client.get("/api/v1/absences/").status_code == 403


def test_notifications_api(school, login, client):
    login(school["prof"])
    appel(client, school)
    login(school["A"].parent.user)
    assert client.get("/api/v1/notifications/unread-count/").data == {"unread": 1}
    n = client.get("/api/v1/notifications/").data["results"][0]
    assert n["kind"] == "absence" and "absent" in n["text"]
    login(school["B"].parent.user)
    assert client.get("/api/v1/notifications/").data["results"] == []   # chacun ses notifications
    login(school["A"].parent.user)
    assert client.post("/api/v1/notifications/read/", {}, format="json").data == {"updated": 1}
    assert client.get("/api/v1/notifications/unread-count/").data == {"unread": 0}


def test_sessions_list_is_scoped(school, users, login, client):
    login(school["prof"])
    assert appel(client, school).status_code == 200
    appel_url = "/api/v1/attendance/sessions/"
    login(school["prof"])
    rows = client.get(appel_url).data
    assert len(rows) == 1 and rows[0]["school_class"] == school["c"].pk and rows[0]["slot"] == "Matin"
    login(school["hors"])                                    # enseignant sans classe : rien
    assert client.get(appel_url).data == []
    login(school["A"].parent.user)                           # famille : la classe de son enfant
    assert len(client.get(appel_url).data) == 1
    login(users["comptable"])
    assert client.get(appel_url).status_code == 403
    # les absences sont rendues par pages de 500 (assez pour une année d'une classe)
    login(users["educateur"])
    assert client.get("/api/v1/absences/?page_size=1000").data["count"] == 1
