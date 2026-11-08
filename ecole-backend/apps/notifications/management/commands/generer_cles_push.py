import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management.base import BaseCommand


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class Command(BaseCommand):
    help = "Génère les clés des alertes sur le téléphone (Web Push), à copier une seule fois dans le .env."

    def handle(self, *a, **kw):
        key = ec.generate_private_key(ec.SECP256R1())
        private = key.private_numbers().private_value.to_bytes(32, "big")
        public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.stdout.write(f"WEBPUSH_PUBLIC_KEY={b64(public)}\nWEBPUSH_PRIVATE_KEY={b64(private)}")
        self.stderr.write("Gardez la clé privée secrète. En changer désactive les alertes de tous les appareils (à réactiver).")
