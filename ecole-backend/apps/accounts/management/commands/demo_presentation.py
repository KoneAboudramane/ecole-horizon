"""Instance de démonstration : deux écoles fictives (système malien et système ivoirien), avec deux années passées
(archives, anciens bulletins) et l'année en cours, reliées par de vrais passages d'année.

Réservé à une installation dédiée à la démonstration (DEMO_INSTANCE=True dans le .env) : tous les comptes ont le
mot de passe « demo ». Avec --reinitialiser, la base entière est vidée puis recréée (remise à zéro de chaque nuit).

    python manage.py demo_presentation --reinitialiser
"""
import datetime
import random
from collections import defaultdict
from decimal import Decimal

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count
from django.test.utils import override_settings
from django.utils import timezone

from apps.academics.models import (Coefficient, Level, SchoolClass, SchoolSettings, SchoolYear, Serie, Subject, Teacher,
                                   TeachingAssignment, Term, ensure_default_cursus, groupe_for)
from apps.accounts.models import User
from apps.core.models import Etablissement
from apps.core.tenancy import tenant_context

MOT_DE_PASSE = "demo"
PREFIXE_CODE = "demo-"
PAR_CLASSE = 12          # élèves par classe au départ

# ------------------------------------------------------------------ les deux écoles

MALI = {
    "code": "demo-mali", "nom": "Groupe Scolaire Horizon de Bamako", "prefixe": "BKO", "ville": "Bamako", "hue": 28,
    "adresse": "Hamdallaye ACI 2000, Bamako", "tel": "+223 20 29 00 00",
    "pays": "République du Mali", "devise": "Un Peuple – Un But – Une Foi", "rentree": (10, 1),
    "niveaux": [("7e", "college", False), ("8e", "college", False), ("9e", "college", False),
                ("10e", "lycee", False), ("11e", "lycee", True), ("12e", "lycee", True)],
    "series": {"11e": [("S", "Sciences"), ("SES", "Sciences économiques et sociales"), ("L", "Lettres")],
               "12e": [("SE", "Sciences exactes"), ("SEXP", "Sciences expérimentales"), ("SECO", "Sciences économiques"), ("LL", "Langues et lettres")]},
    "classes": ["7e A", "8e A", "9e A", "10e A", "11e S", "11e SES", "11e L", "12e SE", "12e SEXP", "12e SECO", "12e LL"],
    "entree": ["7e A"],
    # 10e commune → séries de 11e → séries de 12e (choix de la direction au passage)
    "passages": {"10e A": ["11e S", "11e SES", "11e L"], "11e S": ["12e SE", "12e SEXP"], "11e SES": ["12e SECO"], "11e L": ["12e LL"]},
    "matieres": [("fr", "Français", "Fran."), ("ma", "Mathématiques", "Maths"), ("an", "Anglais", "Angl."), ("hg", "Histoire-Géographie", "HG"),
                 ("bio", "Biologie", "Bio."), ("pc", "Physique-Chimie", "PC"), ("ecm", "Éducation civique et morale", "ECM"),
                 ("eps", "EPS", "EPS"), ("ph", "Philosophie", "Philo"), ("eco", "Économie", "Éco."), ("ar", "Arabe", "Arabe")],
    "coefs": {"7e": dict(fr=4, ma=4, an=2, hg=2, bio=2, pc=2, ecm=1, eps=1), "8e": dict(fr=4, ma=4, an=2, hg=2, bio=2, pc=2, ecm=1, eps=1),
              "9e": dict(fr=4, ma=4, an=2, hg=2, bio=2, pc=2, ecm=1, eps=1), "10e": dict(fr=3, ma=3, an=2, hg=2, bio=2, pc=2, ecm=1, eps=1),
              "11e S": dict(ma=4, pc=4, bio=3, fr=2, an=2, hg=1, ph=1, eps=1), "11e SES": dict(eco=4, ma=3, hg=3, fr=2, an=2, ph=2, eps=1),
              "11e L": dict(fr=4, ph=3, hg=3, an=3, ar=2, ma=1, eps=1), "12e SE": dict(ma=5, pc=4, bio=2, ph=2, fr=2, an=2, eps=1),
              "12e SEXP": dict(bio=5, pc=4, ma=3, ph=2, fr=2, an=2, eps=1), "12e SECO": dict(eco=5, ma=3, hg=3, ph=2, fr=2, an=2, eps=1),
              "12e LL": dict(fr=5, ph=4, hg=3, an=3, ar=2, eps=1)},
    "examens": [("DEF", ["9e"], False, {"*": {"fr": 3, "ma": 3, "an": 2, "hg": 2, "bio": 2, "pc": 2, "ecm": 1}}),
                ("BAC", ["12e"], True, {"SE": {"ma": 5, "pc": 4, "bio": 2, "ph": 2, "fr": 2, "an": 2}, "SEXP": {"bio": 5, "pc": 4, "ma": 3, "ph": 2, "fr": 2, "an": 2},
                                        "SECO": {"eco": 5, "ma": 3, "hg": 3, "ph": 2, "fr": 2, "an": 2}, "LL": {"fr": 5, "ph": 4, "hg": 3, "an": 3, "ar": 2}})],
    "examen_blanc": ("DEF blanc", "DEF", "9e A"),
    "tarifs": [("7e", 25000, 150000), ("8e", 25000, 150000), ("9e", 25000, 160000), ("10e", 30000, 175000), ("11e", 30000, 185000), ("12e", 30000, 200000)],
    "personnel": [("fondateur", "fondateur", "M. Traoré Mamadou"), ("directeur", "directeur", "M. Keïta Boubacar"),
                  ("secretariat", "admin", "Mme Diarra Aminata"), ("comptable", "comptable", "M. Coulibaly Seydou"),
                  ("educateur", "educateur", "M. Sangaré Adama"), ("informatique", "informatique", "M. Maïga Ousmane")],
    "enseignants": [("enseignant", "Mme Konaté Fatoumata", ["ma"]), ("prof.francais", "M. Dembélé Lassana", ["fr", "ph"]),
                    ("prof.anglais", "Mme Cissé Oumou", ["an", "ar"]), ("prof.sciences", "M. Sidibé Modibo", ["bio", "pc"]),
                    ("prof.histoire", "M. Touré Bakary", ["hg", "ecm", "eco"]), ("prof.eps", "M. Diallo Sidiki", ["eps"])],
    "noms": ["TRAORE", "KEITA", "COULIBALY", "DIARRA", "KONATE", "SANGARE", "DEMBELE", "CISSE", "TOURE", "MAIGA", "SIDIBE",
             "DIALLO", "KANTE", "SANOGO", "DOUMBIA", "BERTHE", "BAGAYOKO", "SISSOKO", "FOFANA", "KONE", "SAMAKE", "GUINDO"],
    "prenoms_f": ["Aminata", "Fatoumata", "Mariam", "Kadiatou", "Oumou", "Assitan", "Djeneba", "Awa", "Rokia", "Hawa", "Bintou", "Salimata"],
    "prenoms_m": ["Moussa", "Boubacar", "Mamadou", "Seydou", "Ibrahim", "Oumar", "Bakary", "Souleymane", "Adama", "Modibo", "Sidiki", "Lassana"],
    "tel_parent": lambda n: f"7{n:07d}",
    "famille": ("M. TRAORE Bakary", "TRAORE", "Aminata", "Moussa"),
}

