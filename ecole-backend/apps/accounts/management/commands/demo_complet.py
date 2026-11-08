"""Données de présentation : une école bien remplie, reliée aux comptes de démonstration (mot de passe : demo)."""
import datetime
import os
import tempfile

from django.core.management import call_command
from django.db import transaction

from apps.academics.models import SchoolClass, Subject, Teacher, TeachingAssignment, Term
from apps.accounts.models import User
from apps.communication.models import Announcement, Message, Participant, Thread
from apps.grades.models import Appreciation, CouncilComment, Evaluation
from apps.homework.models import Assignment, Question, Resource, Submission
from apps.mockexams.models import MockMark, MockSession
from apps.schedule.models import Cell, TextEntry
from apps.students.models import Student

APPRECIATIONS = ["Bon travail, continuez ainsi.", "Des progrès nets ce trimestre.", "Peut mieux faire : plus de rigueur attendue.",
                 "Élève sérieux et participatif.", "Résultats fragiles, un effort de régularité est nécessaire.", "Très bon trimestre, félicitations."]
CONSEILS = ["Félicitations du conseil de classe.", "Encouragements du conseil de classe.", "Avertissement de travail.", "Tableau d'honneur."]


def load_complet(demo, out):
    tmp = os.path.join(tempfile.mkdtemp(), "comptes.csv")
    call_command("seed_recette", password="demo-recette-1", sortie=tmp, confirme_test=True, verbosity=0)
    with transaction.atomic():
        _link_demo_accounts(demo)
        _extras()
    out.write("Données de présentation chargées : élèves, notes, absences, paiements, emploi du temps, cahier de textes, devoirs, messages, examen blanc.")


def _link_demo_accounts(demo):
    # Noms des comptes de démonstration (la recette avait donné d'autres noms aux profils de direction)
    for username, _role, name in demo:
        u = User.objects.filter(username=username).first()
        if u and u.role not in ("parent", "eleve"):
            u.full_name = name
            u.set_password("demo")
            u.must_change_password = False
            u.save()
    # Mot de passe commun « demo » pour tous les comptes de la démonstration
    for u in User.objects.exclude(is_superuser=True):
        u.set_password("demo")
        u.must_change_password = False
        u.save()
    # Le compte « enseignant » (Mme Konan Aya) reprend les classes et évaluations de l'enseignant de maths de la recette
    ens = User.objects.get(username="enseignant")
    t_new, t_old = Teacher.objects.get(user=ens), Teacher.objects.get(user__username="prof.maths")
    t_new.subjects.set(t_old.subjects.all())
    TeachingAssignment.objects.filter(teacher=t_old).update(teacher=t_new)
    Evaluation.objects.filter(teacher=t_old).update(teacher=t_new)
    t_old.user.delete()
    # « parent » et « eleve » deviennent la famille Brou : un élève de 3e A et son parent
    st = Student.objects.filter(school_class__name="3e A").order_by("id").first()
    st.nom, st.prenoms = "BROU", "Marie-Ange"
    st.save()
    for old, new in (("parent", st.parent.user), ("eleve", st.user)):
        User.objects.filter(username=old).exclude(pk=new.pk).delete()
        new.username = old
        new.full_name = "M. Brou Kouadio" if old == "parent" else "Brou Marie-Ange"
        new.save()
    # Un cadet dans la même famille (6e A) : le parent voit ses deux enfants
    cadet = Student.objects.filter(school_class__name="6e A").exclude(parent=st.parent).order_by("id").first()
    if cadet:
        cadet.parent, cadet.nom = st.parent, "BROU"
        cadet.save()


