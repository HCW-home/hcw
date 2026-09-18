import io
import logging
import os
import re
import stat
import tempfile
from contextlib import suppress

from django.conf import settings
from django.core.files.base import ContentFile, File
from django.core.files.storage import Storage
from django.db import connection
from django.utils.deconstruct import deconstructible
from django.utils.functional import cached_property
from django.utils.module_loading import import_string

from core import blobcrypto

logger = logging.getLogger(__name__)

# Upload folders holding medical content. Their files are only ever served by
# the API after an access check, never by URL, and are encrypted at rest when
# BLOB_ENCRYPTION is on. Every other upload (organisation logos, speciality
# icons, profile pictures) is linked to directly and stays in clear.
CONFIDENTIAL_FOLDERS = ("messages_attachment",)

# "<schema>/<folder>/<file>" as written by TenantUploadTo, or "<folder>/<file>"
# for the files uploaded before tenants existed.
_CONFIDENTIAL_NAME = re.compile(
    r"^(?:[^/]+/)?(?:%s)/" % "|".join(map(re.escape, CONFIDENTIAL_FOLDERS))
)

# Written at the root of the storage once it holds an encrypted file, so that
# running without BLOB_ENCRYPTION, which would serve ciphertext, fails the
# system checks of `manage.py migrate` (see core.checks).
SENTINEL_NAME = ".blob-encryption"
_SENTINEL_TEXT = (
    b"This storage holds files encrypted at rest by HCW@Home (BLOB_ENCRYPTION).\n"
    b"Without BLOB_ENCRYPTION=True and its key they would be served encrypted,\n"
    b"which `manage.py migrate` refuses as long as this file exists.\n"
    b"`manage.py encrypt_blobs --decrypt` decrypts them and removes it.\n"
)

# Suffix of the file encrypt_blobs writes before swapping it in.
TEMPORARY_SUFFIX = ".hcwcrypt-tmp"


def is_confidential(name):
    """Whether the stored file `name` holds medical content."""
    return bool(_CONFIDENTIAL_NAME.match(str(name).replace("\\", "/")))


class TenantUploadTo:
    """
    Callable upload_to that prefixes the path with the current tenant's
    schema name, e.g. "mytenant/organisations/logo.png".

    Implements deconstruct() so Django migrations can serialize it.
    """

    def __init__(self, subfolder):
        self.subfolder = subfolder

    def __call__(self, instance, filename):
        schema = getattr(connection, "schema_name", None) or "public"
        return os.path.join(schema, self.subfolder, filename)

    def deconstruct(self):
        return (
            "core.storage.TenantUploadTo",
            [self.subfolder],
            {},
        )