COTE_IVOIRE = {
    "code": "demo-ci", "nom": "Collège-Lycée Horizon d'Abidjan", "prefixe": "ABJ", "ville": "Abidjan", "hue": 155,
    "adresse": "Cocody Riviera 3, Abidjan", "tel": "+225 27 22 00 00 00",
    "pays": "République de Côte d’Ivoire", "devise": "Union – Discipline – Travail", "rentree": (9, 7),
    "niveaux": [("6e", "college", False), ("5e", "college", False), ("4e", "college", False), ("3e", "college", False),
                ("2nde", "lycee", True), ("1ère", "lycee", True), ("Tle", "lycee", True)],
    "series": {"2nde": [("A", ""), ("C", "")], "1ère": [("A", ""), ("C", ""), ("D", "")], "Tle": [("A", ""), ("C", ""), ("D", "")]},
    "classes": ["6e A", "6e B", "5e A", "4e A", "3e A", "2nde A", "2nde C", "1ère A", "1ère C", "1ère D", "Tle A", "Tle C", "Tle D"],
    "entree": ["6e A", "6e B"],
    "passages": {"3e A": ["2nde A", "2nde C"], "2nde C": ["1ère C", "1ère D"]},
    "matieres": [("fr", "Français", "Fran."), ("ma", "Mathématiques", "Maths"), ("an", "Anglais", "Angl."), ("hg", "Histoire-Géographie", "HG"),
                 ("sv", "SVT", "SVT"), ("pc", "Physique-Chimie", "PC"), ("eps", "EPS", "EPS"), ("edhc", "EDHC", "EDHC"),
                 ("ph", "Philosophie", "Philo"), ("lv2", "Espagnol (LV2)", "LV2")],
    "coefs": {"6e": dict(fr=4, ma=4, an=2, hg=2, sv=2, pc=2, eps=1, edhc=1), "5e": dict(fr=4, ma=4, an=2, hg=2, sv=2, pc=2, eps=1, edhc=1),
              "4e": dict(fr=4, ma=4, an=3, hg=2, sv=2, pc=2, eps=1, edhc=1), "3e": dict(fr=4, ma=4, an=3, hg=2, sv=2, pc=2, eps=1, edhc=1),
              "2nde A": dict(fr=4, an=3, hg=3, ma=2, pc=2, sv=2, lv2=2, eps=1), "2nde C": dict(ma=5, pc=4, sv=2, fr=3, an=2, hg=2, lv2=1, eps=1),
              "1ère A": dict(fr=4, ph=4, hg=3, an=3, lv2=2, ma=2, sv=1, eps=1), "1ère C": dict(ma=5, pc=4, sv=2, fr=2, ph=2, an=2, hg=2, eps=1),
              "1ère D": dict(ma=4, pc=4, sv=4, fr=2, ph=2, an=2, hg=2, eps=1), "Tle A": dict(ph=5, fr=4, hg=3, an=3, lv2=2, ma=2, eps=1),
              "Tle C": dict(ma=5, pc=4, sv=2, ph=2, fr=2, an=2, hg=2, eps=1), "Tle D": dict(ma=4, pc=4, sv=4, ph=2, fr=2, an=2, hg=2, eps=1)},
    "examens": None,     # BEPC et BAC créés par défaut (système ivoirien)
    "examen_blanc": ("BEPC blanc", "BEPC", "3e A"),
    "tarifs": [("6e", 50000, 180000), ("5e", 50000, 180000), ("4e", 50000, 195000), ("3e", 50000, 195000),
               ("2nde", 60000, 240000), ("1ère", 60000, 255000), ("Tle", 60000, 270000)],
    "personnel": [("fondateur", "fondateur", "M. Ouattara Lanciné"), ("directeur", "directeur", "Mme Diarrassouba Fatoumata"),
                  ("secretariat", "admin", "Mme Bakayoko Mariam"), ("comptable", "comptable", "M. Soro Ibrahim"),
                  ("educateur", "educateur", "M. Yapo Serge"), ("informatique", "informatique", "M. Tano Désiré")],
    "enseignants": [("enseignant", "Mme Konan Aya", ["ma"]), ("prof.francais", "M. Bamba Issouf", ["fr", "ph"]),
                    ("prof.anglais", "Mme Adjoua Rose", ["an", "lv2"]), ("prof.sciences", "M. Zadi Paul", ["sv", "pc"]),
                    ("prof.histoire", "M. Koffi Ange", ["hg", "edhc"]), ("prof.eps", "M. Dosso Franck", ["eps"])],
    "noms": ["KOUASSI", "KONE", "TRAORE", "COULIBALY", "YAO", "N'GUESSAN", "DIALLO", "OUATTARA", "BAMBA", "KOFFI", "SORO", "TOURE",
             "KONAN", "ASSI", "DOSSO", "FOFANA", "GNAGNE", "ZADI", "AKA", "BAH", "CISSE", "DJE", "EKRA"],
    "prenoms_f": ["Awa", "Fanta", "Aïcha", "Edwige", "Nadège", "Mariam", "Christelle", "Salimata", "Affoué", "Kadidja", "Prisca", "Adjoua"],
    "prenoms_m": ["Yao", "Koffi", "Moussa", "Serge", "Ibrahim", "Jean-Marc", "Abdoulaye", "Cédric", "Séka", "Mamadou", "Ange", "Franck"],
    "tel_parent": lambda n: f"07{n:08d}",
    "famille": ("M. BROU Kouadio", "BROU", "Marie-Ange", "Kouamé"),
}

