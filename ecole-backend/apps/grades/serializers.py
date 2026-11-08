from decimal import Decimal

from rest_framework import serializers

from apps.academics.models import Subject, Term
from apps.students.models import Student

from .models import BAREME_MAX, DECISIONS, Evaluation


class CurrentTermField(serializers.SlugRelatedField):
    """Code du trimestre (T1, T2, T3) de l'année en cours."""

    def get_queryset(self):
        from apps.academics.models import SchoolYear
        return Term.objects.filter(year=SchoolYear.get_current())


class EvaluationSerializer(serializers.ModelSerializer):
    term = CurrentTermField(slug_field="code")
    teacher_name = serializers.SerializerMethodField()

    class Meta:
        model = Evaluation
        fields = ["id", "school_class", "subject", "term", "type", "title", "date", "published", "teacher", "teacher_name", "scheduled", "coef", "bareme"]
        read_only_fields = ["published", "teacher", "scheduled"]

    def get_teacher_name(self, obj) -> str:
        return obj.teacher.user.name if obj.teacher else ""

    def validate_coef(self, v):
        if v < Decimal("0.5") or v > 10:
            raise serializers.ValidationError("Le coefficient doit être compris entre 0,5 et 10.")
        return v

    def validate_bareme(self, v):
        if not 1 <= v <= BAREME_MAX:
            raise serializers.ValidationError(f"La note maximale doit être comprise entre 1 et {BAREME_MAX}.")
        if self.instance is not None and v != self.instance.bareme:
            top = max(self.instance.grades.values_list("value", flat=True), default=None)
            if top is not None and top > v:
                raise serializers.ValidationError(f"Des notes dépassent {v} : corrigez-les avant de changer le barème.")
        return v

    def validate_title(self, v):
        if not v.strip():
            raise serializers.ValidationError("Le titre est obligatoire.")
        return v.strip()


class GradesInputSerializer(serializers.Serializer):
    # {"12": 14.5, "13": null} : identifiant de l'élève → note sur le barème de l'évaluation (null efface).
    # Le barème est passé dans le contexte (`bareme`, 20 par défaut).
    values = serializers.DictField(child=serializers.DecimalField(max_digits=5, decimal_places=2, allow_null=True))

    def validate_values(self, vals):
        out = {}
        for k, v in vals.items():
            if not str(k).isdigit():
                raise serializers.ValidationError(f"Identifiant d’élève invalide : {k}")
            if v is not None:
                top = Decimal(self.context.get("bareme", 20))
                if not Decimal(0) <= v <= top:
                    raise serializers.ValidationError(f"Les notes doivent être comprises entre 0 et {top}.")
                v = v.quantize(Decimal("0.01"))
            out[int(k)] = v
        return out


class PublishSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(), min_length=1)
    published = serializers.BooleanField()


class AppreciationInput(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=Student.objects)
    term = serializers.SlugRelatedField(slug_field="code", queryset=Term.objects)
    subject = serializers.PrimaryKeyRelatedField(queryset=Subject.objects)
    text = serializers.CharField(max_length=300, allow_blank=True)


class CouncilInput(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=Student.objects)
    term = serializers.SlugRelatedField(slug_field="code", queryset=Term.objects)
    text = serializers.CharField(max_length=300, allow_blank=True)


class DecisionInput(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=Student.objects)
    value = serializers.ChoiceField(choices=[d for d, _ in DECISIONS])
    comment = serializers.CharField(max_length=300, allow_blank=True, required=False, default="")
    batch = serializers.BooleanField(required=False, default=False)
