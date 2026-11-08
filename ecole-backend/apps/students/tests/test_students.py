import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.academics.models import SchoolClass
from apps.accounts.models import User
from apps.students.models import Parent, Student

pytestmark = pytest.mark.django_db

BODY = dict(nom="Kouassi", prenoms="Awa", sexe="F", naissance="2013-05-02", lieu="Abidjan",
            parent_name="M. Kouassi Paul", parent_phone="07 01 02 03 04")


@pytest.fixture
def base(db):
    from django.core.management import call_command
    call_command("seed_school")
    return {c.name: c for c in SchoolClass.objects.all()}


def enroll(client, cls, **kw):
    return client.post("/api/v1/students/", {**BODY, "school_class": cls.pk, **kw}, format="json")


def test_only_secretariat_enrolls(users, login, client, base):
    for role in ("directeur", "enseignant", "comptable", "parent", "eleve"):
        login(users[role])
        assert enroll(client, base["6e A"]).status_code == 403, role
    login(users["admin"])
    assert enroll(client, base["6e A"]).status_code == 201


def test_enrollment_creates_accounts_once(users, login, client, base):
    login(users["admin"])
    r = enroll(client, base["6e A"])
    s = r.data["student"]
    assert s["matricule"] == "HZ26-0001" and s["nom"] == "KOUASSI"
    creds = {c["role"]: c for c in r.data["credentials"]}
    assert creds["eleve"]["username"] == "hz26-0001" and creds["parent"]["username"] == "0701020304"
    # les mots de passe ne sont jamais stockés en clair et obligent à changer
    u = User.objects.get(username="hz26-0001")
    assert u.check_password(creds["eleve"]["password"]) and u.must_change_password
    assert "password" not in str(client.get(f"/api/v1/students/{s['id']}/").data)
    # l'interface relie l'élève et son parent à leurs vrais comptes
    assert s["user_id"] == u.id and s["parent_user_id"] == User.objects.get(username="0701020304").id
    # l'élève peut se connecter avec ses identifiants provisoires
    client.credentials()
    assert client.post("/api/v1/auth/login/", {"username": "hz26-0001", "password": creds["eleve"]["password"]}, format="json").status_code == 200


def test_sibling_reuses_parent_and_increments_matricule(users, login, client, base):
    login(users["admin"])
    enroll(client, base["6e A"])
    r = enroll(client, base["5e A"], prenoms="Koffi", sexe="M", parent_phone="0701020304")
    assert r.data["student"]["matricule"] == "HZ26-0002"
    assert [c["role"] for c in r.data["credentials"]] == ["eleve"]  # pas de second compte parent
    assert Parent.objects.count() == 1 and Parent.objects.first().children.count() == 2


def test_duplicate_and_full_class(users, login, client, base):
    login(users["admin"])
    assert enroll(client, base["6e A"]).status_code == 201
    assert enroll(client, base["6e A"], parent_phone="0505050505").status_code == 400  # doublon
    c = base["6e B"]
    c.max_students = 1
    c.save()
    assert enroll(client, c, prenoms="Un").status_code == 201
    r = enroll(client, c, prenoms="Deux")
    assert r.status_code == 400 and "complète" in r.data["detail"]


def test_phone_validation(users, login, client, base):
    login(users["admin"])
    assert enroll(client, base["6e A"], parent_phone="123").status_code == 400


def test_phone_collision_with_other_account(users, make_user, login, client, base):
    make_user("enseignant", "0701020304")
    login(users["admin"])
    assert enroll(client, base["6e A"]).status_code == 400
    assert Student.objects.count() == 0  # rien n'est créé à moitié (transaction)
    assert not User.objects.filter(username__startswith="hz").exists()


