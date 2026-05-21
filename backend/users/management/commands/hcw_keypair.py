import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        "Generate an Ed25519 keypair used by Iabsis to sign trusted instance hosts. "
        "Run once. Keep the private key offline; embed the public key in the native app."
    )

    def handle(self, *args, **options):
        private_key = Ed25519PrivateKey.generate()
        public_key = private_key.public_key()

        private_bytes = private_key.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )
        public_bytes = public_key.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )

        private_b64 = base64.b64encode(private_bytes).decode()
        public_b64 = base64.b64encode(public_bytes).decode()

        self.stdout.write(self.style.WARNING(
            "Keep the private key SECRET. Store it offline (e.g. ~/.hcw/iabsis_private_key.b64).\n"
        ))
        self.stdout.write(self.style.SUCCESS("PRIVATE_KEY (base64, secret):"))
        self.stdout.write(private_b64 + "\n")
        self.stdout.write(self.style.SUCCESS("PUBLIC_KEY (base64, embed in native app):"))
        self.stdout.write(public_b64 + "\n")