@deconstructible(path="core.storage.EncryptedStorage")
class EncryptedStorage(Storage):
    """Encrypts confidential files at rest on top of another storage.

    Installed as the default storage when BLOB_ENCRYPTION is on, around the
    storage that would be used otherwise (filesystem or S3), so every FieldFile
    goes through it without any caller knowing about encryption.

    Reads are decrypted whenever a file starts with the blob magic, whatever
    BLOB_ENCRYPT_WRITES says: that is what lets clear and encrypted files
    coexist while `encrypt_blobs` converts them one by one.

    A confidential file has no local path and no URL, both would lead to
    ciphertext: open() is the only way to its content. path() raises
    NotImplementedError, like on any remote storage. url() raises
    AttributeError, which is how the admin widgets, templates and DRF probe
    for a URL (hasattr, getattr with a default): they render no link rather
    than fail.
    """

    def __init__(
        self, backend="django.core.files.storage.FileSystemStorage", options=None
    ):
        self.backend = backend
        self.options = options or {}
        self._marked = False

    @cached_property
    def inner(self):
        """The storage the bytes actually go to."""
        return import_string(self.backend)(**self.options)

    def encrypts(self, name):
        """Whether a file written now at `name` gets encrypted."""
        return settings.BLOB_ENCRYPT_WRITES and is_confidential(name)

    def _open(self, name, mode="rb"):
        raw = self.inner.open(name, mode)
        if set(mode) != {"r", "b"}:
            return raw
        try:
            head = _read_exact(raw, blobcrypto.HEADER_SIZE)
            if not blobcrypto.looks_encrypted(head):
                raw.seek(0)
                return raw
            header, cipher = blobcrypto.parse_header(head)
        except blobcrypto.BlobDecryptionError as exc:
            raw.close()
            # Most likely a wrong key: loud here, a 404 for the user rather
            # than binary noise.
            logger.error("Cannot decrypt stored file %s: %s", name, exc)
            raise
        except BaseException:
            raw.close()
            raise
        return EncryptedFile(
            raw, name, header, cipher, reopen=lambda: self._open(name)
        )

    def _save(self, name, content):
        if not self.encrypts(name):
            return self.inner._save(name, content)
        name = self.inner._save(name, _EncryptingStream(content, name))
        self.mark_encrypted()
        return name

    def size(self, name):
        """Size of the plaintext, as every caller expects."""
        with self.inner.open(name, "rb") as raw:
            head = _read_exact(raw, blobcrypto.HEADER_SIZE)
        if not blobcrypto.looks_encrypted(head):
            return self.inner.size(name)
        header, _ = blobcrypto.parse_header(head)
        return header.plain_size

    def path(self, name):
        if is_confidential(name):
            raise NotImplementedError(
                "A confidential file may be encrypted at rest: its local path "
                "leads to ciphertext. Read it through open()."
            )
        return self.inner.path(name)

    def url(self, name, *args, **kwargs):
        if is_confidential(name):
            raise AttributeError(
                "A confidential file may be encrypted at rest and has no URL: "
                "serve it through a view that reads it with open()."
            )
        return self.inner.url(name, *args, **kwargs)

    def delete(self, name):
        return self.inner.delete(name)

    def exists(self, name):
        return self.inner.exists(name)

    def listdir(self, path):
        return self.inner.listdir(path)

    def get_valid_name(self, name):
        return self.inner.get_valid_name(name)

    def get_alternative_name(self, file_root, file_ext):
        return self.inner.get_alternative_name(file_root, file_ext)

    def get_available_name(self, name, max_length=None):
        return self.inner.get_available_name(name, max_length=max_length)

    def generate_filename(self, filename):
        return self.inner.generate_filename(filename)

    def get_accessed_time(self, name):
        return self.inner.get_accessed_time(name)

    def get_created_time(self, name):
        return self.inner.get_created_time(name)

    def get_modified_time(self, name):
        return self.inner.get_modified_time(name)

    def encrypted_stream(self, content, name):
        """Ciphertext of `content` under the current key, for encrypt_blobs."""
        return _EncryptingStream(content, name)

    def replace_raw(self, name, content):
        """Store `content` as the exact bytes of `name`, replacing it atomically.

        No encryption and no renaming: this is how encrypt_blobs rewrites a file
        in place. A crash leaves the old file or the new one, never a mix.
        """
        try:
            full_path = self.inner.path(name)
        except NotImplementedError:
            # Object stores (S3) swap an object atomically on PUT.
            self.inner._save(name, content)
            return
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        tmp_path = full_path + TEMPORARY_SUFFIX
        try:
            with open(tmp_path, "wb") as tmp:
                for chunk in content.chunks():
                    tmp.write(chunk)
                tmp.flush()
                os.fsync(tmp.fileno())
            with suppress(FileNotFoundError):
                # Keep the mode and the owner of the file being replaced, the
                # command may not run as the same user as the application.
                current = os.stat(full_path)
                os.chmod(tmp_path, stat.S_IMODE(current.st_mode))
                with suppress(PermissionError):
                    os.chown(tmp_path, current.st_uid, current.st_gid)
            os.replace(tmp_path, full_path)
        except BaseException:
            with suppress(FileNotFoundError):
                os.remove(tmp_path)
            raise

    def mark_encrypted(self):
        """Leave the sentinel saying this storage holds encrypted files."""
        if self._marked:
            return
        if not self.inner.exists(SENTINEL_NAME):
            self.replace_raw(SENTINEL_NAME, ContentFile(_SENTINEL_TEXT))
        self._marked = True

    def unmark_encrypted(self):
        """Remove the sentinel, once no encrypted file is left."""
        self.inner.delete(SENTINEL_NAME)
        self._marked = False


class EncryptedFile(File):
    """Seekable plaintext view of an encrypted blob.

    Decrypts one chunk at a time and only when read: seek() does no I/O, and
    reads stop at the authenticated plaintext size. size is the plaintext's,
    so FileResponse sends the right Content-Length.
    """

    def __init__(self, raw, name, header, cipher, reopen):
        reader = _PlaintextReader(raw, header, cipher)
        # Buffer one chunk: FileResponse reads 4 KiB at a time, and each read
        # must not decrypt its chunk again.
        super().__init__(io.BufferedReader(reader, header.chunk_size), name)
        self.size = header.plain_size
        self._reopen = reopen

    def open(self, mode=None):
        # FieldFile.open() calls this on a handle it already holds. File.open()
        # would reopen a closed file by name from the filesystem, that is the
        # ciphertext: go back through the storage instead.
        if self.closed:
            fresh = self._reopen()
            self.file, self.size = fresh.file, fresh.size
        else:
            self.seek(0)
        return self


