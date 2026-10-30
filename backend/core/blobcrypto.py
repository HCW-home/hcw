"""
Encryption at rest of stored files: the format and the cryptography.

`core.storage.EncryptedStorage` applies it to the files Django stores and
decides which ones. The threat model is the theft of the storage medium (disk,
backup, copy of a bucket): the key comes from the environment and the
application reads everything, so nothing changes above the storage.

An encrypted blob is a 64-byte header followed by the plaintext cut in chunks,
each one sealed with AES-256-GCM (chunk bytes + a 16-byte tag):

    magic        8   b"HCWBLOB" + format version
    algorithm    1   1 = AES-256-GCM
    kdf          1   1 = HKDF-SHA256
    (reserved)   2
    chunk_size   4   plaintext bytes per chunk, big-endian
    plain_size   8   plaintext length, big-endian
    file_salt   16   random, one per blob
    key_id       8   which key encrypted the blob, without revealing it
    header_tag  16   GCM tag over the 48 bytes above

Chunks keep the blob seekable: plaintext offset `pos` lives in chunk
`pos // chunk_size`, at a position computed without reading anything, so
seeking never decrypts the whole file.

- Each blob has its own key, HKDF(master key, salt=file_salt). Chunk nonces can
  then be the chunk index: unique under that key by construction, and nothing
  to store, which is what keeps chunk positions computable. The random salt
  also makes the same content encrypt differently twice.
- A chunk is authenticated with its index and the file salt: chunks cannot be
  reordered, replayed, or swapped in from another blob.
- The storage name is deliberately left out: a storage may rename a file on
  save (get_available_name), and the blob must stay readable under its final
  name.
- plain_size is covered by the header tag, so a truncated blob, or a header
  lying about its length, fails instead of being served short.
"""

import functools
import os
import struct
from contextlib import contextmanager
from typing import NamedTuple

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

# The last byte is the format version: a new format gets a new magic and both
# can coexist on disk, read by their own code, without a big-bang migration.
MAGIC = b"HCWBLOB\x01"
_MAGIC_PREFIX = MAGIC[:-1]

ALGORITHM_AES256_GCM = 1
KDF_HKDF_SHA256 = 1

CHUNK_SIZE = 64 * 1024
TAG_SIZE = 16
HEADER_SIZE = 64

# Everything the header tag authenticates: 48 bytes, the tag makes it 64.
_FIELDS = struct.Struct(">8sBB2xIQ16s8s")
_SALT_SIZE = 16
# Chunk nonces are chunk indexes, which never get anywhere near this one.
_HEADER_NONCE = b"\xff" * 12
_FILE_KEY_INFO = b"hcw.blob.v1"
_KEY_ID_INFO = b"hcw.blob.key-id.v1"


class BlobDecryptionError(OSError):
    """An encrypted blob cannot be read back: wrong key, or damaged file.

    An OSError, like every other way reading a stored file can fail, so code
    that already handles a failing storage needs nothing more.
    """


class Header(NamedTuple):
    chunk_size: int
    plain_size: int
    file_salt: bytes
    key_id: bytes


def looks_encrypted(data):
    """Whether `data`, the first bytes of a stored file, starts an encrypted blob.

    Checks the magic without its version byte, so that a blob written by a
    newer format is reported as unreadable rather than served as plaintext.
    """
    return data[: len(_MAGIC_PREFIX)] == _MAGIC_PREFIX


@functools.lru_cache(maxsize=16)
def key_id(key):
    """Identify `key` in blob headers without revealing anything about it."""
    return HKDF(
        algorithm=hashes.SHA256(), length=8, salt=None, info=_KEY_ID_INFO
    ).derive(key.encode())


def current_key():
    """The key new blobs are encrypted with."""
    key = settings.BLOB_ENCRYPTION_KEY
    if not key:
        raise ImproperlyConfigured("BLOB_ENCRYPTION_KEY is not set.")
    return key


_accepted_keys = []


