import pytest

from apps.communication.models import Message, Thread
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db
A = "/api/v1/announcements/"
M = "/api/v1/messages/"


def test_announcements(school, users, login, client):
    for r in ("enseignant", "parent", "eleve", "comptable", "educateur"):
        login(users[r])
        assert client.post(A, {"title": "T", "body": "B", "audience": ["parent"]}, format="json").status_code == 403, r
    login(users["directeur"])
    assert client.post(A, {"title": "Réunion", "body": "Samedi", "audience": ["parent", "enseignant"]}, format="json").status_code == 201
    assert client.post(A, {"title": "x", "body": "y", "audience": []}, format="json").status_code == 400
    assert client.post(A, {"title": "x", "body": "y", "audience": ["roi"]}, format="json").status_code == 400
    assert Notification.objects.filter(user=school["A"].parent.user, text__contains="Réunion").exists()
    assert not Notification.objects.filter(user=users["comptable"]).exists()      # hors audience
    for role, n in (("parent", 1), ("enseignant", 1), ("comptable", 0), ("eleve", 0)):
        login(users[role])
        assert len(client.get(A).data) == n, role
    login(users["admin"])
    assert len(client.get(A).data) == 1


def test_recipients_by_role(school, users, login, client):
    login(school["A"].user)
    assert client.get(M + "recipients/").data == []
    login(school["A"].parent.user)
    ids = {c["user"] for c in client.get(M + "recipients/").data}
    assert {school["prof"].pk, users["directeur"].pk, users["educateur"].pk} <= ids
    assert school["hors"].pk not in ids and users["comptable"].pk not in ids         # pas un enseignant de ses enfants
    assert school["B"].parent.user.pk not in ids                                        # jamais un autre parent
    login(school["prof"])
    ps = [c for c in client.get(M + "recipients/").data if c["group"] == "Parents"]
    assert {c["user"] for c in ps} == {school["A"].parent.user.pk, school["B"].parent.user.pk}
    login(school["hors"])
    assert [c for c in client.get(M + "recipients/").data if c["group"] == "Parents"] == []   # aucune classe


def test_students_cannot_send(school, login, client, users):
    login(school["A"].user)
    r = client.post(M + "threads/", {"recipients": [users["directeur"].pk], "subject": "s", "text": "t"}, format="json")
    assert r.status_code == 403


def test_parent_gets_own_thread_each(school, users, login, client):
    login(users["directeur"])
    r = client.post(M + "threads/", {"recipients": [school["A"].parent.user.pk, school["B"].parent.user.pk], "subject": "Réunion", "text": "Bonjour"}, format="json")
    assert r.status_code == 201 and len(r.data["threads"]) == 2                    # une conversation par famille
    assert all(Thread.objects.get(pk=t).members.count() == 2 for t in r.data["threads"])
    login(school["A"].parent.user)
    mine = client.get(M + "threads/").data
    assert len(mine) == 1 and mine[0]["unread"] == 1
    assert [p["id"] for p in mine[0]["participants"] if p["id"] == school["B"].parent.user.pk] == []
    other = [t for t in r.data["threads"] if t != mine[0]["id"]][0]
    assert client.get(M + f"threads/{other}/").status_code == 404                  # la conversation d'un autre parent est invisible
    assert client.post(M + f"threads/{other}/reply/", {"text": "intrus"}, format="json").status_code == 404


def test_staff_group_thread_reply_read(school, users, login, client):
    login(users["directeur"])
    t = client.post(M + "threads/", {"recipients": [school["prof"].pk, users["educateur"].pk], "subject": "Conseil", "text": "Bonjour"}, format="json").data["threads"]
    assert len(t) == 1                                                             # personnel : une seule conversation de groupe
    login(school["prof"])
    assert client.get(M + "unread-count/").data == {"unread": 1}
    d = client.get(M + f"threads/{t[0]}/").data
    assert len(d["messages"]) == 1 and d["unread"] == 1                            # lire ne marque pas comme lu
    client.post(M + f"threads/{t[0]}/read/")
    assert client.get(M + "unread-count/").data == {"unread": 0}
    assert client.post(M + f"threads/{t[0]}/reply/", {"text": "Bien reçu"}, format="json").status_code == 201
    assert client.post(M + f"threads/{t[0]}/reply/", {"text": "  "}, format="json").status_code == 400
    login(users["directeur"])
    assert client.get(M + "threads/").data[0]["unread"] == 1
    assert Notification.objects.filter(user=users["directeur"], text__contains="a répondu").exists()
    login(users["comptable"])
    assert client.get(M + f"threads/{t[0]}/").status_code == 404
    assert Message.objects.count() == 2


def test_send_restrictions(school, users, login, client):
    login(school["A"].parent.user)
    for target in (users["comptable"], school["hors"], school["B"].parent.user):
        r = client.post(M + "threads/", {"recipients": [target.pk], "subject": "s", "text": "t"}, format="json")
        assert r.status_code == 400, target
    login(school["hors"])   # enseignant d'aucune classe : ne peut pas écrire à un parent
    assert client.post(M + "threads/", {"recipients": [school["A"].parent.user.pk], "subject": "s", "text": "t"}, format="json").status_code == 400
    login(school["prof"])
    assert client.post(M + "threads/", {"recipients": [school["A"].parent.user.pk], "subject": " ", "text": "t"}, format="json").status_code == 400
    assert client.post(M + "threads/", {"recipients": [school["A"].parent.user.pk], "subject": "Devoirs", "text": "t"}, format="json").status_code == 201