ECOLES = [MALI, COTE_IVOIRE]

APPRECIATIONS = ["Bon travail, continuez ainsi.", "Des progrès nets ce trimestre.", "Peut mieux faire : plus de rigueur attendue.",
                 "Élève sérieux et participatif.", "Résultats fragiles, un effort de régularité est nécessaire.", "Très bon trimestre, félicitations."]
CONSEILS = ["Félicitations du conseil de classe.", "Encouragements du conseil de classe.", "Tableau d'honneur.",
            "Travail satisfaisant.", "Avertissement de travail.", "Doit se ressaisir."]


def annee_courante(today: datetime.date) -> int:
    """Première année civile de l'année scolaire en cours (rentrée en septembre ou octobre)."""
    return today.year if today.month >= 8 else today.year - 1


class Command(BaseCommand):
    help = "Crée les deux écoles de démonstration (Mali et Côte d'Ivoire) sur trois années. Installation de démonstration uniquement."

    def add_arguments(self, p):
        p.add_argument("--reinitialiser", action="store_true", help="Vide entièrement la base de démonstration puis la recrée.")

    def handle(self, *a, reinitialiser=False, **o):
        if not getattr(settings, "DEMO_INSTANCE", False):
            raise CommandError("Réservé à une installation de démonstration : ajoutez DEMO_INSTANCE=True dans son .env "
                               "(jamais sur la plateforme réelle : tous les mots de passe seraient « demo »).")
        autres = Etablissement.objects.exclude(code__startswith=PREFIXE_CODE)
        reelles = [e.code for e in autres if User.all_objects.filter(etablissement=e).exists()]
        if reelles:
            raise CommandError(f"Cette base contient des écoles avec des comptes ({', '.join(reelles[:3])}) : "
                               "la démonstration ne s'installe que dans une base dédiée.")
        if reinitialiser:
            call_command("flush", interactive=False, verbosity=0)
        elif Etablissement.objects.filter(code__startswith=PREFIXE_CODE).exists():
            raise CommandError("La démonstration est déjà installée : utilisez --reinitialiser pour la recréer.")
        Etablissement.objects.exclude(code__startswith=PREFIXE_CODE).update(actif=False)    # école vide créée par les migrations
        debut = timezone.now()
        hash_demo = make_password(MOT_DE_PASSE)
        # Hachage rapide pendant la génération (des centaines de comptes) ; le vrai hachage de « demo » est posé à la fin
        with override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"]):
            for cfg in ECOLES:
                Ecole(cfg, self.stdout).creer()
        User.all_objects.filter(etablissement__code__startswith=PREFIXE_CODE).update(password=hash_demo, must_change_password=False)
        duree = (timezone.now() - debut).seconds
        self.stdout.write(self.style.SUCCESS(f"Démonstration prête en {duree // 60} min {duree % 60} s. Codes d'école : "
                                             f"{', '.join(c['code'] for c in ECOLES)} ; mot de passe de tous les comptes : {MOT_DE_PASSE}"))


