import base64
import json
import time
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from django.core.management.base import BaseCommand, CommandError


def _canonical_message(host: str, exp: int) -> bytes:
    # Same canonical form must be used on the verifying side (native app).
    return f"{host}\n{exp}".encode("utf-8")


class Command(BaseCommand):
    help = (
        "Sign a host (FQDN) with the Iabsis Ed25519 private key. "
        "The signed blob (JSON) must be pasted into the tenant's `instance_signature` Constance variable."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--host",
            required=True,
            help="FQDN to authorize, e.g. acme.consult.hcw-at-home.com",
        )
        parser.add_argument(
            "--validity-days",
            type=int,
            default=365,
            help="Signature validity period in days (default: 365).",
        )
        group = parser.add_mutually_exclusive_group(required=True)
        group.add_argument(
            "--private-key",
            help="Base64-encoded Ed25519 private key (32 raw bytes).",
        )
        group.add_argument(
            "--private-key-file",
            help="Path to a file containing the base64-encoded private key.",
        )

    def handle(self, *args, **options):
        host = options["host"].strip().lower()
        if not host or "/" in host or " " in host:
            raise CommandError(f"Invalid host: {host!r}")

        if options["private_key"]:
            private_b64 = options["private_key"].strip()
        else:
            private_b64 = Path(options["private_key_file"]).read_text().strip()

        try:
            private_bytes = base64.b64decode(private_b64)
            private_key = Ed25519PrivateKey.from_private_bytes(private_bytes)
        except Exception as e:
            raise CommandError(f"Failed to load private key: {e}")

        exp = int(time.time()) + options["validity_days"] * 86400
        message = _canonical_message(host, exp)
        signature = private_key.sign(message)

        blob = {
            "host": host,
            "exp": exp,
            "sig": base64.b64encode(signature).decode(),
        }
        # Compact JSON, deterministic key order, no whitespace.
        blob_str = json.dumps(blob, separators=(",", ":"), sort_keys=True)

        self.stdout.write(self.style.SUCCESS(
            f"Signature valid until {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(exp))}\n"
        ))
        self.stdout.write("Paste this into the `instance_signature` Constance variable:\n")
        self.stdout.write(blob_str + "\n")
