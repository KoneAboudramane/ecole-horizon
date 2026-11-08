from django.db import transaction
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import generics, permissions, serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import TeachingAssignment
from apps.accounts.models import User
from apps.core.log import record
from apps.core.permissions import ROLES, STAFF_ROLES, has_perm, perm_required
from apps.notifications.services import notify
from apps.students.models import Student

from .models import Announcement, Message, Participant, Thread

ROLE_LABEL = {"fondateur": "Fondateur", "directeur": "Directeur", "admin": "Secrétariat", "educateur": "Éducateur",
              "comptable": "Comptable", "informatique": "Informatique", "enseignant": "Enseignant"}


# ---------- Annonces ----------
class AnnouncementSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    audience = serializers.ListField(child=serializers.ChoiceField(choices=ROLES), min_length=1)
    cursus = serializers.ListField(child=serializers.IntegerField(), required=False, write_only=True, help_text="Cursus concernés ; vide = toute l'école.")
    cursus_noms = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = ["id", "title", "body", "audience", "cursus", "cursus_noms", "author", "author_name", "created"]
        read_only_fields = ["author", "created"]

    def get_author_name(self, obj) -> str:
        return obj.author.name if obj.author else ""

    def get_cursus_noms(self, obj) -> list[str]:
        return [c.nom for c in obj.cursus.all()]

    def to_representation(self, obj):
        data = super().to_representation(obj)
        data["cursus"] = [c.pk for c in obj.cursus.all()]
        return data


def _concerned(user, a: Announcement, scope) -> bool:
    """L'annonce concerne-t-elle ce compte ? Son rôle est destinataire et, si l'annonce vise des cursus, il en fait partie."""
    ids = {c.pk for c in a.cursus.all()}
    return not ids or scope is None or bool(ids & scope)


class AnnouncementList(generics.ListCreateAPIView):
    """GET : annonces destinées à mon rôle (les auteurs voient aussi les leurs). POST : publication (direction, secrétariat)."""

    serializer_class = AnnouncementSerializer
    pagination_class = None

    def get_permissions(self):
        return [perm_required("annonces.write")()] if self.request.method == "POST" else [permissions.IsAuthenticated()]

    def get_queryset(self):
        return Announcement.objects.select_related("author").prefetch_related("cursus")

    def list(self, request, *args, **kwargs):
        from apps.accounts.perimetre import scope_of
        u = request.user
        scope = scope_of(u)            # cursus du compte (personnel, enseignant, famille) ; None = toute l'école
        rows = [a for a in self.get_queryset()
                if a.author_id == u.pk or ((has_perm(u, "annonces.write") or u.role in a.audience) and _concerned(u, a, scope))]
        return Response(AnnouncementSerializer(rows, many=True).data)

    def perform_create(self, ser):
        from apps.accounts.perimetre import allowed_cursus, all_cursus_ids, scope_of
        u = self.request.user
        ids = ser.validated_data.pop("cursus", None)
        mine = allowed_cursus(u)
        if mine is not None and all_cursus_ids() <= mine:
            mine = None
        if ids is None:                       # non précisé : toute l'école, ou le périmètre de l'auteur s'il est limité
            ids = [] if mine is None else sorted(mine)
        if not set(ids) <= all_cursus_ids():
            raise ValidationError({"cursus": "Cursus inconnu dans votre école."})
        if mine is not None and (not ids or not set(ids) <= mine):
            raise ValidationError({"cursus": "Vous publiez seulement pour les cursus de votre périmètre."})
        a = ser.save(author=u)
        a.cursus.set(ids)
        targets = [t for t in User.objects.filter(role__in=a.audience, is_active=True).exclude(pk=u.pk) if not ids or (scope_of(t) or set(ids)) & set(ids)]
        notify(targets, f"Nouvelle annonce : {a.title}", "annonce", "annonces")
        record("Annonce", a.title + (f" ({', '.join(c.nom for c in a.cursus.all())})" if ids else ""), request=self.request)


# ---------- Messagerie ----------
def can_send(user) -> bool:
    return user.role != "eleve"


