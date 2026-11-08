"""Inscription d'un élève : toute la logique est ici (une seule transaction), partagée par l'API et l'import CSV."""
from dataclasses import dataclass

from django.conf import settings
from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.academics.models import SchoolClass, SchoolYear
from apps.accounts.models import User
from apps.accounts.passwords import temp_pin
from apps.core.tenancy import cursus_context

from .models import Enrollment, Parent, Sequence, Student
from .phones import digits, fmt_phone


@dataclass
class Enrolled:
    student: Student
    credentials: list[dict]  # [{role, name, username, password}] — remis une seule fois


def next_matricule(year: SchoolYear) -> str:
    from apps.core.models import Etablissement
    from apps.core.tenancy import current_or_default
    prefix = Etablissement.objects.filter(pk=current_or_default()).values_list("prefixe", flat=True).first() or getattr(settings, "MATRICULE_PREFIX", "HZ")
    key = f"matricule-{year.short}"
    with transaction.atomic():
        Sequence.objects.get_or_create(name=key)
        seq = Sequence.objects.select_for_update().get(name=key)
        seq.value += 1
        seq.save(update_fields=["value"])
    return f"{prefix}{year.short}-{seq.value:04d}"


def class_free_places(school_class: SchoolClass) -> int:
    return school_class.max_students - school_class.students.filter(active=True).count()


def get_or_create_parent(name: str, phone: str) -> tuple[Parent, dict | None]:
    """Un parent est identifié par son téléphone : plusieurs enfants → un seul compte (et la remise fratrie s'applique)."""
    d = digits(phone)
    parent = Parent.objects.select_related("user").filter(phone_digits=d).first()
    if parent:
        return parent, None
    if User.objects.filter(username=d).exists():
        raise ValidationError({"parent_phone": "Ce numéro est déjà utilisé comme identifiant d’un autre compte."})
    pwd = temp_pin()
    user = User(username=d, role="parent", full_name=name.strip(), phone=fmt_phone(d), must_change_password=True)
    user.set_password(pwd)
    user.save()
    parent = Parent.objects.create(user=user, phone_digits=d)
    return parent, {"role": "parent", "name": user.full_name, "username": d, "password": pwd}


@transaction.atomic
def enroll_student(*, nom, prenoms, sexe, naissance, lieu, school_class=None, parent_name, parent_phone, urgence="", level="") -> Enrolled:
    """Inscription dans une classe, ou « à répartir » à un niveau (sans classe : l'élève rejoint les élèves à placer)."""
    year = SchoolYear.get_current()
    if year is None:
        raise ValidationError("Aucune année scolaire n’est configurée.")
    if school_class is not None:
        school_class = SchoolClass.objects.select_for_update().get(pk=school_class.pk)
        if class_free_places(school_class) <= 0:
            raise ValidationError({"school_class": f"La classe {school_class.name} est complète ({school_class.max_students} places)."})
    elif not level:
        raise ValidationError({"school_class": "Choisissez la classe, ou le niveau pour un élève à répartir."})
    nom, prenoms = nom.strip().upper(), prenoms.strip()
    if Student.objects.filter(nom__iexact=nom, prenoms__iexact=prenoms, naissance=naissance).exists():
        raise ValidationError("Cet élève est déjà inscrit (même nom, prénoms et date de naissance).")
    with cursus_context(None):
        ailleurs = Student.objects.filter(nom__iexact=nom, prenoms__iexact=prenoms, naissance=naissance).select_related("cursus").first()
    if ailleurs:
        raise ValidationError(f"Cet élève est déjà inscrit dans le cursus « {ailleurs.cursus.nom if ailleurs.cursus_id else ''} » : ouvrez sa fiche et utilisez « Inscrire dans un autre cursus ».")
    parent, parent_cred = get_or_create_parent(parent_name, parent_phone)

    matricule = next_matricule(year)
    pwd = temp_pin()
    user = User(username=matricule.lower(), role="eleve", full_name=f"{nom} {prenoms}", must_change_password=True)
    user.set_password(pwd)
    user.save()
    student = Student.objects.create(
        user=user, matricule=matricule, nom=nom, prenoms=prenoms, sexe=sexe, naissance=naissance, lieu=lieu.strip(),
        school_class=school_class, parent=parent, urgence=urgence or parent.user.phone,
        active=school_class is not None, sortie="" if school_class is not None else "placer",
    )
    Enrollment.objects.create(student=student, year=year, school_class=school_class, level="" if school_class is not None else level)
    creds = [{"role": "eleve", "name": user.full_name, "username": user.username, "password": pwd}]
    if parent_cred:
        creds.append(parent_cred)
    return Enrolled(student, creds)


@transaction.atomic
def change_class(student: Student, new_class: SchoolClass) -> None:
    if new_class.pk == student.school_class_id:
        return
    new_class = SchoolClass.objects.select_for_update().get(pk=new_class.pk)
    if class_free_places(new_class) <= 0:
        raise ValidationError({"school_class": f"La classe {new_class.name} est complète ({new_class.max_students} places)."})
    year = SchoolYear.get_current()
    student.school_class = new_class
    fields = ["school_class"]
    if student.sortie == "placer":                 # élève à placer : lui donner une classe le place
        student.active, student.sortie = True, ""
        fields += ["active", "sortie"]
    student.save(update_fields=fields)
    Enrollment.objects.update_or_create(student=student, year=year, defaults={"school_class": new_class})
