"""
Server-side cryptographic helpers for the E2E encryption tree.

Used during three temporary "server sees plaintext" moments:
  1. User keypair provisioning (random passphrase generated server-side).
  2. Queue keypair provisioning (private key wrapped for master + each member).
  3. Passphrase reset (regenerate user keypair under a new passphrase).

After these moments, plaintext key material never traverses the server again.
"""

import base64
import json
import os
import secrets
import string

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


RSA_KEY_SIZE = 4096
PBKDF2_ITERATIONS = 600_000
PBKDF2_SALT_BYTES = 16
AES_KEY_BYTES = 32
AES_NONCE_BYTES = 12


def generate_rsa_keypair() -> tuple[bytes, bytes]:
    """Returns (private_pkcs8_pem, public_spki_pem) as bytes."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=RSA_KEY_SIZE)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_pem, public_pem


def derive_kek(passphrase: str, salt: bytes) -> bytes:
    """PBKDF2-SHA256 -> 32 bytes (AES-256 key)."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=AES_KEY_BYTES,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return kdf.derive(passphrase.encode("utf-8"))


def encrypt_private_key_with_passphrase(private_pem: bytes, passphrase: str) -> str:
    """Wraps a PKCS8 PEM private key under PBKDF2(passphrase) + AES-GCM.

    Returns a JSON string {salt, iv, ciphertext} where each field is base64.
    """
    salt = os.urandom(PBKDF2_SALT_BYTES)
    nonce = os.urandom(AES_NONCE_BYTES)
    kek = derive_kek(passphrase, salt)
    ciphertext = AESGCM(kek).encrypt(nonce, private_pem, None)
    return json.dumps(
        {
            "salt": base64.b64encode(salt).decode("ascii"),
            "iv": base64.b64encode(nonce).decode("ascii"),
            "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
        }
    )


def decrypt_private_key_with_passphrase(blob: str, passphrase: str) -> bytes:
    """Reverses encrypt_private_key_with_passphrase. Raises on bad passphrase."""
    data = json.loads(blob)
    salt = base64.b64decode(data["salt"])
    nonce = base64.b64decode(data["iv"])
    ciphertext = base64.b64decode(data["ciphertext"])
    kek = derive_kek(passphrase, salt)
    return AESGCM(kek).decrypt(nonce, ciphertext, None)


def normalize_pem(public_pem: str | bytes) -> bytes:
    """Strip + canonicalize newlines (LF only) so server and browser
    fingerprints always agree regardless of HTTP transport mangling."""
    if isinstance(public_pem, str):
        public_pem = public_pem.encode("utf-8")
    return public_pem.replace(b"\r\n", b"\n").replace(b"\r", b"\n").strip()


def fingerprint_public_key(public_pem: str | bytes) -> str:
    """SHA-256 hex digest of the canonical PEM bytes."""
    digest = hashes.Hash(hashes.SHA256())
    digest.update(normalize_pem(public_pem))
    return digest.finalize().hex()


def rsa_encrypt(plaintext: bytes, public_pem: str | bytes) -> str:
    """RSA-OAEP-SHA256 encryption -> base64 string."""
    if isinstance(public_pem, str):
        public_pem = public_pem.encode("utf-8")
    public_key = serialization.load_pem_public_key(public_pem)
    ciphertext = public_key.encrypt(
        plaintext,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return base64.b64encode(ciphertext).decode("ascii")


def rsa_decrypt(ciphertext_b64: str, private_pem: bytes) -> bytes:
    """RSA-OAEP-SHA256 decryption (server-side, used only during provisioning)."""
    private_key = serialization.load_pem_private_key(private_pem, password=None)
    ciphertext = base64.b64decode(ciphertext_b64)
    return private_key.decrypt(
        ciphertext,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )


def rsa_envelope_encrypt(plaintext: bytes, public_pem: str | bytes) -> str:
    """Hybrid encryption for arbitrary-size payloads.

    RSA-OAEP can only encrypt small payloads (~446 bytes for RSA-4096), so
    when we need to wrap a Queue's PEM private key (a few KB) under a
    pubkey, we instead:
      1. Generate a random AES-256 key (CEK)
      2. AES-GCM encrypt the plaintext under the CEK
      3. RSA-OAEP wrap the CEK under the pubkey
    Returns a JSON string {wrapped_key, iv, ciphertext} base64-encoded.
    """
    cek = os.urandom(AES_KEY_BYTES)
    nonce = os.urandom(AES_NONCE_BYTES)
    ciphertext = AESGCM(cek).encrypt(nonce, plaintext, None)
    wrapped_cek = rsa_encrypt(cek, public_pem)
    return json.dumps(
        {
            "wrapped_key": wrapped_cek,
            "iv": base64.b64encode(nonce).decode("ascii"),
            "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
        }
    )


def rsa_envelope_decrypt(blob: str, private_pem: bytes) -> bytes:
    """Reverses rsa_envelope_encrypt."""
    data = json.loads(blob)
    cek = rsa_decrypt(data["wrapped_key"], private_pem)
    nonce = base64.b64decode(data["iv"])
    ciphertext = base64.b64decode(data["ciphertext"])
    return AESGCM(cek).decrypt(nonce, ciphertext, None)


_PASSPHRASE_ALPHABET = string.ascii_letters + string.digits


def generate_passphrase(length: int = 24) -> str:
    """Cryptographically random alphanumeric passphrase."""
    return "".join(secrets.choice(_PASSPHRASE_ALPHABET) for _ in range(length))