def recipient_options(me) -> list[dict]:
    """Destinataires autorisés : un parent écrit aux enseignants de ses enfants, à la direction et à la vie scolaire ;
    le personnel écrit à tout le personnel et aux parents des classes suivies (enseignant : ses classes seulement)."""
    if not can_send(me):
        return []
    out: dict[int, dict] = {}

    def add(user, sub, group, is_parent=False):
        if user.pk != me.pk and user.is_active and user.pk not in out:
            out[user.pk] = {"user": user.pk, "name": user.name, "sub": sub, "group": group, "is_parent": is_parent}

    if me.role == "parent":
        class_ids = set(Student.objects.filter(parent__user=me, active=True).values_list("school_class_id", flat=True))
        by_teacher: dict[int, list[str]] = {}
        for a in TeachingAssignment.objects.filter(school_class_id__in=class_ids).select_related("teacher__user", "subject", "school_class"):
            by_teacher.setdefault(a.teacher_id, []).append(f"{a.subject.short} · {a.school_class.name}")
            add(a.teacher.user, "", "Enseignants")
            if a.teacher.user_id in out:
                out[a.teacher.user_id]["sub"] = ", ".join(by_teacher[a.teacher_id])
        for u in User.objects.filter(role="directeur"):
            add(u, "Directeur", "Direction")
        for u in User.objects.filter(role="educateur"):
            add(u, "Éducateur", "Vie scolaire")
        return list(out.values())

    for u in User.objects.filter(role__in=STAFF_ROLES):
        add(u, u.role_label, "Direction" if u.role == "directeur" else "Vie scolaire" if u.role == "educateur" else "Personnel")
    studs = Student.objects.filter(active=True).select_related("parent__user", "school_class")
    if me.role == "enseignant":
        studs = studs.filter(school_class__assignments__teacher__user=me).distinct()
    for s in studs:
        kid = f"{s.prenoms} ({s.class_label})"
        pu = s.parent.user
        if pu.pk in out:
            out[pu.pk]["sub"] += f", {kid}"
        else:
            add(pu, f"Parent de {kid}", "Parents", True)
    return list(out.values())


class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source="sender.full_name", read_only=True)

    class Meta:
        model = Message
        fields = ["id", "sender", "sender_name", "text", "created"]


class ThreadSerializer(serializers.ModelSerializer):
    participants = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    unread = serializers.SerializerMethodField()

    class Meta:
        model = Thread
        fields = ["id", "subject", "creator", "participants", "last_message", "unread", "updated"]

    def get_participants(self, t) -> list[dict]:
        return [{"id": m.user_id, "name": m.user.name} for m in t.members.all()]

    def get_last_message(self, t) -> dict | None:
        m = list(t.messages.all())[-1:]
        return {"text": m[0].text[:120], "sender": m[0].sender_id, "created": m[0].created} if m else None

    def get_unread(self, t) -> int:
        me = self.context["request"].user
        mem = next((x for x in t.members.all() if x.user_id == me.pk), None)
        msgs = list(t.messages.all())
        return sum(1 for m in msgs[mem.read_count if mem else 0:] if m.sender_id != me.pk)


def my_threads(user):
    return Thread.objects.filter(members__user=user).prefetch_related("members__user", "messages").distinct()


class RecipientsView(APIView):
    @extend_schema(responses=inline_serializer("Recipient", {"user": serializers.IntegerField(), "name": serializers.CharField()}, many=True))
    def get(self, request):
        return Response(sorted(recipient_options(request.user), key=lambda c: (["Direction", "Vie scolaire", "Enseignants", "Personnel", "Parents"].index(c["group"]), c["name"])))


class SendInput(serializers.Serializer):
    recipients = serializers.ListField(child=serializers.IntegerField(), min_length=1, max_length=300)
    subject = serializers.CharField(max_length=150)
    text = serializers.CharField(max_length=3000)

    def validate_subject(self, v):
        if not v.strip():
            raise serializers.ValidationError("L’objet est obligatoire.")
        return v.strip()

    def validate_text(self, v):
        if not v.strip():
            raise serializers.ValidationError("Le message est vide.")
        return v.strip()


