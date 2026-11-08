import secrets

from rest_framework import serializers

MIN_LENGTH = 6
_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"  # sans caractères ambigus (0/O, 1/l/I)


def temp_password(length: int = 8) -> str:
    """Mot de passe provisoire lisible, remis une seule fois à la personne ; elle devra le changer."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def temp_pin(length: int = 6) -> str:
    """Code provisoire de chiffres, pour les familles et les élèves : facile à recopier depuis la fiche d'accès, à changer à la première connexion."""
    return "".join(secrets.choice("0123456789") for _ in range(length))


def check_new_password(new: str, confirm: str | None = None, current: str | None = None) -> None:
    if len(new) < MIN_LENGTH:
        raise serializers.ValidationError({"new": f"Le mot de passe doit contenir au moins {MIN_LENGTH} caractères."})
    if confirm is not None and new != confirm:
        raise serializers.ValidationError({"confirm": "Les deux mots de passe ne sont pas identiques."})
    if current is not None and new == current:
        raise serializers.ValidationError({"new": "Le nouveau mot de passe doit être différent de l’actuel."})