def test_scoping_by_role(users, make_user, login, client, base):
    login(users["admin"])
    a = enroll(client, base["6e A"]).data["student"]
    b = enroll(client, base["3e A"], nom="Traoré", prenoms="Ali", sexe="M", parent_phone="0505050505", parent_name="M. Traoré").data["student"]
    # l'élève et le parent ne voient que leur périmètre
    kid = User.objects.get(pk=Student.objects.get(pk=a["id"]).user_id)
    kid.set_password("secret1"); kid.save()
    login(kid)
    assert [x["id"] for x in client.get("/api/v1/students/").data["results"]] == [a["id"]]
    assert client.get(f"/api/v1/students/{b['id']}/").status_code == 404
    par = Parent.objects.get(phone_digits="0505050505").user
    par.set_password("secret1"); par.save()
    login(par)
    assert [x["id"] for x in client.get("/api/v1/students/").data["results"]] == [b["id"]]
    assert client.get(f"/api/v1/students/{a['id']}/").status_code == 404
    assert [c["name"] for c in client.get("/api/v1/classes/").data] == ["3e A"]
    # l'enseignant ne voit que les classes qui lui sont affectées
    from apps.academics.models import Subject, Teacher, TeachingAssignment
    prof = make_user("enseignant", "prof.x")
    login(prof)
    assert client.get("/api/v1/students/").data["results"] == []
    TeachingAssignment.objects.update_or_create(subject=Subject.objects.get(code="ma"), school_class=base["3e A"], defaults={"teacher": Teacher.objects.get(user=prof)})
    assert [x["id"] for x in client.get("/api/v1/students/").data["results"]] == [b["id"]]
    # l'élève ne peut pas modifier
    login(kid)
    assert client.patch(f"/api/v1/students/{a['id']}/", {"lieu": "X"}, format="json").status_code == 403


def test_update_change_class_and_deactivate(users, login, client, base):
    login(users["admin"])
    s = enroll(client, base["6e A"]).data["student"]
    r = client.patch(f"/api/v1/students/{s['id']}/", {"school_class": base["6e B"].pk, "lieu": "Bouaké"}, format="json")
    assert r.status_code == 200 and r.data["class_name"] == "6e B" and r.data["lieu"] == "Bouaké"
    assert Student.objects.get(pk=s["id"]).enrollments.get().school_class == base["6e B"]
    client.patch(f"/api/v1/students/{s['id']}/", {"active": False}, format="json")
    assert not User.objects.get(username="hz26-0001").is_active


def csv_file(text):
    return SimpleUploadedFile("e.csv", ("﻿" + text).encode(), content_type="text/csv")


CSV = (
    "nom;prenoms;sexe;naissance;lieu;classe;parent;telephone\n"
    "Diallo;Mariam;F;12/03/2013;Abidjan;6e A;M. Diallo;01 02 03 04 05\n"
    "Diallo;Issa;M;2014-07-01;Abidjan;6e A;M. Diallo;0102030405\n"
    ";Sans;M;01/01/2013;;6e A;X;0102030405\n"
    "Bah;Zoe;F;31/02/2013;;6e A;X;0102030405\n"
    "Bah;Zoe;F;01/02/2013;;9e Z;X;0102030405\n"
    "Bah;Zoe;F;01/02/2013;;6e A;X;12\n"
    "Diallo;Mariam;F;12/03/2013;;6e A;M. Diallo;0102030405\n"
)


def test_import_dry_run_then_commit(users, login, client, base):
    login(users["admin"])
    r = client.post("/api/v1/students/import/", {"file": csv_file(CSV)}, format="multipart")
    assert r.status_code == 200 and r.data["total"] == 7 and r.data["valid"] == 2 and len(r.data["errors"]) == 5
    assert Student.objects.count() == 0  # simple vérification
    msgs = {e["line"]: " ".join(e["errors"]) for e in r.data["errors"]}
    assert "nom manquant" in msgs[4] and "date" in msgs[5] and "classe inconnue" in msgs[6]
    assert "téléphone" in msgs[7] and "doublon" in msgs[8]
    r = client.post("/api/v1/students/import/?commit=1", {"file": csv_file(CSV)}, format="multipart")
    assert r.status_code == 201 and len(r.data["created"]) == 2
    assert Student.objects.count() == 2 and Parent.objects.count() == 1  # fratrie → un seul compte parent
    assert sum(c["role"] == "parent" for c in r.data["credentials"]) == 1
    # ré-importer le même fichier ne crée rien (doublons)
    r = client.post("/api/v1/students/import/?commit=1", {"file": csv_file(CSV)}, format="multipart")
    assert Student.objects.count() == 2 and r.data["valid"] == 0


