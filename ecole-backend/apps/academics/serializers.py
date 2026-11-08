import re
from rest_framework import serializers

from apps.core.serializers import UniqueInSchoolMixin

from . import passage
from .models import Level, Coefficient, Serie, valid_groupes, SchoolClass, SchoolSettings, SchoolYear, Subject, Teacher, TeachingAssignment, Term, groupe_for


class YearSerializer(UniqueInSchoolMixin, serializers.ModelSerializer):
    class Meta:
        model = SchoolYear
        fields = ["id", "label", "current"]


class TermSerializer(serializers.ModelSerializer):
    class Meta:
        model = Term
        fields = ["id", "code", "label", "start", "end", "locked", "coef"]


class SubjectSerializer(UniqueInSchoolMixin, serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = ["id", "code", "name", "short"]


class ClassSerializer(UniqueInSchoolMixin, serializers.ModelSerializer):
    effectif = serializers.SerializerMethodField()
    prof_principal_name = serializers.SerializerMethodField()

    class Meta:
        model = SchoolClass
        fields = ["id", "name", "level", "serie", "groupe", "max_students", "cycle", "effectif", "room", "prof_principal", "prof_principal_name"]
        read_only_fields = ["groupe", "cycle", "prof_principal"]   # s'attribue par classes/<id>/principal/

    def get_prof_principal_name(self, obj) -> str:
        return obj.prof_principal.user.name if obj.prof_principal_id else ""

    def get_effectif(self, obj) -> int:
        n = getattr(obj, "n_students", None)
        return n if n is not None else obj.students.filter(active=True).count()

    def validate(self, attrs):
        level = attrs.get("level", getattr(self.instance, "level", ""))
        serie = attrs.get("serie", getattr(self.instance, "serie", ""))
        lv = Level.objects.filter(name=level).first()
        if lv is None:
            raise serializers.ValidationError({"level": f"Niveau inconnu ({', '.join(Level.objects.values_list('name', flat=True))}). Ajoutez-le dans Paramètres > Niveaux et séries."})
        if lv.has_series:
            serie = (serie or "").strip().upper()
            if not serie:
                raise serializers.ValidationError({"serie": f"La série est obligatoire en {level}."})
            if not Serie.objects.filter(level=level, code=serie).exists():
                codes = ", ".join(Serie.objects.filter(level=level).values_list("code", flat=True)) or "aucune"
                raise serializers.ValidationError({"serie": f"Série inconnue en {level} (séries de l’école : {codes}). Ajoutez-la dans Paramètres > Niveaux et séries."})
            attrs["serie"] = serie
        else:
            attrs["serie"] = ""
        attrs["groupe"] = groupe_for(level, attrs["serie"])
        room = attrs.get("room")
        if room:
            if room.kind != "classe":
                raise serializers.ValidationError({"room": "Seule une salle de classe peut être la salle principale d’une classe."})
            other = SchoolClass.objects.filter(room=room)
            if self.instance:
                other = other.exclude(pk=self.instance.pk)
            if other.exists():
                raise serializers.ValidationError({"room": f"{room.name} est déjà la salle de la {other.first().name}."})
        attrs["cycle"] = lv.cycle
        if self.instance and "max_students" in attrs and attrs["max_students"] < self.get_effectif(self.instance):
            raise serializers.ValidationError({"max_students": "La capacité est inférieure à l’effectif actuel."})
        return attrs


class CoefficientSerializer(serializers.ModelSerializer):
    subject = serializers.PrimaryKeyRelatedField(queryset=Subject.objects)

    class Meta:
        model = Coefficient
        fields = ["groupe", "subject", "value"]


class CoefficientSetSerializer(serializers.Serializer):
    groupe = serializers.CharField(max_length=20)
    subject = serializers.PrimaryKeyRelatedField(queryset=Subject.objects)
    value = serializers.IntegerField(min_value=0, max_value=20)

    def validate_groupe(self, v):
        if v not in valid_groupes():
            raise serializers.ValidationError("Groupe inconnu : un niveau du collège ou une série du lycée de l’école.")
        return v


class LevelSerializer(serializers.ModelSerializer):
    classes = serializers.SerializerMethodField()

    class Meta:
        model = Level
        fields = ["id", "name", "order", "cycle", "has_series", "classes"]
        read_only_fields = ["order"]

    def get_classes(self, obj) -> int:
        return SchoolClass.objects.filter(level=obj.name).count()

    def validate_name(self, v):
        v = " ".join(v.split())
        if not v:
            raise serializers.ValidationError("Donnez un nom au niveau (6e, 7e année, 10e…).")
        if Level.objects.filter(name__iexact=v).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError(f"Le niveau « {v} » existe déjà.")
        return v


class SerieSerializer(serializers.ModelSerializer):
    groupe = serializers.CharField(read_only=True)
    classes = serializers.SerializerMethodField()

    class Meta:
        model = Serie
        fields = ["id", "level", "code", "name", "groupe", "classes"]

    def get_classes(self, obj) -> list[str]:
        return list(SchoolClass.objects.filter(level=obj.level, serie=obj.code).values_list("name", flat=True))

    def validate_code(self, v):
        import re
        v = v.strip().upper()
        if not re.fullmatch(r"[A-Z][A-Z0-9]{0,9}", v):
            raise serializers.ValidationError("Code de 1 à 10 caractères : une lettre, puis lettres ou chiffres (A, C, A1, G2, TSEXP…).")
        return v

    def validate_level(self, v):
        if not Level.objects.filter(name=v, has_series=True).exists():
            raise serializers.ValidationError("Les séries ne concernent que les niveaux « à séries » (Paramètres > Niveaux et séries).")
        return v


class TeacherSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="user.full_name", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    subject_ids = serializers.PrimaryKeyRelatedField(source="subjects", many=True, queryset=Subject.objects, required=False)

    class Meta:
        model = Teacher
        fields = ["id", "user_id", "name", "phone", "subject_ids", "max_hours"]


class AssignmentSerializer(serializers.ModelSerializer):
    teacher = serializers.PrimaryKeyRelatedField(queryset=Teacher.objects, allow_null=True)

    class Meta:
        model = TeachingAssignment
        fields = ["id", "teacher", "subject", "school_class"]
        read_only_fields = ["id"]
        validators: list = []  # l'unicité (classe, matière) est gérée par « remplacer »


class SettingsSerializer(serializers.ModelSerializer):
    director_name = serializers.SerializerMethodField()   # nom imprimé sur les bulletins (Paramètres, sinon compte de direction)
    seuils = serializers.ListField(child=serializers.DecimalField(max_digits=4, decimal_places=2, min_value=0, max_value=20),
                                   min_length=4, max_length=4, required=False)

    class Meta:
        model = SchoolSettings
        fields = ["name", "address", "phone", "email", "director", "director_name", "hue", "template", "entete_pays", "entete_devise", "compo_weight", "remise_fratrie", "seuils", "logo",
                  "passage_admission", "passage_redoublement", "passage_exclusion", "passage_niveaux",
                  "conduite_max", "conduite_in_average", "conduite_coef", "absence_tranche", "absence_points", "justif_delai", "conduite_baremes", "eleve_voit_cahier", "devoirs_actifs", "bulletin_blocage"]

    def get_director_name(self, obj) -> str:
        return obj.director_name()

    def validate_logo(self, v):
        if v and not re.fullmatch(r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+", v):
            raise serializers.ValidationError("Le logo doit être une image PNG, JPEG ou WebP.")
        if len(v) > 400_000:
            raise serializers.ValidationError("Le logo est trop lourd (400 Ko au maximum).")
        return v

    def validate_compo_weight(self, v):
        if not 0 <= v <= 1:
            raise serializers.ValidationError("Le poids doit être compris entre 0 et 1.")
        return v

    def validate_conduite_max(self, v):
        if not 1 <= v <= 100:
            raise serializers.ValidationError("La note de conduite maximale doit être comprise entre 1 et 100.")
        return v

    def validate_conduite_coef(self, v):
        if not 0.5 <= v <= 10:
            raise serializers.ValidationError("Le coefficient de la conduite doit être compris entre 0,5 et 10.")
        return v

    def validate_absence_tranche(self, v):
        if v > 50:
            raise serializers.ValidationError("Au plus 50 absences par retrait.")
        return v

    def validate_justif_delai(self, v):
        if v > 90:
            raise serializers.ValidationError("Le délai de justification est de 90 jours au plus.")
        return v

    def validate_conduite_baremes(self, v):
        from apps.discipline.models import SANCTIONS
        keys = {k for k, _ in SANCTIONS}
        if not isinstance(v, dict) or any(k not in keys for k in v):
            raise serializers.ValidationError("Sanction inconnue.")
        out = {}
        for k, x in v.items():
            try:
                x = float(x)
            except (TypeError, ValueError):
                raise serializers.ValidationError("Les retraits conseillés doivent être des nombres.") from None
            if not 0 <= x <= 20:
                raise serializers.ValidationError("Un retrait conseillé est compris entre 0 et 20 points.")
            out[k] = x
        return out

    def validate_remise_fratrie(self, v):
        if v > 100:
            raise serializers.ValidationError("La remise ne peut pas dépasser 100 %.")
        return v

    def validate(self, attrs):
        inst = self.instance
        adm = attrs.get("passage_admission", getattr(inst, "passage_admission", 10))
        red = attrs.get("passage_redoublement", getattr(inst, "passage_redoublement", 8))
        exc = attrs["passage_exclusion"] if "passage_exclusion" in attrs else getattr(inst, "passage_exclusion", None)
        if not 0 <= red <= adm <= 20:
            raise serializers.ValidationError({"passage_redoublement": "La moyenne de redoublement doit être inférieure ou égale à la moyenne d’admission (entre 0 et 20)."})
        if exc is not None and not 0 <= exc < red:
            raise serializers.ValidationError({"passage_exclusion": "La moyenne d’exclusion doit être inférieure à celle de redoublement."})
        return attrs

    def validate_passage_niveaux(self, v):
        try:
            return passage.clean(v)
        except ValueError as e:
            raise serializers.ValidationError(str(e)) from None

    def validate_seuils(self, v):
        if any(v[i] <= v[i + 1] for i in range(3)):
            raise serializers.ValidationError("Les seuils doivent être décroissants (très bien > bien > assez bien > passable).")
        return v

    def to_representation(self, obj):
        d = super().to_representation(obj)
        d["seuils"] = obj.seuils
        d["compo_weight"] = float(obj.compo_weight)
        d["passage_niveaux"] = obj.passage_niveaux or {}
        d["passage_admission"] = float(obj.passage_admission)
        d["passage_redoublement"] = float(obj.passage_redoublement)
        d["passage_exclusion"] = None if obj.passage_exclusion is None else float(obj.passage_exclusion)
        return d

    def update(self, obj, data):
        s = data.pop("seuils", None)
        if s:
            obj.seuil_tb, obj.seuil_b, obj.seuil_ab, obj.seuil_p = s
        return super().update(obj, data)