class _PlaintextReader(io.RawIOBase):
    """Plaintext of a blob, decrypted chunk by chunk out of the raw handle.

    Has no fileno(): a WSGI server handed one would sendfile() the ciphertext.
    """

    def __init__(self, raw, header, cipher):
        self._raw = raw
        self._header = header
        self._cipher = cipher
        self._pos = 0
        # A single chunk is enough for both real patterns, sequential reads
        # and a seek followed by a read.
        self._chunk_index = None
        self._chunk = b""

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self._pos

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            pos = offset
        elif whence == io.SEEK_CUR:
            pos = self._pos + offset
        elif whence == io.SEEK_END:
            pos = self._header.plain_size + offset
        else:
            raise ValueError(f"invalid whence ({whence})")
        if pos < 0:
            raise ValueError(f"negative seek position {pos}")
        self._pos = pos
        return pos

    def readinto(self, buffer):
        if self._pos >= self._header.plain_size:
            return 0
        index, offset = divmod(self._pos, self._header.chunk_size)
        chunk = self._load(index)
        count = min(len(buffer), len(chunk) - offset)
        buffer[:count] = chunk[offset : offset + count]
        self._pos += count
        return count

    def _load(self, index):
        if index != self._chunk_index:
            chunk_size = self._header.chunk_size
            length = min(chunk_size, self._header.plain_size - index * chunk_size)
            self._raw.seek(
                blobcrypto.HEADER_SIZE + index * (chunk_size + blobcrypto.TAG_SIZE)
            )
            sealed = _read_exact(self._raw, length + blobcrypto.TAG_SIZE)
            if len(sealed) != length + blobcrypto.TAG_SIZE:
                raise blobcrypto.BlobDecryptionError(
                    f"chunk {index} is truncated: the file is damaged"
                )
            self._chunk = self._cipher.open_chunk(index, sealed)
            self._chunk_index = index
        return self._chunk

    def close(self):
        if not self.closed:
            self._raw.close()
        super().close()


class _EncryptingStream:
    """Ciphertext of `content`, encrypted on the fly while it is read.

    Forward only: seekable() says no, so that neither Django's File.chunks()
    nor boto3 tries to rewind it. And it has no temporary_file_path():
    FileSystemStorage._save() moves a file that has one into place as is,
    which would store every upload above FILE_UPLOAD_MAX_MEMORY_SIZE in clear.
    """

    # What S3 records as the object's Content-Type: the bytes are no PDF anymore.
    content_type = "application/octet-stream"

    def __init__(self, content, name):
        self.name = name
        source, plain_size = _sized_source(content, name)
        header, cipher = blobcrypto.build_header(plain_size)
        self.size = blobcrypto.ciphertext_size(plain_size)
        self._pieces = self._encrypt(source, plain_size, header, cipher)
        self._pending = b""
        self.closed = False

    def _encrypt(self, source, plain_size, header, cipher):
        yield header
        index, remaining = 0, plain_size
        while remaining:
            wanted = min(blobcrypto.CHUNK_SIZE, remaining)
            data = _read_exact(source, wanted)
            if len(data) != wanted:
                raise ValueError(
                    f"{self.name}: content ended {remaining - len(data)} bytes "
                    "before its announced size"
                )
            yield cipher.seal_chunk(index, data)
            index += 1
            remaining -= wanted
        if source.read(1):
            raise ValueError(f"{self.name}: content is longer than its announced size")

    def seekable(self):
        return False

    def readable(self):
        return True

    def chunks(self, chunk_size=None):
        if self._pending:
            yield self._pending
            self._pending = b""
        yield from self._pieces

    def read(self, size=-1):
        parts, available = [self._pending], len(self._pending)
        while size is None or size < 0 or available < size:
            piece = next(self._pieces, b"")
            if not piece:
                break
            parts.append(piece)
            available += len(piece)
        data = b"".join(parts)
        if size is None or size < 0:
            self._pending = b""
            return data
        self._pending = data[size:]
        return data[:size]

    def close(self):
        self.closed = True


def _sized_source(content, name):
    """`content` rewound, and its size, which the blob header needs upfront."""
    with suppress(AttributeError, io.UnsupportedOperation):
        content.seek(0)
    size = getattr(content, "size", None)
    if size is not None:
        return content, size
    # Every caller gives a size today: say so when one does not, rather than
    # silently spooling uploads of any size.
    logger.warning(
        "Encrypting %s from content of unknown size: buffering it first", name
    )
    spool = tempfile.SpooledTemporaryFile(
        max_size=settings.FILE_UPLOAD_MAX_MEMORY_SIZE
    )
    chunks = content.chunks() if hasattr(content, "chunks") else iter(
        lambda: content.read(blobcrypto.CHUNK_SIZE), b""
    )
    for chunk in chunks:
        spool.write(chunk)
    size = spool.tell()
    spool.seek(0)
    return spool, size


def _read_exact(fileobj, size):
    """Read `size` bytes, fewer only at the end of the file."""
    parts = []
    while size > 0:
        data = fileobj.read(size)
        if not data:
            break
        parts.append(data)
        size -= len(data)
    return b"".join(parts)
