import re

from rest_framework import serializers

from apps.core.tenancy import Lazy

from apps.students.models import ENROLLED, Student

from .models import MODES, ONLINE_MODES, FeeDate, Payment, PaymentIntent, StatementLine, Tarif

MODE_CODES = [m for m, _ in MODES]


class TarifSerializer(serializers.ModelSerializer):
    def validate_level(self, v):
        from apps.academics.models import level_names
        if v not in level_names():
            raise serializers.ValidationError("Niveau inconnu.")
        return v

    class Meta:
        model = Tarif
        fields = ["level", "ins", "sco", "complement"]
        extra_kwargs = {"level": {"validators": []}}  # PUT remplace le tarif existant du niveau


class PaymentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    class_name = serializers.CharField(source="student.class_label", read_only=True)
    by_name = serializers.SerializerMethodField()
    year_label = serializers.CharField(source="year.label", read_only=True, default="")

    class Meta:
        model = Payment
        fields = ["id", "student", "student_name", "class_name", "amount", "mode", "ref", "date", "receipt_no", "status", "by", "by_name", "note", "advance", "detail", "year_label"]

    def get_by_name(self, obj) -> str:
        return obj.by.name if obj.by else "Opérateur mobile money"


class PaymentInput(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=Lazy(Student, lambda: Student.objects.filter(ENROLLED)))
    amount = serializers.IntegerField(min_value=1, max_value=50_000_000)
    mode = serializers.ChoiceField(choices=MODE_CODES)
    date = serializers.DateField(required=False)
    ref = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    advance = serializers.BooleanField(required=False, default=False)   # garder en avance ce qui dépasse le solde dû

    def validate_date(self, d):
        from django.utils import timezone
        if d > timezone.localdate():
            raise serializers.ValidationError("La date ne peut pas être dans le futur.")
        return d

    def validate(self, a):
        if a["mode"] in ("virement", "cheque") or a["mode"] in ONLINE_MODES:
            if not a["ref"].strip():
                raise serializers.ValidationError({"ref": "La référence est obligatoire pour ce mode de paiement."})
        return a


class CancelInput(serializers.Serializer):
    reason = serializers.CharField(max_length=200)


class DateSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeDate
        fields = ["key", "date"]


class IntentInput(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=Lazy(Student, lambda: Student.objects.filter(ENROLLED)))
    amount = serializers.IntegerField(min_value=100, max_value=50_000_000)
    mode = serializers.ChoiceField(choices=ONLINE_MODES)
    phone = serializers.CharField(max_length=30)

    def validate_phone(self, v):
        d = re.sub(r"\D", "", v)
        if len(d) != 10:
            raise serializers.ValidationError("Le numéro doit comporter 10 chiffres.")
        return d


class IntentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentIntent
        fields = ["reference", "student", "amount", "mode", "phone", "status", "payment", "created"]


class StatementSerializer(serializers.ModelSerializer):
    issue = serializers.SerializerMethodField()

    class Meta:
        model = StatementLine
        fields = ["id", "ref", "date", "mode", "amount", "phone", "payment", "issue"]

    def get_issue(self, obj) -> str:
        if obj.payment_id is None:
            return "unmatched"
        return "amount_mismatch" if obj.payment.amount != obj.amount else "ok"


class MatchInput(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=Lazy(Student, lambda: Student.objects.filter(ENROLLED)))
