"""Données réalistes pour la recette (tests d'acceptation avec l'école) : élèves, enseignants, notes, absences, paiements."""
import csv
import datetime
import random
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.academics.models import SchoolClass, Subject, Teacher, TeachingAssignment, Term
from apps.accounts.models import User
from apps.attendance.models import Absence, AppelSession
from apps.core.permissions import ROLE_LABELS
from apps.core.commandutil import add_ecole_option, in_school
from apps.discipline.models import Incident
from apps.finance.services import balance_of, record_payment
from apps.grades.models import Evaluation, Grade
from apps.core.permissions import STAFF_ROLES
from apps.students.models import Student
from apps.students.services import enroll_student

NOMS = ["KOUASSI", "KONE", "TRAORE", "COULIBALY", "YAO", "N'GUESSAN", "DIALLO", "OUATTARA", "BAMBA", "KOFFI", "SORO", "TOURE",
        "KONAN", "ASSI", "BROU", "DOSSO", "FOFANA", "GNAGNE", "ZADI", "AKA", "ADJOUA", "BAH", "CISSE", "DJE", "EKRA"]
PRENOMS_F = ["Awa", "Fanta", "Marie-Ange", "Aïcha", "Edwige", "Nadège", "Mariam", "Christelle", "Salimata", "Affoué", "Kadidja", "Prisca"]
PRENOMS_M = ["Yao", "Koffi", "Moussa", "Serge", "Ibrahim", "Jean-Marc", "Abdoulaye", "Cédric", "Séka", "Mamadou", "Ange", "Franck"]
STAFF = [("directeur", "directeur", "Mme Directrice Test"), ("fondateur", "fondateur", "M. Fondateur Test"), ("secretariat", "admin", "Mme Secrétaire Test"),
         ("comptable", "comptable", "M. Comptable Test"), ("educateur", "educateur", "M. Éducateur Test"),
         ("informatique", "informatique", "M. Informatique Test")]
TEACHERS = [("prof.maths", "Mme Konan Aya", ["ma"]), ("prof.francais", "M. Bamba Issouf", ["fr", "ph"]),
            ("prof.anglais", "Mme Adjoua Rose", ["an", "lv2"]), ("prof.sciences", "M. Zadi Paul", ["sv", "pc", "hg"])]
CLASSES = ["6e A", "6e B", "3e A", "2nde A"]


