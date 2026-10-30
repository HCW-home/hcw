"""The encrypted blob format, before any storage is involved."""

from django.test import SimpleTestCase, override_settings

from core import blobcrypto
from core.blobcrypto import BlobDecryptionError

KEY = "k" * 40
OTHER_KEY = "o" * 40


def encrypt(data, chunk_size=blobcrypto.CHUNK_SIZE):
    header, cipher = blobcrypto.build_header(len(data), chunk_size)
    chunks = [
        cipher.seal_chunk(index, data[start : start + chunk_size])
        for index, start in enumerate(range(0, len(data), chunk_size))
    ]
    return header, chunks


def decrypt(header_bytes, chunks):
    header, cipher = blobcrypto.parse_header(header_bytes)
    plaintext = b"".join(
        cipher.open_chunk(index, sealed) for index, sealed in enumerate(chunks)
    )
    return plaintext[: header.plain_size]


@override_settings(BLOB_ENCRYPTION_KEY=KEY, BLOB_ENCRYPTION_OLD_KEY="")
class BlobFormatTests(SimpleTestCase):
    def test_round_trip(self):
        data = bytes(range(256)) * 10
        header, chunks = encrypt(data, chunk_size=1000)

        self.assertEqual(len(header), blobcrypto.HEADER_SIZE)
        self.assertEqual(len(chunks), 3)
        self.assertEqual(decrypt(header, chunks), data)

    def test_empty_file_is_a_header_alone(self):
        header, chunks = encrypt(b"")

        self.assertEqual(chunks, [])
        self.assertEqual(decrypt(header, chunks), b"")
        self.assertEqual(blobcrypto.ciphertext_size(0), blobcrypto.HEADER_SIZE)

    def test_ciphertext_size_matches_what_is_written(self):
        for size in (1, 999, 1000, 1001, 3000):
            header, chunks = encrypt(b"x" * size, chunk_size=1000)
            written = len(header) + sum(map(len, chunks))
            self.assertEqual(blobcrypto.ciphertext_size(size, 1000), written)

    def test_same_content_encrypts_differently(self):
        """A fresh salt per blob: equal files do not look equal on disk."""
        first, first_chunks = encrypt(b"same content")
        second, second_chunks = encrypt(b"same content")

        self.assertNotEqual(first, second)
        self.assertNotEqual(first_chunks, second_chunks)

    def test_detects_the_magic_only(self):
        header, _ = encrypt(b"data")

        self.assertTrue(blobcrypto.looks_encrypted(header))
        self.assertFalse(blobcrypto.looks_encrypted(b"%PDF-1.7 ..."))
        self.assertFalse(blobcrypto.looks_encrypted(b""))

    def test_a_newer_format_is_refused_not_served(self):
        header, _ = encrypt(b"data")
        newer = header[:7] + b"\x02" + header[8:]

        self.assertTrue(blobcrypto.looks_encrypted(newer))
        with self.assertRaisesMessage(BlobDecryptionError, "unsupported"):
            blobcrypto.parse_header(newer)

    def test_plain_size_is_authenticated(self):
        """Editing the length in the header must not truncate the file silently."""
        header, _ = encrypt(b"x" * 100)
        tampered = bytearray(header)
        tampered[23] ^= 1  # last byte of plain_size

        with self.assertRaisesMessage(BlobDecryptionError, "header"):
            blobcrypto.parse_header(bytes(tampered))

    def test_chunks_cannot_be_reordered(self):
        header, chunks = encrypt(b"a" * 10 + b"b" * 10, chunk_size=10)

        with self.assertRaises(BlobDecryptionError):
            decrypt(header, list(reversed(chunks)))

    def test_chunks_cannot_come_from_another_blob(self):
        header, chunks = encrypt(b"a" * 20, chunk_size=10)
        _, foreign = encrypt(b"b" * 20, chunk_size=10)

        with self.assertRaises(BlobDecryptionError):
            decrypt(header, [chunks[0], foreign[1]])

    def test_tampered_chunk_fails(self):
        header, chunks = encrypt(b"medical report")
        damaged = bytearray(chunks[0])
        damaged[0] ^= 1

        with self.assertRaises(BlobDecryptionError):
            decrypt(header, [bytes(damaged)])

    def test_wrong_key_is_reported_as_such(self):
        header, _ = encrypt(b"data")

        with override_settings(BLOB_ENCRYPTION_KEY=OTHER_KEY):
            with self.assertRaisesMessage(BlobDecryptionError, "unknown key"):
                blobcrypto.parse_header(header)

    def test_is_an_oserror(self):
        """So that code expecting a failing storage handles it as is."""
        self.assertTrue(issubclass(BlobDecryptionError, OSError))


@override_settings(BLOB_ENCRYPTION_OLD_KEY="")
class KeyRotationTests(SimpleTestCase):
    def test_old_key_from_the_settings_still_decrypts(self):
        with override_settings(BLOB_ENCRYPTION_KEY=OTHER_KEY):
            header, chunks = encrypt(b"written under the old key")

        with override_settings(
            BLOB_ENCRYPTION_KEY=KEY, BLOB_ENCRYPTION_OLD_KEY=OTHER_KEY
        ):
            self.assertEqual(decrypt(header, chunks), b"written under the old key")
            # New blobs use the current key.
            new_header, _ = encrypt(b"new")
            self.assertEqual(
                blobcrypto.parse_header(new_header)[0].key_id,
                blobcrypto.key_id(KEY),
            )

    def test_using_key_accepts_it_for_the_block_only(self):
        with override_settings(BLOB_ENCRYPTION_KEY=OTHER_KEY):
            header, chunks = encrypt(b"old")

        with override_settings(BLOB_ENCRYPTION_KEY=KEY):
            with blobcrypto.using_key(OTHER_KEY):
                self.assertEqual(decrypt(header, chunks), b"old")
            with self.assertRaises(BlobDecryptionError):
                decrypt(header, chunks)

    def test_key_id_reveals_nothing_of_the_key(self):
        self.assertEqual(len(blobcrypto.key_id(KEY)), 8)
        self.assertNotIn(blobcrypto.key_id(KEY), KEY.encode())
        self.assertNotEqual(blobcrypto.key_id(KEY), blobcrypto.key_id(OTHER_KEY))
