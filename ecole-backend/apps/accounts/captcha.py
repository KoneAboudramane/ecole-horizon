"""Contrôle « je ne suis pas un robot » intégré : un petit calcul signé par le serveur. Sans service externe ni clé,
il fonctionne hors ligne. Il s'ajoute (sans les remplacer) au blocage après essais et aux limites de débit.

Le défi est sans état : le jeton contient l'empreinte de la réponse, une date et un identifiant à usage unique."""
import hashlib
import random
import secrets
import time

from django.conf import settings
from django.core import signing
from django.core.cache import cache

SALT = "ecole.captcha"
MAX_AGE = 600  # 10 minutes pour répondre
MIN_DELAY = 1.5  # un robot qui répond instantanément est refusé


def enabled() -> bool:
    return bool(getattr(settings, "CAPTCHA_ENABLED", False))


def _h(nonce: str, answer: int) -> str:
    return hashlib.sha256(f"{settings.SECRET_KEY}|{nonce}|{answer}".encode()).hexdigest()


def new_challenge() -> dict:
    a, b = random.randint(2, 9), random.randint(2, 9)
    op = random.choice("+×")
    ans = a + b if op == "+" else a * b
    nonce = secrets.token_hex(8)
    token = signing.dumps({"n": nonce, "h": _h(nonce, ans), "t": time.time()}, salt=SALT)
    return {"enabled": True, "token": token, "question": f"Combien font {a} {op} {b} ?"}


def verify(token: str, answer) -> bool:
    try:
        d = signing.loads(str(token), salt=SALT, max_age=MAX_AGE)
        ans = int(str(answer).strip())
    except (signing.BadSignature, ValueError, TypeError):
        return False
    if time.time() - d["t"] < MIN_DELAY:
        return False
    if d["h"] != _h(d["n"], ans):
        return False
    return cache.add(f"captcha:{d['n']}", 1, MAX_AGE)  # usage unique