@contextmanager
def using_key(key):
    """Also accept `key` to decrypt blobs within the block.

    Encryption keeps using the current key: this is what re-encrypts, during a
    rotation, blobs written under a key the settings no longer mention.
    """
    _accepted_keys.append(key)
    try:
        yield
    finally:
        _accepted_keys.remove(key)


def keyring():
    """Every key blobs can be decrypted with, by key id.

    Read from the settings on each call, so that override_settings, or a key
    rotated in the environment, is picked up without any cache to invalidate.
    """
    keys = (
        settings.BLOB_ENCRYPTION_KEY,
        settings.BLOB_ENCRYPTION_OLD_KEY,
        *_accepted_keys,
    )
    return {key_id(key): key for key in keys if key}


def ciphertext_size(plain_size, chunk_size=CHUNK_SIZE):
    """Stored size of a blob holding `plain_size` bytes of plaintext."""
    chunks = -(-plain_size // chunk_size)
    return HEADER_SIZE + plain_size + chunks * TAG_SIZE


class BlobCipher:
    """AES-256-GCM of one blob, under the key derived from its salt."""

    def __init__(self, key, file_salt):
        file_key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=file_salt,
            info=_FILE_KEY_INFO,
        ).derive(key.encode())
        self._aead = AESGCM(file_key)
        self._salt = file_salt

    def seal_chunk(self, index, plaintext):
        return self._aead.encrypt(_nonce(index), plaintext, self._aad(index))

    def open_chunk(self, index, sealed):
        try:
            return self._aead.decrypt(_nonce(index), sealed, self._aad(index))
        except InvalidTag:
            raise BlobDecryptionError(
                f"chunk {index} failed authentication: the file is damaged"
            ) from None

    def _aad(self, index):
        return index.to_bytes(8, "big") + self._salt

    def tag_header(self, fields):
        return self._aead.encrypt(_HEADER_NONCE, b"", fields)

    def verify_header(self, fields, tag):
        try:
            self._aead.decrypt(_HEADER_NONCE, tag, fields)
        except InvalidTag:
            raise BlobDecryptionError(
                "header failed authentication: the file is damaged"
            ) from None


def _nonce(index):
    return index.to_bytes(12, "big")


def build_header(plain_size, chunk_size=CHUNK_SIZE):
    """Start a new blob under the current key: its header, and the cipher
    sealing its chunks."""
    key = current_key()
    salt = os.urandom(_SALT_SIZE)
    cipher = BlobCipher(key, salt)
    fields = _FIELDS.pack(
        MAGIC,
        ALGORITHM_AES256_GCM,
        KDF_HKDF_SHA256,
        chunk_size,
        plain_size,
        salt,
        key_id(key),
    )
    return fields + cipher.tag_header(fields), cipher


def parse_header(data):
    """Authenticate the header at the start of `data`: (Header, cipher).

    Raises BlobDecryptionError when it cannot: unknown format, key missing
    from the keyring, or tampered header.
    """
    if len(data) < HEADER_SIZE or not looks_encrypted(data):
        raise BlobDecryptionError("not an encrypted blob, or a truncated one")
    fields, tag = data[: _FIELDS.size], data[_FIELDS.size : HEADER_SIZE]
    magic, algorithm, kdf, chunk_size, plain_size, salt, blob_key_id = (
        _FIELDS.unpack(fields)
    )
    if (
        magic != MAGIC
        or algorithm != ALGORITHM_AES256_GCM
        or kdf != KDF_HKDF_SHA256
        or not chunk_size
    ):
        raise BlobDecryptionError(
            f"unsupported blob format (version {magic[-1]}, algorithm "
            f"{algorithm}, kdf {kdf})"
        )
    key = keyring().get(blob_key_id)
    if key is None:
        raise BlobDecryptionError(
            f"encrypted under an unknown key (key id {blob_key_id.hex()}): "
            "BLOB_ENCRYPTION_KEY is not the key this file was written with"
        )
    cipher = BlobCipher(key, salt)
    cipher.verify_header(fields, tag)
    return Header(chunk_size, plain_size, salt, blob_key_id), cipher