class Ecole:
    def __init__(self, cfg, out):
        self.cfg, self.out = cfg, out
        self.rng = random.Random(f"{cfg['code']}-2026")
        self.today = timezone.localdate()
        self.niveau_eleve = {}       # élève -> niveau scolaire de base (ses notes tournent autour)
        self.tel = 100
        self.etab = None

    # ---------------------------------------------------------------- étapes

    def creer(self):
        c = self.cfg
        self.etab = Etablissement.objects.create(code=c["code"], nom=c["nom"], prefixe=c["prefixe"])
        with tenant_context(self.etab):
            debut = annee_courante(self.today)
            with transaction.atomic():
                self.structure()
                self.ouvrir_annee(f"{debut - 2}-{debut - 1}")
                self.inscrire_rentree(premiere=True)
            for i in range(3):
                with transaction.atomic():
                    if i:
                        self.passage()
                        self.inscrire_rentree(premiere=False)
                    self.remplir_annee(SchoolYear.get_current(), en_cours=(i == 2))
            with transaction.atomic():
                self.famille_demo()
                self.annee_en_cours()
        from apps.students.models import Student
        self.out.write(f"  {c['nom']} ({c['code']}) : {Student.objects.filter(etablissement=self.etab, active=True).count()} élèves en cours, 3 années.")

    def structure(self):
        c = self.cfg
        ensure_default_cursus()
        for i, (n, cy, s) in enumerate(c["niveaux"]):
            Level.objects.create(name=n, order=i, cycle=cy, has_series=s)
        for lv, series in c["series"].items():
            for code, nom in series:
                Serie.objects.create(level=lv, code=code, name=nom)
        from apps.mockexams.models import ExamType, ensure_exam_types
        if c["examens"]:
            for name, levels, per_serie, coefs in c["examens"]:
                ExamType.objects.create(name=name, levels=levels, per_serie=per_serie, coefs=coefs)
        else:
            ensure_exam_types()
        s = SchoolSettings.load()
        s.name, s.address, s.phone, s.hue = c["nom"], c["adresse"], c["tel"], c["hue"]
        s.email = f"contact@{c['code']}.demo"
        s.director = next(n for u, r, n in c["personnel"] if r == "directeur")
        s.entete_pays, s.entete_devise = c["pays"], c["devise"]
        s.devoirs_actifs = True
        s.save()
        self.matieres = {code: Subject.objects.create(code=code, name=n, short=sh) for code, n, sh in c["matieres"]}
        for groupe, table in c["coefs"].items():
            for code, v in table.items():
                Coefficient.objects.create(groupe=groupe, subject=self.matieres[code], value=v)
        cycles = {n: cy for n, cy, _ in c["niveaux"]}
        for name in c["classes"]:
            level, _, serie = name.partition(" ")
            serie = serie if Serie.objects.filter(level=level, code=serie).exists() else ""
            SchoolClass.objects.create(name=name, level=level, serie=serie, groupe=groupe_for(level, serie), cycle=cycles[level], max_students=40)
        from apps.finance.models import Tarif
        for lv, ins, sco in c["tarifs"]:
            Tarif.objects.create(level=lv, ins=ins, sco=sco)
        # Personnel et enseignants
        for username, role, name in c["personnel"]:
            self.compte(username, role, name)
        self.matieres_de = defaultdict(list)          # groupe -> matières (avec coefficient)
        self.heures = {}                              # (groupe, matière) -> heures par semaine (d'après le coefficient)
        for co in Coefficient.objects.select_related("subject"):
            self.matieres_de[co.groupe].append(co.subject)
            self.heures[(co.groupe, co.subject.code)] = max(1, min(5, co.value))
        # Un professeur par matière pour chaque groupe de 4 classes (dans l'ordre de la configuration) : un emploi du temps
        # sans conflit reste possible. Le premier groupe a les enseignants nommés (dont le compte « enseignant » en maths,
        # professeur de la classe de l'élève de démonstration : 9e A / 4e A).
        classes = [SchoolClass.objects.get(name=n) for n in c["classes"]]
        self.prof = {}                                # (classe, matière) -> enseignant
        rng = random.Random(f"{c['code']}-profs")
        for g in range(0, len(classes), 4):
            groupe = classes[g:g + 4]
            for username, name, codes in c["enseignants"]:
                if g == 0:
                    u = self.compte(username, "enseignant", name)
                else:
                    sexe = rng.choice("MF")
                    nom = f"{'M.' if sexe == 'M' else 'Mme'} {rng.choice(c['noms']).title()} {rng.choice(c['prenoms_m'] if sexe == 'M' else c['prenoms_f'])}"
                    base = username if username != "enseignant" else "prof.maths"
                    u = self.compte(f"{base}{g // 4 + 1}", "enseignant", nom)
                t = Teacher.objects.get(user=u)
                t.subjects.set([self.matieres[x] for x in codes])
                for cl in groupe:
                    for x in codes:
                        self.prof[(cl.pk, x)] = t
        for cl in classes:
            if not self.matieres_de[cl.groupe]:
                raise CommandError(f"{c['code']} : la classe {cl.name} (groupe « {cl.groupe} ») n'a aucune matière : vérifiez les coefficients.")
            for subj in self.matieres_de[cl.groupe]:
                TeachingAssignment.objects.create(school_class=cl, subject=subj, teacher=self.prof[(cl.pk, subj.code)])
            # Professeur principal : le professeur de français de la classe (celle de l'élève de démo : « enseignant »)
            cl.prof_principal = self.prof.get((cl.pk, "fr"))
            cl.save(update_fields=["prof_principal"])

    def compte(self, username, role, name):
        u = User(username=username, role=role, full_name=name, email=f"{username}@{self.cfg['code']}.demo", must_change_password=False)
        u.set_password(MOT_DE_PASSE)
        u.save()
        return u

    def ouvrir_annee(self, label):
        from apps.finance.models import FeeDate
        y0 = int(label[:4])
        m, d = self.cfg["rentree"]
        y = SchoolYear.objects.create(label=label, current=True)
        debut = datetime.date(y0, m, d)
        for code, lib, a, b, coef in [("T1", "1er trimestre", debut, datetime.date(y0, 12, 20), 1),
                                      ("T2", "2e trimestre", datetime.date(y0 + 1, 1, 6), datetime.date(y0 + 1, 3, 28), 2),
                                      ("T3", "3e trimestre", datetime.date(y0 + 1, 4, 7), datetime.date(y0 + 1, 6, 30), 2)]:
            Term.objects.create(year=y, code=code, label=lib, start=a, end=b, coef=coef)
        for k, dd in [("INS", debut), ("T1", debut + datetime.timedelta(days=23)), ("T2", datetime.date(y0 + 1, 1, 10)), ("T3", datetime.date(y0 + 1, 4, 10))]:
            FeeDate.objects.create(year=y, key=k, date=dd)

    def nouvel_eleve(self, cl, y0):
        from apps.students.services import enroll_student
        c, rng = self.cfg, self.rng
        idx = [n for n, _, _ in c["niveaux"]].index(cl.level)
        sexe = rng.choice("MF")
        nom = rng.choice(c["noms"])
        prenom = rng.choice(c["prenoms_f"] if sexe == "F" else c["prenoms_m"])
        self.tel += 1
        pere = rng.choice(c["prenoms_m"])
        for _ in range(5):
            try:
                e = enroll_student(nom=nom, prenoms=prenom, sexe=sexe, lieu=c["ville"], school_class=cl,
                                   naissance=datetime.date(y0 - 11 - idx, rng.randint(1, 12), rng.randint(1, 28)),
                                   parent_name=f"M. {nom} {pere}", parent_phone=c["tel_parent"](self.tel))
                break
            except Exception:
                prenom = f"{prenom} {rng.choice(c['prenoms_f'] if sexe == 'F' else c['prenoms_m'])}"
        else:
            return None
        self.niveau_eleve[e.student.pk] = min(17.5, max(6.5, rng.gauss(11.6, 2.4)))
        return e.student

    def inscrire_rentree(self, premiere):
        from apps.students.models import Student
        y0 = int(SchoolYear.get_current().label[:4])
        for cl in SchoolClass.objects.all():
            n = Student.objects.filter(school_class=cl, active=True).count()
            # entrée en 7e / 6e : classe complète ; ailleurs quelques nouveaux, et au moins 9 élèves par classe
            cible = PAR_CLASSE if premiere or cl.name in self.cfg["entree"] else max(9, min(PAR_CLASSE + 2, n + 2))
            for _ in range(max(0, cible - n)):
                self.nouvel_eleve(cl, y0)

    # ---------------------------------------------------------------- une année

    def note(self, st_id, ecart=2.6):
        base = self.niveau_eleve.get(st_id, 11)
        return Decimal(str(round(min(20, max(0, self.rng.gauss(base, ecart))) * 4) / 4))

    def remplir_annee(self, year, en_cours):
        from apps.attendance.models import Absence, AppelSession
        from apps.grades.models import Appreciation, CouncilComment, Evaluation, Grade
        from apps.students.models import Student
        rng, today = self.rng, self.today
        classes = list(SchoolClass.objects.all())
        eleves = {cl.pk: list(Student.objects.filter(school_class=cl, active=True)) for cl in classes}
        notes, apprec, conseils = [], [], []
        for term in year.terms.order_by("start"):
            if en_cours and term.start > today:
                continue
            for cl in classes:
                if not eleves[cl.pk]:
                    continue
                for subj in self.matieres_de[cl.groupe]:
                    for typ, titre, quand in (("devoir", "Devoir 1", term.start + datetime.timedelta(days=21)),
                                              ("devoir", "Devoir 2", term.start + datetime.timedelta(days=42)),
                                              ("composition", f"Composition du {term.label}", term.end - datetime.timedelta(days=12))):
                        if en_cours and quand > today:
                            continue
                        ev = Evaluation.objects.create(school_class=cl, subject=subj, term=term, type=typ, title=titre, date=quand,
                                                       published=True, teacher=self.prof.get((cl.pk, subj.code)))
                        notes += [Grade(etablissement=self.etab, evaluation=ev, student=st, value=self.note(st.pk)) for st in eleves[cl.pk]]
                if term.end < today:          # trimestre terminé : appréciations et avis du conseil
                    for k, st in enumerate(eleves[cl.pk]):
                        for code in ("ma", "fr"):
                            if code in self.matieres:
                                apprec.append(Appreciation(etablissement=self.etab, student=st, term=term, subject=self.matieres[code],
                                                           text=APPRECIATIONS[(st.pk + len(code)) % len(APPRECIATIONS)]))
                        moy = self.niveau_eleve.get(st.pk, 11)
                        conseils.append(CouncilComment(etablissement=self.etab, student=st, term=term,
                                                       text=CONSEILS[0 if moy >= 15 else 1 if moy >= 13 else 3 if moy >= 10.5 else 4 + k % 2]))
            if len(notes) > 3000:
                Grade.objects.bulk_create(notes, batch_size=1000)
                notes = []
        Grade.objects.bulk_create(notes, batch_size=1000)
        Appreciation.objects.bulk_create(apprec, batch_size=1000)
        CouncilComment.objects.bulk_create(conseils, batch_size=1000)
        # Absences
        slots = [s for s, _ in Absence._meta.get_field("slot").choices]
        tous = [st for lst in eleves.values() for st in lst]
        debut, fin = year.terms.order_by("start").first().start, min(year.terms.order_by("start").last().end, today - datetime.timedelta(days=1))
        for st in rng.sample(tous, min(len(tous), 25)):
            d = debut + datetime.timedelta(days=rng.randint(0, max(1, (fin - debut).days)))
            if d.weekday() >= 5:
                d -= datetime.timedelta(days=d.weekday() - 4)
            slot = rng.choice(slots)
            AppelSession.objects.get_or_create(school_class=st.school_class, date=d, slot=slot)
            Absence.objects.get_or_create(student=st, date=d, slot=slot, defaults={
                "school_class": st.school_class, "status": rng.choice("AAR"),
                "justif": rng.choice(["acceptee", "acceptee", "aucune"] if not en_cours else ["aucune", "en_attente", "acceptee"])})
        self.paiements(tous, year, en_cours)

    def paiements(self, eleves, year, en_cours):
        from apps.finance.services import balance_of, record_payment
        rng = self.rng
        modes = ["especes", "orange", "wave", "moov", "especes"] if self.cfg is MALI else ["especes", "orange", "mtn", "wave", "moov"]
        y0 = int(year.label[:4])
        m, d = self.cfg["rentree"]
        rentree = datetime.date(y0, m, d)
        fin = min(self.today, datetime.date(y0 + 1, 6, 30))
        for i, st in enumerate(eleves):
            due = balance_of(st)
            if due <= 0:
                continue
            r = rng.random()
            if en_cours:
                montant = due if r < 0.30 else (due // 2 // 1000) * 1000 if r < 0.75 else 0
            else:
                montant = due if r < 0.88 else (due * 2 // 3 // 1000) * 1000
            if montant <= 0:
                continue
            mode = modes[i % len(modes)]
            quand = rentree + datetime.timedelta(days=rng.randint(0, max(1, (fin - rentree).days)))
            record_payment(student=st, amount=montant, mode=mode, date=quand, silent=True, note="Paiement de démonstration",
                           ref="" if mode == "especes" else f"{self.cfg['prefixe']}{y0}{i:05d}")

    def passage(self):
        from apps.students import rollover
        plan = rollover.build_plan()
        classes = {c.name: c for c in SchoolClass.objects.all()}
        tour = defaultdict(int)
        moves = []
        for r in plan["rows"]:
            action, cible = r["action"], r["target"]
            if action is None:                  # pas de décision ni de proposition nette : d'après la moyenne annuelle
                moy = r["annual_avg"] or 10
                action = "promote" if moy >= 9.5 else "repeat"
            if action == "promote" and r["last_level"]:
                action = "graduate"
            if action == "repeat" and cible is None:
                cible = r["class"]
            elif action == "promote":
                choix = self.cfg["passages"].get(r["class_name"])
                if choix:
                    cible = classes[choix[tour[r["class_name"]] % len(choix)]].pk
                    tour[r["class_name"]] += 1
                elif cible is None:
                    pool = [c for c in classes.values() if c.level == r["next_level"]]
                    cible = pool[tour[r["next_level"]] % len(pool)].pk if pool else None
                    tour[r["next_level"]] += 1
            moves.append({"student": r["student"], "action": action, "class": cible})
        rollover.apply(moves=moves, to_label=None, user=User.objects.get(username="directeur"))

    # ---------------------------------------------------------------- comptes « parent » / « eleve » et vie de l'année en cours

    def famille_demo(self):
        from apps.students.models import Enrollment, Student
        c = self.cfg
        niveau = c["niveaux"][2][0]          # 9e / 4e : un élève présent depuis trois ans (archives à montrer)
        anciens = Enrollment.objects.values("student").order_by().annotate(n=Count("id")).filter(n__gte=3)
        ids = [e["student"] for e in anciens]
        st = (Student.objects.filter(pk__in=ids, active=True, school_class__level=niveau).order_by("id").first()
              or Student.objects.filter(active=True, school_class__level=niveau).order_by("id").first())
        nom_parent, nom, prenom, cadet_prenom = c["famille"]
        st.nom, st.prenoms = nom, prenom
        st.save(update_fields=["nom", "prenoms"])
        self.niveau_eleve[st.pk] = 13.5
        parent = st.parent
        for u, nouveau, full in ((st.user, "eleve", f"{nom} {prenom}"), (parent.user, "parent", nom_parent)):
            u.username, u.full_name = nouveau, full
            u.save(update_fields=["username", "full_name"])
        cadet = Student.objects.filter(active=True, school_class__name=c["entree"][0]).exclude(parent=parent).order_by("id").first()
        if cadet:
            cadet.parent, cadet.nom, cadet.prenoms = parent, nom, cadet_prenom
            cadet.save(update_fields=["parent", "nom", "prenoms"])
        self.eleve_demo, self.parent_demo = st, parent.user
        # Le compte « enseignant » est professeur principal de cette classe
        cl = st.school_class
        cl.prof_principal = Teacher.objects.get(user__username="enseignant")
        cl.save(update_fields=["prof_principal"])

    def emploi_du_temps(self, classes):
        """Emploi du temps de chaque classe, sans conflit : un enseignant n'est jamais dans deux classes au même créneau,
        chaque classe a sa salle, chaque matière a ses heures (d'après le coefficient), au plus deux heures par jour."""
        from apps.schedule.models import Cell
        ouverts = (SchoolSettings.load().horaires or {}).get("ouverts") or [8, 8, 5, 8, 8, 4, 0]
        creneaux = [(d, s) for s in range(max(ouverts)) for d in range(6) if s < ouverts[d]]   # matinées d'abord, réparties sur la semaine
        occupe = set()                          # (enseignant, jour, créneau)
        cells = []
        for k, x in enumerate(classes):
            reste = {s.code: self.heures[(x.groupe, s.code)] for s in self.matieres_de[x.groupe]}
            par_jour = defaultdict(int)
            subj = {s.code: s for s in self.matieres_de[x.groupe]}
            for d, s in creneaux:
                choix = [code for code, h in reste.items() if h > 0 and par_jour[(d, code)] < 2
                         and (self.prof[(x.pk, code)].pk, d, s) not in occupe]
                if not choix:
                    continue
                code = max(choix, key=lambda m: (reste[m], -par_jour[(d, m)]))
                reste[code] -= 1
                par_jour[(d, code)] += 1
                occupe.add((self.prof[(x.pk, code)].pk, d, s))
                cells.append(Cell(etablissement=self.etab, school_class=x, day=d, slot=s, subject=subj[code], room=f"Salle {k + 1}"))
        Cell.objects.bulk_create(cells, batch_size=500)

    def annee_en_cours(self):
        from apps.communication.models import Announcement, Message, Participant, Thread
        from apps.discipline.models import Incident
        from apps.homework.models import Assignment, Question, Resource, Submission
        from apps.mockexams.models import ExamType, MockMark, MockSession
        from apps.notifications.services import notify
        from apps.schedule.models import Cell, TextEntry
        from apps.students.models import Student
        c, today, rng = self.cfg, self.today, self.rng
        st = self.eleve_demo
        cl = st.school_class
        classes = [SchoolClass.objects.get(name=n) for n in c["classes"]]
        self.emploi_du_temps(classes)
        # Cahier de textes : les trois derniers jours de classe, pour chaque classe, d'après son emploi du temps
        jours, d = [], today - datetime.timedelta(days=1)
        while len(jours) < 3:
            if d.weekday() < 5:
                jours.append(d)
            d -= datetime.timedelta(days=1)
        entrees = []
        for x in classes:
            for jour in jours:
                vus = set()
                for cell in Cell.objects.filter(school_class=x, day=jour.weekday()).select_related("subject").order_by("slot"):
                    if cell.subject_id in vus:
                        continue
                    vus.add(cell.subject_id)
                    entrees.append(TextEntry(etablissement=self.etab, school_class=x, subject=cell.subject, teacher=self.prof.get((x.pk, cell.subject.code)),
                                             date=jour, content=f"{cell.subject.name} : leçon du chapitre en cours, exercices corrigés en classe.",
                                             homework="Revoir la leçon et faire les exercices du manuel.", due=today + datetime.timedelta(days=3)))
        TextEntry.objects.bulk_create(entrees, batch_size=500)
        now = timezone.now()
        # Un devoir à rendre par classe (français ou mathématiques, en alternance)
        for k, x in enumerate(classes):
            code = ("fr", "ma")[k % 2]
            if x.pk == cl.pk or code not in {s.code for s in self.matieres_de[x.groupe]}:
                continue
            Assignment.objects.create(school_class=x, subject=self.matieres[code], teacher=self.prof.get((x.pk, code)), kind="fichier",
                                      title="Rédaction : un souvenir marquant" if code == "fr" else "Série d'exercices n° 3",
                                      instructions="Rendre la copie photographiée avant la date limite.", due_at=now + datetime.timedelta(days=5), published=True)
        # Devoirs en ligne pour la classe de l'élève de démonstration
        ma = self.matieres["ma"]
        prof = self.prof[(cl.pk, "ma")]
        fich = Assignment.objects.create(school_class=cl, subject=ma, teacher=prof, kind="fichier", title="Exercices de géométrie",
                                         instructions="Rendre la copie photographiée avant la date limite.", due_at=now + datetime.timedelta(days=4), published=True)
        ep = Assignment.objects.create(school_class=cl, subject=ma, teacher=prof, kind="epreuve", title="Quiz : calcul littéral",
                                       instructions="Dix minutes, une seule tentative.", due_at=now + datetime.timedelta(days=6), duration_min=10, published=True, correction="fin")
        for i, (txt, ch, ok, kind) in enumerate([("Développer (x+2)²", ["x²+4", "x²+4x+4", "x²+2x+4"], [1], "qcm"),
                                                  ("(a+b)² est égal à a²+b²", ["Vrai", "Faux"], [1], "vf"),
                                                  ("Factoriser x²−9", ["(x−3)(x+3)", "(x−9)²", "(x+3)²"], [0], "qcm")]):
            Question.objects.create(assignment=ep, position=i, kind=kind, text=txt, choices=ch, correct=ok, points=2)
        for x in list(Student.objects.filter(school_class=cl, active=True).exclude(pk=st.pk))[:6]:
            Submission.objects.create(assignment=fich, student=x, comment="Devoir rendu.", submitted_at=now - datetime.timedelta(hours=5))
        Resource.objects.create(school_class=cl, subject=ma, teacher=prof, kind="support", title="Fiche de cours : géométrie",
                                description="Rappels de cours et exemples résolus.", links=[])
        # Annonces, messagerie, incident à valider
        directeur, educ = User.objects.get(username="directeur"), User.objects.get(username="educateur")
        Announcement.objects.create(title="Réunion parents-professeurs", author=directeur, audience=["parent", "eleve", "enseignant"],
                                    body="La réunion aura lieu samedi à 9 h dans la cour. Votre présence est vivement souhaitée.")
        Announcement.objects.create(title="Compositions du 1er trimestre", author=directeur, audience=["enseignant", "educateur", "parent", "eleve"],
                                    body="Les compositions débuteront dans trois semaines. Le calendrier est affiché en salle des professeurs.")
        ens = User.objects.get(username="enseignant")
        th = Thread.objects.create(subject=f"Suivi de {st.prenoms} en mathématiques", creator=self.parent_demo)
        for u in (self.parent_demo, ens):
            Participant.objects.create(thread=th, user=u)
        Message.objects.create(thread=th, sender=self.parent_demo, text=f"Bonjour, comment {st.prenoms} travaille-t-elle en mathématiques ce trimestre ?")
        Message.objects.create(thread=th, sender=ens, text="Bonjour. De bons progrès, surtout en calcul. Un peu plus de rigueur dans la rédaction serait idéal.")
        autre = Student.objects.filter(school_class=cl, active=True).exclude(pk=st.pk).order_by("id").first()
        if autre:
            Incident.objects.create(student=autre, date=today - datetime.timedelta(days=2), type="bavardage", gravite="legere", sanction="observation",
                                    description="Bavardages répétés pendant le cours.", status="a_valider", by=educ)
        # Examen blanc (DEF blanc / BEPC blanc) publié
        nom, type_, cname = c["examen_blanc"]
        cx = SchoolClass.objects.filter(name=cname).first()
        if cx:
            ms = MockSession.objects.create(name=nom, type=type_, exam_type=ExamType.objects.filter(name=type_).first(),
                                            start=today - datetime.timedelta(days=15), end=today - datetime.timedelta(days=12), published=True)
            ms.classes.set([cx])
            MockMark.objects.bulk_create([MockMark(etablissement=self.etab, session=ms, student=x, subject=self.matieres[code], value=self.note(x.pk))
                                          for x in Student.objects.filter(school_class=cx, active=True) for code in ("fr", "ma", "an") if code in self.matieres])
        # BAC blanc publié pour toutes les classes de terminale (12e / Tle), dans leurs matières principales
        terminales = [x for x in classes if x.level == c["niveaux"][-1][0]]
        if terminales:
            bac = MockSession.objects.create(name="BAC blanc", type="BAC", exam_type=ExamType.objects.filter(name="BAC").first(),
                                             start=today - datetime.timedelta(days=9), end=today - datetime.timedelta(days=5), published=True)
            bac.classes.set(terminales)
            marks = []
            for x in terminales:
                principales = sorted(self.matieres_de[x.groupe], key=lambda s: -self.heures[(x.groupe, s.code)])[:4]
                marks += [MockMark(etablissement=self.etab, session=bac, student=e, subject=s, value=self.note(e.pk))
                          for e in Student.objects.filter(school_class=x, active=True) for s in principales]
            MockMark.objects.bulk_create(marks, batch_size=500)
        # Une notification pour la famille de démonstration
        notify([self.parent_demo], f"Bienvenue dans l'espace parents de {c['nom']} (démonstration).")
        _ = rng
