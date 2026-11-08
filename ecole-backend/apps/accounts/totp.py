"""Double authentification par code à usage unique (TOTP, RFC 6238), compatible avec les applications d'authentification
usuelles (Google Authenticator, Microsoft Authenticator, Aegis, FreeOTP…). Aucune dépendance externe."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP = 30
DIGITS = 6
WINDOW = 1  # tolère 30 s de décalage d'horloge de part et d'autre
ISSUER = "Administration de la plateforme"


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return str((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 10 ** DIGITS).zfill(DIGITS)


def verify(secret: str, code: str, last_step: int = 0, now: float | None = None) -> int | None:
    """Renvoie le pas de temps accepté, ou None. Un même code ne sert qu'une fois (`last_step`)."""
    code = "".join(ch for ch in str(code) if ch.isdigit())
    if len(code) != DIGITS:
        return None
    cur = int((time.time() if now is None else now) // STEP)
    for step in range(cur - WINDOW, cur + WINDOW + 1):
        if step > last_step and hmac.compare_digest(_code(secret, step), code):
            return step
    return None


def uri(secret: str, account: str) -> str:
    return f"otpauth://totp/{quote(ISSUER)}:{quote(account)}?secret={secret}&issuer={quote(ISSUER)}&digits={DIGITS}&period={STEP}"


def new_recovery_codes(n: int = 8) -> list[str]:
    return [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(n)]


def hash_code(c: str) -> str:
    return hashlib.sha256(c.strip().lower().replace(" ", "").encode()).hexdigest()