class ThreadList(generics.ListCreateAPIView):
    """GET : mes conversations (les seules visibles, jamais celles des autres). POST : nouveau message.
    Si un destinataire est un parent, chaque parent reçoit sa propre conversation : les familles ne se voient pas entre elles."""

    serializer_class = ThreadSerializer
    pagination_class = None

    def get_queryset(self):
        return my_threads(self.request.user)

    @extend_schema(request=SendInput, responses=inline_serializer("Sent", {"threads": serializers.ListField(child=serializers.IntegerField())}))
    @transaction.atomic
    def create(self, request, *args, **kwargs):
        if not can_send(request.user):
            raise PermissionDenied("Les élèves ne peuvent pas envoyer de messages.")
        ser = SendInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        allowed = {c["user"]: c for c in recipient_options(request.user)}
        targets = [i for i in dict.fromkeys(d["recipients"]) if i in allowed]
        if not targets or len(targets) != len(set(d["recipients"])):
            raise ValidationError({"recipients": "Certains destinataires ne sont pas autorisés."})
        groups = [[i] for i in targets] if any(allowed[i]["is_parent"] for i in targets) else [targets]
        ids = []
        for g in groups:
            t = Thread.objects.create(subject=d["subject"], creator=request.user)
            Participant.objects.create(thread=t, user=request.user, read_count=1)
            Participant.objects.bulk_create([Participant(thread=t, user_id=i) for i in g])
            Message.objects.create(thread=t, sender=request.user, text=d["text"])
            notify(g, f"Nouveau message de {request.user.name} : {d['subject']}", "annonce", "messages")
            ids.append(t.pk)
        record("Messagerie", f"Message envoyé à {len(targets)} destinataire(s) : {d['subject']}", request=request)
        return Response({"threads": ids}, status=status.HTTP_201_CREATED)


class ThreadDetail(APIView):
    @extend_schema(responses=inline_serializer("ThreadFull", {"messages": MessageSerializer(many=True)}))
    def get(self, request, pk):
        t = generics.get_object_or_404(my_threads(request.user), pk=pk)
        return Response({**ThreadSerializer(t, context={"request": request}).data, "messages": MessageSerializer(t.messages.all(), many=True).data})


class ReplyView(APIView):
    @extend_schema(request=inline_serializer("Reply", {"text": serializers.CharField()}), responses=MessageSerializer)
    @transaction.atomic
    def post(self, request, pk):
        t = generics.get_object_or_404(my_threads(request.user), pk=pk)
        if not can_send(request.user):
            raise PermissionDenied("Les élèves ne peuvent pas envoyer de messages.")
        text = str(request.data.get("text", "")).strip()
        if not text or len(text) > 3000:
            raise ValidationError({"text": "Le message est vide ou trop long."})
        m = Message.objects.create(thread=t, sender=request.user, text=text)
        Thread.objects.filter(pk=t.pk).update(updated=m.created)
        Participant.objects.filter(thread=t, user=request.user).update(read_count=t.messages.count())
        notify([x.user_id for x in t.members.all() if x.user_id != request.user.pk], f"{request.user.name} a répondu : {t.subject}", "annonce", "messages")
        return Response(MessageSerializer(m).data, status=status.HTTP_201_CREATED)


class ReadView(APIView):
    @extend_schema(request=None, responses=inline_serializer("ReadOk", {"unread": serializers.IntegerField()}))
    def post(self, request, pk):
        t = generics.get_object_or_404(my_threads(request.user), pk=pk)
        Participant.objects.filter(thread=t, user=request.user).update(read_count=t.messages.count())
        return Response({"unread": 0})


class MsgUnread(APIView):
    @extend_schema(responses=inline_serializer("MsgUnreadOut", {"unread": serializers.IntegerField()}))
    def get(self, request):
        n = sum(1 for t in my_threads(request.user) if ThreadSerializer(t, context={"request": request}).get_unread(t) > 0)
        return Response({"unread": n})