class Command(BaseCommand):
    help = ("Remplit une école de données de recette réalistes (environ 80 élèves, 4 enseignants, notes, absences, paiements) "
            "et écrit la liste des comptes dans un fichier CSV. À réserver à un serveur de test : jamais sur l'école réelle.")

    def add_arguments(self, p):
        add_ecole_option(p)
        p.add_argument("--password", required=True, help="Mot de passe commun de tous les comptes de test (8 caractères au moins)")
        p.add_argument("--sortie", default="recette-comptes.csv", help="Fichier CSV des comptes créés")
        p.add_argument("--confirme-test", action="store_true", help="Confirme qu'il s'agit d'un serveur de test")

    def handle(self, *a, password, sortie, confirme_test, **o):
        if not confirme_test:
            raise CommandError("Ajoutez --confirme-test : cette commande crée de fausses données et un mot de passe commun.")
        if len(password) < 8:
            raise CommandError("Mot de passe trop court (8 caractères au moins).")
        with in_school(o.get("ecole", "")) as etab:
            if Student.objects.exists():
                raise CommandError("Cette école contient déjà des élèves : la recette ne se charge que dans une école vide.")
            from django.core.management import call_command
            call_command("seed_school", verbosity=0)
            with transaction.atomic():
                rows = self._load(password)
        with open(sortie, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(["ecole", "profil", "nom", "identifiant", "mot_de_passe"])
            for r in rows:
                w.writerow([etab.code, *r, password])
        self.stdout.write(self.style.SUCCESS(f"Recette chargée dans « {etab.nom} ». {len(rows)} comptes listés dans {sortie} (mot de passe commun)."))

    def _load(self, password):
        rng = random.Random(2026)
        out = []

        def account(username, role, name):
            u = User.objects.filter(username=username).first() or User(username=username)  # la direction créée par init_school est reprise
            u.role, u.full_name, u.must_change_password = role, name, False
            if role in STAFF_ROLES:
                u.email = f"{username}@recette.test"  # adresses fictives : aucun envoi réel
            u.set_password(password)
            u.save()
            out.append((ROLE_LABELS[role], name, username))
            return u

        for username, role, name in STAFF:
            account(username, role, name)
        subj = {s.code: s for s in Subject.objects.all()}
        classes = {c.name: c for c in SchoolClass.objects.filter(name__in=CLASSES)}
        teachers = []
        for username, name, codes in TEACHERS:
            u = account(username, "enseignant", name)
            t = Teacher.objects.get(user=u)
            t.subjects.set([subj[c] for c in codes if c in subj])
            teachers.append((t, codes))
        # Affectations : chaque enseignant dans toutes les classes de test pour ses matières
        for t, codes in teachers:
            for c in classes.values():
                for code in codes:
                    if code in subj and not TeachingAssignment.objects.filter(school_class=c, subject=subj[code]).exists():
                        TeachingAssignment.objects.create(teacher=t, subject=subj[code], school_class=c)

        students = []
        phone = 700000000
        n = 0
        for cname, count in (("6e A", 22), ("6e B", 20), ("3e A", 20), ("2nde A", 18)):
            for i in range(count):
                n += 1
                nom = rng.choice(NOMS)
                sexe = rng.choice("MF")
                prenom = rng.choice(PRENOMS_F if sexe == "F" else PRENOMS_M)
                year = {"6e A": 2014, "6e B": 2014, "3e A": 2011, "2nde A": 2010}[cname]
                sibling = students and i % 9 == 8  # quelques fratries : même parent que l'élève précédent
                if sibling:
                    parent_name, parent_phone = students[-1].parent.user.full_name, students[-1].parent.phone_digits
                else:
                    phone += 1
                    parent_name, parent_phone = f"Famille {nom} {n}", f"0{phone}"[:10]
                try:
                    e = enroll_student(nom=nom, prenoms=prenom, sexe=sexe, naissance=datetime.date(year, rng.randint(1, 12), rng.randint(1, 28)),
                                       lieu="Abidjan", school_class=classes[cname], parent_name=parent_name, parent_phone=parent_phone)
                except Exception:
                    continue  # doublon improbable (même nom, prénom et naissance) : on passe
                st = e.student
                for u in {st.user, st.parent.user}:
                    u.set_password(password)
                    u.must_change_password = False
                    u.save()
                out.append(("Élève", st.full_name, st.user.username))
                if not sibling:
                    out.append(("Parent", parent_name, st.parent.user.username))
                students.append(st)

        # Notes du 1er trimestre : tout est publié sauf les compositions de la 2nde A (pour tester le circuit de publication)
        term = Term.objects.filter(code="T1", year__current=True).first()
        today = datetime.date.today()
        for t, codes in teachers:
            for c in classes.values():
                for code in codes:
                    if code not in subj:
                        continue
                    for typ, title, days in (("devoir", "Devoir 1", 40), ("composition", "Composition 1", 12)):
                        ev = Evaluation.objects.create(school_class=c, subject=subj[code], term=term, type=typ, title=title,
                                                       date=today - datetime.timedelta(days=days), published=not (c.name == "2nde A" and typ == "composition"), teacher=t)
                        for st in Student.objects.filter(school_class=c):
                            base = rng.gauss(11.5, 3.2)
                            Grade.objects.create(evaluation=ev, student=st, value=Decimal(str(round(min(20, max(0, base)), 2))))
        # Absences et un incident à valider
        slots = [s for s, _ in Absence._meta.get_field("slot").choices]
        for st in rng.sample(students, 14):
            d = today - datetime.timedelta(days=rng.randint(1, 20))
            AppelSession.objects.get_or_create(school_class=st.school_class, date=d, slot=slots[0])
            Absence.objects.create(student=st, school_class=st.school_class, date=d, slot=slots[0], status=rng.choice("AAR"),
                                   justif=rng.choice(["aucune", "aucune", "en_attente", "acceptee"]))
        Incident.objects.create(student=students[3], date=today - datetime.timedelta(days=3), type=Incident._meta.get_field("type").choices[0][0],
                                gravite="moyenne", sanction="avertissement", description="Bavardages répétés pendant le cours (donnée de test).", status="a_valider",
                                by=User.objects.get(username="educateur"))
        # Paiements : 1/3 soldé, 1/3 partiel, 1/3 rien ; modes variés
        modes = ["especes", "orange", "mtn", "wave", "moov"]
        for i, st in enumerate(students):
            if i % 3 == 2:
                continue
            due = balance_of(st)
            amount = due if i % 3 == 0 else (due // 3 // 1000) * 1000
            if amount <= 0:
                continue
            mode = modes[i % len(modes)]
            record_payment(student=st, amount=amount, mode=mode, date=today - datetime.timedelta(days=rng.randint(2, 30)),
                           ref="" if mode == "especes" else f"TEST{i:05d}", note="Paiement de test")
        return out