def _extras():
    today = datetime.date.today()
    subj = {s.code: s for s in Subject.objects.all()}
    classes = list(SchoolClass.objects.filter(name__in=["6e A", "6e B", "3e A", "2nde A"]))
    teachers = {ta.subject_id: ta.teacher for ta in TeachingAssignment.objects.all()}
    term = Term.objects.filter(code="T1", year__current=True).first()
    directeur, educ = User.objects.get(username="directeur"), User.objects.get(username="educateur")

    # Emploi du temps : 5 jours, 4 créneaux, matières enseignées en rotation
    codes = [c for c in ("ma", "fr", "an", "sv", "pc", "hg", "ph", "lv2") if c in subj]
    for ci, c in enumerate(classes):
        for day in range(5):
            for slot in range(4):
                code = codes[(ci + day * 2 + slot) % len(codes)]
                Cell.objects.get_or_create(school_class=c, day=day, slot=slot, defaults={"subject": subj[code], "room": f"Salle {10 + ci}"})
    # Cahier de textes (une semaine)
    for c in classes:
        for i, code in enumerate(codes[:4]):
            TextEntry.objects.get_or_create(school_class=c, subject=subj[code], date=today - datetime.timedelta(days=i + 1), defaults={
                "teacher": teachers.get(subj[code].id), "content": f"Cours de {subj[code].name} : chapitre en cours, exercices corrigés en classe.",
                "homework": "Reprendre la leçon et faire les exercices 3 à 6.", "due": today + datetime.timedelta(days=3)})
    # Appréciations et conseil de classe
    for k, st in enumerate(Student.objects.filter(school_class__in=classes)):
        for code in ("ma", "fr"):
            if code in subj:
                Appreciation.objects.get_or_create(student=st, term=term, subject=subj[code], defaults={"text": APPRECIATIONS[(k + len(code)) % len(APPRECIATIONS)]})
        CouncilComment.objects.get_or_create(student=st, term=term, defaults={"text": CONSEILS[k % len(CONSEILS)]})
    # Devoirs : un devoir en fichier et une épreuve en ligne pour la 3e A (avec une copie rendue)
    c3 = next(c for c in classes if c.name == "3e A")
    ma = subj["ma"]
    now = datetime.datetime.now(datetime.timezone.utc)
    fich = Assignment.objects.create(school_class=c3, subject=ma, teacher=teachers.get(ma.id), kind="fichier", title="Exercices sur le théorème de Thalès",
                                     instructions="Rendre la copie scannée ou photographiée avant la date limite.", due_at=now + datetime.timedelta(days=4), published=True)
    ep = Assignment.objects.create(school_class=c3, subject=ma, teacher=teachers.get(ma.id), kind="epreuve", title="Quiz : calcul littéral",
                                   instructions="Dix minutes, une seule tentative.", due_at=now + datetime.timedelta(days=6), duration_min=10, published=True, correction="fin")
    for i, (txt, ch, ok, kind) in enumerate([("Développer (x+2)²", ["x²+4", "x²+4x+4", "x²+2x+4"], [1], "qcm"),
                                              ("(a+b)² est égal à a²+b²", ["Vrai", "Faux"], [1], "vf"),
                                              ("Factoriser x²−9", ["(x−3)(x+3)", "(x−9)²", "(x+3)²"], [0], "qcm")]):
        Question.objects.create(assignment=ep, position=i, kind=kind, text=txt, choices=ch, correct=ok, points=2)
    for st in list(Student.objects.filter(school_class=c3))[:6]:
        Submission.objects.get_or_create(assignment=fich, student=st, defaults={"comment": "Devoir rendu.", "submitted_at": now - datetime.timedelta(hours=5)})
    Resource.objects.create(school_class=c3, subject=ma, teacher=teachers.get(ma.id), kind="support", title="Fiche de cours : Thalès",
                            description="Rappels de cours et exemples résolus.", links=[{"url": "https://fr.wikipedia.org/wiki/Th%C3%A9or%C3%A8me_de_Thal%C3%A8s", "label": "Pour aller plus loin"}])
    # Annonces et messagerie
    Announcement.objects.create(title="Réunion parents-professeurs", body="La réunion aura lieu samedi à 9 h dans la cour centrale. Votre présence est vivement souhaitée.",
                                audience=["parent", "eleve", "enseignant"], author=directeur)
    Announcement.objects.create(title="Composition du 2e trimestre", body="Les compositions débuteront dans trois semaines. Le calendrier détaillé sera affiché en salle des professeurs.",
                                audience=["enseignant", "educateur", "parent", "eleve"], author=directeur)
    parent, ens = User.objects.get(username="parent"), User.objects.get(username="enseignant")
    th = Thread.objects.create(subject="Suivi de Marie-Ange en mathématiques", creator=parent)
    for u in (parent, ens):
        Participant.objects.create(thread=th, user=u)
    Message.objects.create(thread=th, sender=parent, text="Bonjour, comment Marie-Ange se comporte-t-elle en mathématiques ce trimestre ?")
    Message.objects.create(thread=th, sender=ens, text="Bonjour Monsieur. De bons progrès, surtout en calcul littéral. Un peu plus de rigueur dans la rédaction serait idéal.")
    # Examen blanc publié pour la 3e A
    from apps.mockexams.models import ExamType
    ms = MockSession.objects.create(name="BEPC blanc", type="BEPC", exam_type=ExamType.objects.filter(name="BEPC").first(), start=today - datetime.timedelta(days=15), end=today - datetime.timedelta(days=12), published=True)
    ms.classes.set([c3])
    for k, st in enumerate(Student.objects.filter(school_class=c3)):
        for code in ("ma", "fr", "an"):
            if code in subj:
                MockMark.objects.get_or_create(session=ms, student=st, subject=subj[code], defaults={"value": 6 + (k * 3 + len(code) * 2) % 13})
    _ = educ
