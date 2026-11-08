from rest_framework import serializers

from apps.academics.models import SchoolClass

from .models import Student
from .phones import fmt_phone, phone_ok


class StudentSerializer(serializers.ModelSerializer):
    class_name = serializers.CharField(source="class_label", read_only=True)
    level = serializers.CharField(source="current_level", read_only=True)
    reinscription_state = serializers.CharField(read_only=True)
    parent_name = serializers.CharField(source="parent.user.full_name", read_only=True)
    parent_phone = serializers.CharField(source="parent.user.phone", read_only=True)
    parent_id = serializers.IntegerField(source="parent.id", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    user_id = serializers.IntegerField(read_only=True, allow_null=True)
    parent_user_id = serializers.IntegerField(source="parent.user_id", read_only=True)
    cursus_nom = serializers.CharField(source="cursus.nom", read_only=True, default="")

    class Meta:
        model = Student
        fields = ["id", "matricule", "username", "user_id", "parent_user_id", "nom", "prenoms", "sexe", "naissance", "lieu", "school_class", "class_name",
                  "parent_id", "parent_name", "parent_phone", "urgence", "active", "sortie", "solde_sortie", "niveaux_redoubles", "level", "reinscription_state",
                  "cursus", "cursus_nom", "principal"]
        read_only_fields = fields


class StudentDetailSerializer(StudentSerializer):
    """Fiche d'un élève : avec ses inscriptions dans les autres cursus de l'école."""

    inscriptions = serializers.SerializerMethodField()

    class Meta(StudentSerializer.Meta):
        fields = [*StudentSerializer.Meta.fields, "inscriptions"]
        read_only_fields = fields

    def get_inscriptions(self, obj) -> list[dict]:
        return [{"id": i.pk, "cursus": i.cursus_id, "cursus_nom": i.cursus.nom if i.cursus_id else "", "class_name": i.class_label, "active": i.active}
                for i in obj.inscriptions().exclude(pk=obj.pk)]


class EnrollSerializer(serializers.Serializer):
    nom = serializers.CharField(max_length=60)
    prenoms = serializers.CharField(max_length=80)
    sexe = serializers.ChoiceField(choices=["M", "F"])
    naissance = serializers.DateField()
    lieu = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    school_class = serializers.PrimaryKeyRelatedField(queryset=SchoolClass.objects, required=False, allow_null=True)
    # Sans classe : inscrit « à répartir » à ce niveau ; il rejoint les élèves à placer (Nouvelle année, étape 3)
    level = serializers.CharField(max_length=10, required=False)

    def validate_level(self, v):
        from apps.academics.models import level_names
        if v not in level_names():
            raise serializers.ValidationError("Niveau inconnu.")
        return v
    parent_name = serializers.CharField(max_length=150)
    parent_phone = serializers.CharField(max_length=30)
    urgence = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")

    def validate_parent_phone(self, v):
        if not phone_ok(v):
            raise serializers.ValidationError("Le téléphone doit comporter 10 chiffres.")
        return fmt_phone(v)

    def validate(self, attrs):
        if not attrs.get("school_class") and not attrs.get("level"):
            raise serializers.ValidationError({"school_class": "Choisissez la classe, ou le niveau pour un élève à répartir."})
        if attrs.get("school_class"):
            attrs.pop("level", None)
        return attrs


class StudentUpdateSerializer(serializers.Serializer):
    nom = serializers.CharField(max_length=60, required=False)
    prenoms = serializers.CharField(max_length=80, required=False)
    sexe = serializers.ChoiceField(choices=["M", "F"], required=False)
    naissance = serializers.DateField(required=False)
    lieu = serializers.CharField(max_length=80, required=False, allow_blank=True)
    urgence = serializers.CharField(max_length=40, required=False, allow_blank=True)
    school_class = serializers.PrimaryKeyRelatedField(queryset=SchoolClass.objects, required=False)
    parent_name = serializers.CharField(max_length=150, required=False)
    active = serializers.BooleanField(required=False)
    niveaux_redoubles = serializers.ListField(child=serializers.CharField(max_length=10), required=False)

    def validate_niveaux_redoubles(self, v):
        from apps.academics.models import level_names
        names = level_names()
        if set(v) - set(names):
            raise serializers.ValidationError("Niveau inconnu.")
        return sorted(set(v), key=names.index)


class ParentSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    user_id = serializers.IntegerField()
    name = serializers.CharField(source="user.full_name")
    phone = serializers.CharField(source="user.phone")
    student_ids = serializers.SerializerMethodField()

    def get_student_ids(self, obj) -> list[int]:
        return [s.id for s in obj.children.all()]