def test_import_respects_capacity_and_columns(users, login, client, base):
    c = base["6e A"]; c.max_students = 1; c.save()
    login(users["admin"])
    two = "nom;prenoms;sexe;naissance;lieu;classe;parent;telephone\nA;B;M;01/01/2013;;6e A;P;0102030405\nC;D;M;01/01/2013;;6e A;P;0102030405\n"
    r = client.post("/api/v1/students/import/?commit=1", {"file": csv_file(two)}, format="multipart")
    assert len(r.data["created"]) == 1 and "complète" in r.data["errors"][0]["errors"][0]
    r = client.post("/api/v1/students/import/", {"file": csv_file("nom;prenoms\nA;B\n")}, format="multipart")
    assert r.status_code == 400 and "Colonnes manquantes" in r.data["detail"]
    assert client.post("/api/v1/students/import/", {}, format="multipart").status_code == 400


def test_import_and_export_permissions(users, login, client, base):
    for role in ("enseignant", "comptable", "parent", "educateur"):
        login(users[role])
        assert client.post("/api/v1/students/import/", {"file": csv_file(CSV)}, format="multipart").status_code == 403, role
        assert client.get("/api/v1/students/export/").status_code == 403, role


def test_export_roundtrip(users, login, client, base):
    login(users["admin"])
    enroll(client, base["6e A"])
    r = client.get("/api/v1/students/export/")
    assert r.status_code == 200 and "attachment" in r["Content-Disposition"]
    text = r.content.decode("utf-8-sig")
    assert "HZ26-0001;KOUASSI;Awa;F;02/05/2013;Abidjan;6e A" in text


def test_logged(users, login, client, base):
    from apps.core.models import ActivityLog
    login(users["admin"])
    enroll(client, base["6e A"])
    assert ActivityLog.objects.filter(action="Inscription").exists()


def _xlsx(rows, sheet="Élèves"):
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active; ws.title = sheet
    for r in rows:
        ws.append(r)
    buf = io.BytesIO(); wb.save(buf)
    return SimpleUploadedFile("eleves.xlsx", buf.getvalue(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def test_import_xlsx_et_modele(users, login, client, base):
    import datetime
    login(users["admin"])
    r = client.get("/api/v1/students/import/modele/")
    assert r.status_code == 200 and r.content[:2] == b"PK" and "xlsx" in r["Content-Disposition"]
    # le modèle téléchargé se relit tel quel (classes en liste déroulante, exemples valides)
    from apps.students import csvio
    assert len(csvio.read_rows(r.content)) == 2
    # Excel : date en vrai type date, téléphone numérique sans 0 initial, en-têtes avec accents
    f = _xlsx([["Nom", "Prénoms", "Sexe", "Date de naissance", "Lieu", "Classe", "Parent", "Téléphone"],
               ["Kouadio", "Eric", "M", datetime.datetime(2013, 5, 4), "Bouaké", "6e A", "M. Kouadio", 102030405],
               ["", "", "", "", "", "", "", ""]])
    r = client.post("/api/v1/students/import/", {"file": f}, format="multipart")
    assert r.status_code == 200 and r.data["total"] == 1 and r.data["valid"] == 1, r.data
    r = client.post("/api/v1/students/import/?commit=1", {"file": _xlsx([["nom", "prenoms", "sexe", "naissance", "lieu", "classe", "parent", "telephone"],
                    ["Kouadio", "Eric", "M", "04/05/2013", "Bouaké", "6e A", "M. Kouadio", "0102030405"]])}, format="multipart")
    assert r.status_code == 201 and Student.objects.get().naissance.isoformat() == "2013-05-04"


def test_import_fichiers_refuses(users, login, client, base):
    login(users["admin"])
    assert "Colonnes manquantes" in client.post("/api/v1/students/import/", {"file": _xlsx([["a", "b"]])}, format="multipart").data["detail"]
    old = SimpleUploadedFile("vieux.xls", b"\xd0\xcf\x11\xe0" + b"0" * 50)
    assert ".xlsx" in client.post("/api/v1/students/import/", {"file": old}, format="multipart").data["detail"]
    bad = SimpleUploadedFile("faux.xlsx", b"PK\x03\x04" + b"x" * 100)
    assert client.post("/api/v1/students/import/", {"file": bad}, format="multipart").status_code == 400
    assert client.post("/api/v1/students/import/", {"file": SimpleUploadedFile("v.csv", b"")}, format="multipart").status_code == 400
    login(users["enseignant"])
    assert client.get("/api/v1/students/import/modele/").status_code == 403


def test_import_numero_de_ligne_du_fichier(users, login, client, base):
    login(users["admin"])
    f = _xlsx([["nom", "prenoms", "sexe", "naissance", "lieu", "classe", "parent", "telephone"], [], ["", "Eric", "M", "04/05/2013", "", "6e A", "P", "0102030405"]])
    r = client.post("/api/v1/students/import/", {"file": f}, format="multipart")
    assert r.data["errors"][0]["line"] == 3  # la ligne 3 du classeur, ligne vide comprise


def test_import_classes_et_personnel(users, login, client, base):
    from apps.academics.models import SchoolClass, Teacher
    from apps.accounts.models import User
    login(users["admin"])
    hdr = ["nom", "niveau", "serie", "effectif_max"]
    r = client.post("/api/v1/classes/import/", {"file": _xlsx([hdr, ["6e A", "6e", "", 45], ["Tle D1", "Tle", "D", 30], ["Tle X", "Tle", "", 30], ["5e Z", "5e", "", "abc"], ["4e Z", "4e", "", ""]], "Classes")}, format="multipart")
    assert r.status_code == 200 and r.data["valid"] == 2 and len(r.data["errors"]) == 3  # 6e A existe déjà, série manquante, effectif invalide
    assert not SchoolClass.objects.filter(name="Tle D1").exists()
    f = _xlsx([hdr, ["Tle D1", "Tle", "D", 30], ["4e Z", "4e", "", ""]], "Classes")
    r = client.post("/api/v1/classes/import/?commit=1", {"file": f}, format="multipart")
    assert r.status_code == 201 and SchoolClass.objects.get(name="Tle D1").groupe == "Tle D" and SchoolClass.objects.get(name="4e Z").max_students == 45
    assert client.get("/api/v1/classes/import/modele/").content[:2] == b"PK"
    # personnel
    h2 = ["nom", "role", "email", "telephone", "identifiant", "matieres"]
    rows = [h2, ["Mme Konan Aya", "enseignant", "aya@x.ci", 707112233, "", "Mathématiques"], ["M. Koffi Serge", "comptable", "serge@x.ci", "", "", ""],
            ["Dir X", "directeur", "d@x.ci", "", "", ""], ["Sans Mail", "educateur", "", "", "", ""], ["Mme Konan Aya", "enseignant", "aya@x.ci", "", "", ""],
            ["Prof Y", "enseignant", "y@x.ci", "", "", "Alchimie"]]
    r = client.post("/api/v1/users/import/", {"file": _xlsx(rows, "Personnel")}, format="multipart")
    assert r.status_code == 200 and r.data["valid"] == 2 and len(r.data["errors"]) == 4, r.data
    msgs = {e["line"]: " ".join(e["errors"]) for e in r.data["errors"]}
    assert "rôle inconnu" in msgs[4] and "e-mail" in msgs[5] and "déjà utilisé" in msgs[6] and "matière inconnue" in msgs[7]
    r = client.post("/api/v1/users/import/?commit=1", {"file": _xlsx(rows, "Personnel")}, format="multipart")
    assert r.status_code == 201 and len(r.data["credentials"]) == 2
    u = User.objects.get(email="aya@x.ci")
    assert u.role == "enseignant" and u.must_change_password and u.phone == "07 07 11 22 33" and u.phone
    assert Teacher.objects.get(user=u).subjects.filter(name="Mathématiques").exists()
    assert User.objects.get(email="serge@x.ci").role == "comptable"
    # permissions
    login(users["enseignant"])
    for url in ("/api/v1/classes/import/", "/api/v1/users/import/"):
        assert client.post(url, {"file": _xlsx([hdr])}, format="multipart").status_code == 403


def test_import_matieres(users, login, client, base):
    from apps.academics.models import Subject
    login(users["admin"])
    hdr = ["matiere", "abreviation"]
    rows = [hdr, ["Alchimie", "Alch"], ["Informatique appliquée", ""], ["Musique", "Mus"], ["musique", ""], ["", "X"], ["Une abréviation vraiment trop longue", "abcdefghijklmnop"]]
    r = client.post("/api/v1/subjects/import/", {"file": _xlsx(rows, "Matières")}, format="multipart")
    msgs = {e["line"]: " ".join(e["errors"]) for e in r.data["errors"]}
    assert r.status_code == 200 and r.data["valid"] == 3 and len(r.data["errors"]) == 3, r.data
    assert "déjà existante" in msgs[5] and "manquant" in msgs[6] and "trop longue" in msgs[7]
    assert not Subject.objects.filter(name="Musique").exists()                            # vérification seulement
    r = client.post("/api/v1/subjects/import/?commit=1", {"file": _xlsx(rows, "Matières")}, format="multipart")
    assert r.status_code == 201 and len(r.data["created"]) == 3
    s = Subject.objects.get(name="Informatique appliquée")
    assert s.short == "Info" and s.code == "informatique" and Subject.objects.get(name="Musique").short == "Mus"
    r = client.post("/api/v1/subjects/import/", {"file": _xlsx(rows, "Matières")}, format="multipart")   # deuxième passage : tout existe déjà
    assert r.data["valid"] == 0
    assert client.get("/api/v1/subjects/import/modele/").content[:2] == b"PK"
    login(users["enseignant"])
    assert client.post("/api/v1/subjects/import/", {"file": _xlsx([hdr])}, format="multipart").status_code == 403


def test_subject_with_data_cannot_be_deleted(users, login, client, base):
    from apps.academics.models import Subject
    from apps.schedule.models import Cell
    from apps.academics.models import SchoolClass
    login(users["admin"])
    free = Subject.objects.create(code="libre", name="Libre", short="Lib")
    assert client.delete(f"/api/v1/subjects/{free.pk}/").status_code == 204          # sans donnée : supprimée
    used = Subject.objects.create(code="occupee", name="Occupée", short="Occ")
    Cell.objects.create(school_class=SchoolClass.objects.first(), day=0, slot=0, subject=used, room="S1")
    r = client.delete(f"/api/v1/subjects/{used.pk}/")
    assert r.status_code == 400 and "ne peut plus être supprimée" in r.data["detail"]
    assert Subject.objects.filter(pk=used.pk).exists()
    r = client.patch(f"/api/v1/subjects/{used.pk}/", {"name": "Occupée 2"}, format="json")  # renommer reste possible
    assert r.status_code == 200


def test_new_school_starts_without_subjects(db):
    from apps.academics.models import Coefficient, Subject
    from apps.core.schools import create_school
    from apps.core.tenancy import tenant_context
    etab, _ = create_school(code="neuve", nom="École Neuve", director="Mme Test")
    with tenant_context(etab):
        assert Subject.objects.count() == 0 and Coefficient.objects.count() == 0     # elle saisit ses matières
