import csv
import hashlib
import json
import logging
import os
import re
import tempfile
import time
import zipfile

import requests as http_requests
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from consultations.models import CustomField, CustomFieldValue
from users.models import Organisation, Speciality, User

logger = logging.getLogger(__name__)

DATASET_API_URL = (
    "https://www.data.gouv.fr/api/1/datasets/"
    "annuaire-sante-extractions-des-donnees-en-libre-acces-"
    "des-professionnels-intervenant-dans-le-systeme-de-sante-rpps/"
)
TABULAR_API_URL = "https://tabular-api.data.gouv.fr/api/resources/{rid}/data/"
# The tabular API rejects any page larger than that.
TABULAR_MAX_PAGE_SIZE = 200
TABULAR_MAX_RETRIES = 5

# Title keywords identifying the "personne / activité" extraction among the
# three files published in the dataset.
RESOURCE_KEYWORDS = ("ps-libreacces", "personne", "activite")

# data.gouv.fr parses every tabular resource into Parquet and exposes the result
# in the resource extras.
PARQUET_URL_EXTRA = "analysis:parsing:parquet_url"
CHECKSUM_EXTRA = "analysis:checksum"

# Downloads are cached under a name derived from the dataset checksum, so that
# consecutive runs reuse the file instead of piling up ~800 MB temporaries.
CACHE_DIR_NAME = "rpps-import-cache"

STATE_VERSION = 1
PROGRESS_INTERVAL = 5.0  # seconds between two progress lines

# The pipe-delimited file, the Parquet export and the tabular API all expose the
# very same 56 columns, so a single name-based mapping feeds all three sources.
COL_RPPS = "Identifiant PP"
COL_NOM = "Nom d'exercice"
COL_PRENOM = "Prénom d'exercice"
COL_CODE_PROFESSION = "Code profession"
COL_PROFESSION = "Libellé profession"
COL_SAVOIR_FAIRE = "Libellé savoir-faire"
# Historical mapping kept as-is: this import has always stored the mode code
# ("S", "L", ...) rather than "Libellé mode exercice", and has always fed the
# "SIRET" / "FINESS" custom fields from the SIREN and legal-entity FINESS
# columns.
COL_MODE_EXERCICE = "Code mode exercice"
COL_SIRET = "Numéro SIREN site"
COL_FINESS = "Numéro FINESS établissement juridique"
COL_ID_STRUCTURE = "Identifiant technique de la structure"
COL_RAISON_SOCIALE = "Raison sociale site"
COL_NUMERO_VOIE = "Numéro Voie (coord. structure)"
COL_TYPE_VOIE = "Libellé type de voie (coord. structure)"
COL_LIBELLE_VOIE = "Libellé Voie (coord. structure)"
COL_CODE_POSTAL = "Code postal (coord. structure)"
COL_CODE_COMMUNE = "Code commune (coord. structure)"
COL_COMMUNE = "Libellé commune (coord. structure)"
COL_PAYS = "Libellé pays (coord. structure)"
COL_TELEPHONE = "Téléphone (coord. structure)"
COL_EMAIL = "Adresse e-mail (coord. structure)"

USED_COLUMNS = [
    COL_RPPS,
    COL_NOM,
    COL_PRENOM,
    COL_CODE_PROFESSION,
    COL_PROFESSION,
    COL_SAVOIR_FAIRE,
    COL_MODE_EXERCICE,
    COL_SIRET,
    COL_FINESS,
    COL_ID_STRUCTURE,
    COL_RAISON_SOCIALE,
    COL_NUMERO_VOIE,
    COL_TYPE_VOIE,
    COL_LIBELLE_VOIE,
    COL_CODE_POSTAL,
    COL_CODE_COMMUNE,
    COL_COMMUNE,
    COL_PAYS,
    COL_TELEPHONE,
    COL_EMAIL,
]

# The dataset never fills the "Code / Libellé Département (structure)" columns,
# so a department is matched on the INSEE commune code, which always starts with
# the department number ("2A"/"2B" in Corsica, three digits overseas).
DEPARTEMENT_RE = re.compile(r"^(\d{2}|2[AB]|\d{3})$")

# Mirrors the tabular API operators so that --filter behaves the same way when
# reading a local file. Comparisons are textual, which is what the fixed-width
# codes of this dataset call for.
LOCAL_FILTER_OPERATORS = {
    "exact": lambda cell, value: cell == value,
    "differs": lambda cell, value: cell != value,
    "contains": lambda cell, value: value in cell,
    "less": lambda cell, value: cell <= value,
    "greater": lambda cell, value: cell >= value,
    "strictly_less": lambda cell, value: cell < value,
    "strictly_greater": lambda cell, value: cell > value,
    "notin": lambda cell, value: cell not in [
        part.strip() for part in value.split(",")
    ],
}

PRACTITIONER_CUSTOM_FIELDS = [
    ("RPPS", "short_text"),
    ("Mode d'exercice", "short_text"),
]

ORGANISATION_CUSTOM_FIELDS = [
    ("Identifiant structure", "short_text"),
    ("SIRET", "short_text"),
    ("FINESS", "short_text"),
]


def _text(value):
    """Normalise a raw cell coming from any source into a stripped string."""
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, float):
        # Parquet may type a nullable integer column as float; keep an RPPS from
        # being rendered as "10000001304.0".
        return str(int(value)) if value.is_integer() else str(value)
    return str(value).strip()


def _slug(title):
    return re.sub(r"[^a-z0-9]+", "-", (title or "").lower())


def _humanize_duration(seconds):
    seconds = int(seconds)
    if seconds >= 3600:
        return f"{seconds // 3600}h{(seconds % 3600) // 60:02d}m"
    if seconds >= 60:
        return f"{seconds // 60}m{seconds % 60:02d}s"
    return f"{seconds}s"


class Command(BaseCommand):
    help = (
        "Import practitioners from the RPPS dataset (data.gouv.fr). "
        "Practitioners nobody can reach — no postal address, no email and no "
        "phone number, neither on their own rows nor through their structure — "
        "are left out."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--file", help="Path to a local RPPS file (.txt/.csv/.zip/.parquet)"
        )
        parser.add_argument(
            "--url", help="Direct download URL (skip API discovery)"
        )
        parser.add_argument(
            "--source",
            choices=["auto", "txt", "parquet", "api"],
            default="auto",
            help=(
                "Where to read the data from: 'parquet' (~140 MB instead of "
                "~800 MB), 'api' for the data.gouv.fr tabular API (server-side "
                "filtering, best with --profession-code/--filter), 'txt' for "
                "the raw pipe-delimited file. 'auto' picks parquet when "
                "pyarrow is installed, txt otherwise."
            ),
        )
        parser.add_argument(
            "--profession-code",
            help="Filter by profession code (e.g. 40=Dentiste, 50=Sage-Femme)",
        )
        parser.add_argument(
            "--departement",
            help=(
                "Only import practitioners working in that department "
                "(e.g. 75, 2A, 974). Matched on the INSEE commune code of the "
                "structure, the department columns being empty in the dataset; "
                "rows without a structure are therefore left out."
            ),
        )
        parser.add_argument(
            "--filter",
            action="append",
            dest="filters",
            default=[],
            metavar="COLUMN__OPERATOR=VALUE",
            help=(
                "Extra column filter, repeatable, e.g. --filter "
                "'Code postal (coord. structure)__exact=75014'. Pushed down to "
                "the tabular API, applied while reading for the other sources. "
                f"Operators: {', '.join(sorted(LOCAL_FILTER_OPERATORS))}, isnull."
            ),
        )
        parser.add_argument(
            "--page-size",
            type=int,
            default=TABULAR_MAX_PAGE_SIZE,
            help=f"Tabular API page size (max {TABULAR_MAX_PAGE_SIZE})",
        )
        parser.add_argument(
            "--batch-size", type=int, default=500, help="Transaction batch size"
        )
        parser.add_argument(
            "--state-file",
            help="Progress file used to resume an interrupted import",
        )
        parser.add_argument(
            "--restart",
            action="store_true",
            help="Ignore any saved progress and import from the first row",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and report stats without writing to DB",
        )

    def handle(self, *args, **options):
        self.state_path = None
        try:
            self._do_import(options)
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("\nInterrupted."))
            if self.state_path and os.path.exists(self.state_path):
                self.stdout.write(
                    f"Progress saved in {self.state_path} — rerun the same "
                    "command to resume."
                )

    def _do_import(self, options):
        if options["page_size"] > TABULAR_MAX_PAGE_SIZE:
            raise CommandError(
                f"--page-size cannot exceed {TABULAR_MAX_PAGE_SIZE}"
            )

        self.state_path = self._resolve_state_path(options)
        state = self._load_state(options)
        specs = self._parse_filter_specs(options)
        source = self._resolve_source(options, specs)

        # A filter may target a column the import does not otherwise read.
        source["columns"] = USED_COLUMNS + [
            column for column, _, _ in specs if column not in USED_COLUMNS
        ]
        # The tabular API filters server-side; the file sources filter here.
        source["predicates"] = (
            [] if source["kind"] == "api" else self._local_predicates(specs)
        )

        key = self._state_key(source, options, specs)
        if state and state.get("key") != key:
            self.stdout.write(
                self.style.WARNING(
                    "Saved progress does not match this run (source, filters or "
                    "dataset changed) — starting over."
                )
            )
            state = None

        start = state.get("position", 0) if state else 0
        stats = {
            "created": 0, "updated": 0, "skipped": 0,
            "unreachable": 0, "errors": 0,
        }
        if state and state.get("stats"):
            stats.update(state["stats"])
        if start:
            self.stdout.write(
                self.style.WARNING(f"Resuming at row {start:,} of the source.")
            )

        custom_fields = self._ensure_custom_fields(options["dry_run"])
        self._import_rows(source, custom_fields, options, key, start, stats)

    # ── Source resolution ───────────────────────────────────────────────

    def _resolve_source(self, options, specs):
        kind = options["source"]

        if options.get("file"):
            path = options["file"]
            if not os.path.exists(path):
                raise CommandError(f"File not found: {path}")
            if kind == "api":
                raise CommandError("--file cannot be combined with --source api")
            if kind == "auto":
                kind = "parquet" if path.endswith(".parquet") else "txt"
            if kind == "parquet":
                self._import_parquet_module()
            return {
                "kind": kind,
                "path": path,
                # A local file has no dataset checksum: fall back on its size
                # and mtime so that replacing it invalidates saved progress.
                "checksum": f"{os.path.getsize(path)}:{int(os.path.getmtime(path))}",
                "resource_id": os.path.abspath(path),
            }

        if options.get("url"):
            if kind == "api":
                raise CommandError("--url cannot be combined with --source api")
            if kind == "auto":
                kind = "parquet" if options["url"].endswith(".parquet") else "txt"
            source = {"kind": kind, "checksum": options["url"], "resource_id": options["url"]}
            source["path"] = self._fetch_source_file(options["url"], source)
            return source

        resource = self._discover_resource()
        extras = resource.get("extras") or {}
        parquet_url = extras.get(PARQUET_URL_EXTRA)

        if kind == "auto":
            if parquet_url and self._import_parquet_module(required=False):
                kind = "parquet"
            else:
                kind = "txt"
                if parquet_url:
                    self.stdout.write(
                        "pyarrow is not installed, falling back to the raw file "
                        "(install pyarrow for a ~6x smaller download)."
                    )

        source = {
            "kind": kind,
            "resource_id": resource.get("id"),
            "checksum": extras.get(CHECKSUM_EXTRA) or resource.get("url"),
        }

        if kind == "api":
            source["rid"] = resource["id"]
            source["filters"] = self._api_filters(options, specs)
            return source

        if kind == "parquet":
            self._import_parquet_module()
            if not parquet_url:
                raise CommandError(
                    "data.gouv.fr has no Parquet export for this resource yet, "
                    "use --source txt."
                )
            url = parquet_url
        else:
            url = resource["url"]

        source["path"] = self._fetch_source_file(url, source)
        return source

    def _discover_resource(self):
        self.stdout.write("Fetching dataset metadata from data.gouv.fr...")
        resp = http_requests.get(DATASET_API_URL, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        for resource in data.get("resources", []):
            slug = _slug(resource.get("title"))
            if all(keyword in slug for keyword in RESOURCE_KEYWORDS):
                self.stdout.write(f"Found resource: {resource['title']}")
                return resource

        raise CommandError(
            "Could not find the PS_LibreAcces personne/activité resource in the "
            "dataset. Use --url to provide a direct download URL."
        )

    def _fetch_source_file(self, url, source):
        """Return the local copy of the source, downloading it once per release."""
        suffix = ".parquet" if url.lower().endswith(".parquet") else ".txt"
        path = self._cache_path(source["checksum"], suffix)
        if os.path.exists(path):
            self.stdout.write(f"Reusing cached file: {path}")
            return path

        self._download(url, path)
        self._purge_cache(keep=path)
        return path

    def _cache_path(self, checksum, suffix):
        cache_dir = os.path.join(tempfile.gettempdir(), CACHE_DIR_NAME)
        os.makedirs(cache_dir, exist_ok=True)
        # The checksum may be a URL, so hash it into a safe file name.
        digest = hashlib.sha1(str(checksum).encode()).hexdigest()[:16]
        return os.path.join(cache_dir, f"{digest}{suffix}")

    def _purge_cache(self, keep):
        """Drop the files of previous dataset releases."""
        cache_dir = os.path.dirname(keep)
        for name in os.listdir(cache_dir):
            path = os.path.join(cache_dir, name)
            if path == keep or not os.path.isfile(path):
                continue
            try:
                os.remove(path)
                self.stdout.write(f"Removed outdated cached file: {path}")
            except OSError as exc:
                self.stderr.write(f"Could not remove {path}: {exc}")

    def _download(self, url, target):
        self.stdout.write(f"Downloading {url}...")
        resp = http_requests.get(url, stream=True, timeout=300)
        resp.raise_for_status()

        expected = int(resp.headers.get("content-length") or 0)
        # Download aside, then move into place: an interrupted run never leaves
        # a truncated file behind that the next one would happily read.
        partial = f"{target}.part"
        total = 0
        last_print = time.monotonic()
        with open(partial, "wb") as handle:
            for chunk in resp.iter_content(chunk_size=1024 * 256):
                handle.write(chunk)
                total += len(chunk)
                now = time.monotonic()
                if now - last_print >= PROGRESS_INTERVAL:
                    last_print = now
                    done = f"{total / 1024 / 1024:.0f} MB"
                    if expected:
                        done += f" / {expected / 1024 / 1024:.0f} MB"
                    self.stdout.write(f"  {done}", ending="\r")
                    self.stdout.flush()
        self.stdout.write(f"Downloaded {total / 1024 / 1024:.1f} MB")

        if zipfile.is_zipfile(partial):
            self._extract_zip(partial, target)
            os.remove(partial)
        else:
            os.replace(partial, target)
        return target

    def _extract_zip(self, zip_path, target):
        self.stdout.write("Extracting ZIP...")
        with zipfile.ZipFile(zip_path, "r") as zf:
            names = zf.namelist()
            txt_files = [
                n for n in names if n.lower().endswith((".txt", ".csv"))
            ]
            if not txt_files:
                raise CommandError(f"No .txt/.csv file found in ZIP: {names}")
            member = txt_files[0]
            self.stdout.write(f"Extracting: {member}")
            with zf.open(member) as source_file, open(f"{target}.part", "wb") as out:
                while chunk := source_file.read(1024 * 256):
                    out.write(chunk)
        os.replace(f"{target}.part", target)
        return target

    def _import_parquet_module(self, required=True):
        try:
            import pyarrow.dataset as parquet_dataset
        except ImportError:
            if not required:
                return None
            raise CommandError(
                "Reading Parquet requires pyarrow: pip install pyarrow"
            )
        return parquet_dataset

    def _parse_filter_specs(self, options):
        """Turn --departement and --filter into (column, operator, value)."""
        specs = []

        departement = (options.get("departement") or "").strip().upper()
        if departement:
            if not DEPARTEMENT_RE.match(departement):
                raise CommandError(
                    f"Invalid --departement {departement!r}, expected something "
                    "like 75, 2A or 974"
                )
            # INSEE commune codes are 5 characters wide, so the department is a
            # prefix range: 75 -> 75000..75999, 974 -> 97400..97499.
            padding = 5 - len(departement)
            specs.append(
                (COL_CODE_COMMUNE, "greater", departement + "0" * padding)
            )
            specs.append(
                (COL_CODE_COMMUNE, "less", departement + "9" * padding)
            )

        for raw in options.get("filters") or []:
            if "=" not in raw:
                raise CommandError(
                    f"Invalid --filter {raw!r}, expected COLUMN__OPERATOR=VALUE"
                )
            name, value = raw.split("=", 1)
            if "__" not in name:
                raise CommandError(
                    f"Invalid --filter {raw!r}: no operator, expected "
                    "COLUMN__OPERATOR=VALUE"
                )
            column, operator = name.strip().rsplit("__", 1)
            if operator != "isnull" and operator not in LOCAL_FILTER_OPERATORS:
                raise CommandError(
                    f"Unsupported filter operator {operator!r}, pick one of: "
                    f"{', '.join(sorted(LOCAL_FILTER_OPERATORS))}, isnull"
                )
            specs.append((column, operator, value.strip()))

        return specs

    def _api_filters(self, options, specs):
        filters = {
            f"{column}__{operator}": value for column, operator, value in specs
        }
        if options.get("profession_code"):
            filters[f"{COL_CODE_PROFESSION}__exact"] = options["profession_code"]
        return filters

    def _local_predicates(self, specs):
        return [
            (column, self._predicate(operator, value))
            for column, operator, value in specs
        ]

    def _predicate(self, operator, value):
        if operator == "isnull":
            wants_null = value.lower() in ("true", "1", "yes")
            return lambda cell: (not cell) if wants_null else bool(cell)
        compare = LOCAL_FILTER_OPERATORS[operator]
        # An empty cell is this dataset's NULL: like in SQL, it matches nothing.
        return lambda cell: bool(cell) and compare(cell, value)

    # ── Row iteration ───────────────────────────────────────────────────

    def _count_source_rows(self, source, options):
        """Total number of source rows, or None when it cannot be known cheaply."""
        if source["kind"] == "parquet":
            module = self._import_parquet_module()
            return module.dataset(source["path"], format="parquet").count_rows()
        if source["kind"] == "api":
            payload = self._api_get(
                TABULAR_API_URL.format(rid=source["rid"]),
                {**source["filters"], "page": 1, "page_size": 1},
            )
            return (payload.get("meta") or {}).get("total")
        # Counting the lines of the raw file would mean reading ~800 MB twice.
        return None

    def _iter_rows(self, source, options, start):
        columns = source["columns"]
        if source["kind"] == "parquet":
            return self._iter_parquet(source["path"], columns, start)
        if source["kind"] == "api":
            return self._iter_tabular_api(
                source["rid"], source["filters"], columns,
                options["page_size"], start,
            )
        return self._iter_flat_file(source["path"], columns, start)

    def _iter_flat_file(self, path, columns, start):
        encoding = self._detect_encoding(path)
        with open(path, "r", encoding=encoding, errors="replace") as f:
            reader = csv.reader(f, delimiter="|")
            header = next(reader, None)
            if not header:
                raise CommandError("Empty file")

            positions = {}
            for name in columns:
                if name not in header:
                    raise CommandError(f"Missing column in file header: {name}")
                positions[name] = header.index(name)
            width = max(positions.values()) + 1

            for index, raw in enumerate(reader, start=1):
                if index <= start:
                    continue
                if len(raw) < width:
                    continue
                yield index, {
                    name: _text(raw[pos]) for name, pos in positions.items()
                }

    def _iter_parquet(self, path, columns, start):
        module = self._import_parquet_module()
        dataset = module.dataset(path, format="parquet")
        missing = [c for c in columns if c not in dataset.schema.names]
        if missing:
            raise CommandError(f"Missing columns in Parquet file: {missing}")

        index = 0
        scanner = dataset.scanner(columns=columns, batch_size=8192)
        for batch in scanner.to_batches():
            rows = batch.num_rows
            # Skip whole batches without materialising them when resuming.
            if index + rows <= start:
                index += rows
                continue
            values_by_column = {
                name: batch.column(name).to_pylist() for name in columns
            }
            for offset in range(rows):
                index += 1
                if index <= start:
                    continue
                yield index, {
                    name: _text(values[offset])
                    for name, values in values_by_column.items()
                }

    def _iter_tabular_api(self, rid, filters, columns, page_size, start):
        url = TABULAR_API_URL.format(rid=rid)
        # Resume on a page boundary, then drop the rows already imported.
        page = start // page_size + 1
        index = (page - 1) * page_size

        while True:
            payload = self._api_get(
                url, {**filters, "page": page, "page_size": page_size}
            )
            rows = payload.get("data") or []
            if not rows:
                return
            for row in rows:
                index += 1
                if index <= start:
                    continue
                yield index, {name: _text(row.get(name)) for name in columns}
            if not (payload.get("links") or {}).get("next"):
                return
            page += 1

    def _api_get(self, url, params):
        delay = 1
        for attempt in range(1, TABULAR_MAX_RETRIES + 1):
            try:
                resp = http_requests.get(url, params=params, timeout=60)
                if resp.status_code == 429 or resp.status_code >= 500:
                    raise http_requests.HTTPError(f"HTTP {resp.status_code}")
                if resp.status_code == 400:
                    # Unknown column or operator: retrying will not help.
                    raise CommandError(
                        f"Tabular API rejected the request: {resp.text}"
                    )
                resp.raise_for_status()
                return resp.json()
            except CommandError:
                raise
            except Exception as exc:
                if attempt == TABULAR_MAX_RETRIES:
                    raise CommandError(f"Tabular API request failed: {exc}")
                self.stderr.write(
                    f"API error ({exc}), retrying in {delay}s "
                    f"[{attempt}/{TABULAR_MAX_RETRIES}]"
                )
                time.sleep(delay)
                delay = min(delay * 2, 30)

    def _detect_encoding(self, file_path):
        with open(file_path, "rb") as f:
            raw = f.read(4096)
        if raw.startswith(b"\xef\xbb\xbf"):
            return "utf-8-sig"
        try:
            raw.decode("utf-8")
            return "utf-8"
        except UnicodeDecodeError:
            return "latin-1"

    # ── Progress state ──────────────────────────────────────────────────

    def _resolve_state_path(self, options):
        if options["dry_run"]:
            return None
        if options.get("state_file"):
            return options["state_file"]
        schema = getattr(connection, "schema_name", "public")
        return os.path.join(
            tempfile.gettempdir(), f"import_rpps.{schema}.state.json"
        )

    def _state_key(self, source, options, specs):
        """Identity of a run: saved progress is only reused for the same one."""
        return {
            "version": STATE_VERSION,
            "schema": getattr(connection, "schema_name", "public"),
            "kind": source["kind"],
            "resource_id": source.get("resource_id"),
            "checksum": source.get("checksum"),
            "profession_code": options.get("profession_code") or None,
            "filters": sorted(
                f"{column}__{operator}={value}"
                for column, operator, value in specs
            ),
        }

    def _load_state(self, options):
        if not self.state_path:
            return None
        if options["restart"]:
            self._clear_state()
            return None
        if not os.path.exists(self.state_path):
            return None
        try:
            with open(self.state_path, "r", encoding="utf-8") as handle:
                state = json.load(handle)
        except (OSError, ValueError) as exc:
            self.stderr.write(f"Ignoring unreadable progress file: {exc}")
            return None
        key = state.get("key")
        if not isinstance(key, dict) or key.get("version") != STATE_VERSION:
            return None
        return state

    def _save_state(self, key, position, stats, source, total):
        if not self.state_path:
            return
        payload = {
            "key": key,
            "position": position,
            "total": total,
            "stats": stats,
            "source_path": source.get("path"),
            "updated_at": timezone.now().isoformat(),
        }
        tmp_path = f"{self.state_path}.tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
            os.replace(tmp_path, self.state_path)
        except OSError as exc:
            self.stderr.write(f"Could not write progress file: {exc}")

    def _clear_state(self):
        if self.state_path and os.path.exists(self.state_path):
            try:
                os.remove(self.state_path)
            except OSError as exc:
                self.stderr.write(f"Could not remove progress file: {exc}")

    def _print_progress(self, position, total, started_at, start, stats,
                        final=False):
        elapsed = max(time.monotonic() - started_at, 0.001)
        # Rate and ETA only count the rows this run actually walked through, so
        # that a resumed run does not report the skipped prefix as throughput.
        rate = (position - start) / elapsed
        message = f"  {position:,} rows"
        if total:
            message += f" / {total:,} ({position * 100 / total:.1f}%)"
        message += f" · {rate:,.0f} rows/s"
        if total and rate > 0 and position < total:
            message += f" · ETA {_humanize_duration((total - position) / rate)}"
        message += (
            f" · +{stats['created']} ~{stats['updated']} "
            f"-{stats['unreachable']} !{stats['errors']}"
        )
        self.stdout.write(message, ending="\n" if final else "\r")
        self.stdout.flush()

    # ── Custom fields ───────────────────────────────────────────────────

    def _ensure_custom_fields(self, dry_run):
        fields = {}
        for name, field_type, target in (
            [(n, t, "users.Practitioner") for n, t in PRACTITIONER_CUSTOM_FIELDS]
            + [(n, t, "users.Organisation") for n, t in ORGANISATION_CUSTOM_FIELDS]
        ):
            if dry_run:
                obj = CustomField.objects.filter(
                    name=name, target_model=target
                ).first()
            else:
                obj, _ = CustomField.objects.get_or_create(
                    name=name,
                    target_model=target,
                    defaults={"field_type": field_type},
                )
            fields[name] = obj
        return fields

    # ── Import logic ────────────────────────────────────────────────────

    def _import_rows(self, source, custom_fields, options, key, start, stats):
        profession_filter = options.get("profession_code")
        predicates = source["predicates"]
        batch_size = options["batch_size"]
        dry_run = options["dry_run"]

        # Pre-load existing RPPS -> user_pk mapping
        rpps_field = custom_fields.get("RPPS")
        existing_rpps = {}
        if rpps_field:
            ct = ContentType.objects.get_for_model(User)
            existing_rpps = dict(
                CustomFieldValue.objects.filter(
                    custom_field=rpps_field, content_type=ct
                ).values_list("value", "object_id")
            )

        # Pre-load existing structure ID -> organisation_pk mapping
        id_struct_field = custom_fields.get("Identifiant structure")
        existing_orgs = {}
        if id_struct_field:
            org_ct = ContentType.objects.get_for_model(Organisation)
            existing_orgs = dict(
                CustomFieldValue.objects.filter(
                    custom_field=id_struct_field, content_type=org_ct
                ).values_list("value", "object_id")
            )

        # Structures already known to record a postal address: a practitioner
        # whose own row carries no contact detail is still reachable through
        # one of them.
        addressed = set(
            Organisation.objects.exclude(
                Q(postal_code__isnull=True) | Q(postal_code="")
            ).values_list("pk", flat=True)
        )
        self._orgs_with_address = {
            structure for structure, pk in existing_orgs.items() if pk in addressed
        }

        # Pre-load specialities
        speciality_cache = {s.name: s for s in Speciality.objects.all()}

        # Pre-load who holds which address. Compared lowercased: the database
        # uniqueness is case-sensitive but every lookup in the app is not, so
        # "John@x.org" next to "john@x.org" would create an account nobody can
        # log into.
        self._email_owner = {
            email.lower(): (pk, imported)
            for email, pk, imported in User.objects.filter(
                email__isnull=False
            ).values_list("email", "pk", "imported")
        }
        self._shared_emails = set()

        # Only the first activity row of a practitioner is imported. When
        # resuming, the rows already handled are exactly the ones sitting in the
        # database, so seeding from them keeps a later activity row of the same
        # practitioner from overwriting what the interrupted run imported.
        seen_rpps = set(existing_rpps) if start else set()

        total = self._count_source_rows(source, options)
        self.stdout.write(
            f"Importing from {source['kind']} source"
            + (f" ({total:,} rows)" if total else "")
            + "..."
        )

        started_at = time.monotonic()
        last_progress = started_at
        position = start
        batch = []

        for position, row in self._iter_rows(source, options, start):
            rpps = row[COL_RPPS]
            if not rpps:
                continue

            if profession_filter and row[COL_CODE_PROFESSION] != profession_filter:
                continue

            # Filtered out rows must not mark the practitioner as seen: another
            # activity row of theirs may still match.
            if any(not matches(row[column]) for column, matches in predicates):
                continue

            structure = row[COL_ID_STRUCTURE]
            if structure and self._row_has_address(row):
                self._orgs_with_address.add(structure)

            if rpps in seen_rpps:
                stats["skipped"] += 1
                continue

            if not self._is_reachable(row):
                stats["unreachable"] += 1
                # Deliberately not marked as seen: a later activity row of the
                # same practitioner may carry the contact details this one
                # lacks, and that row should still bring them in.
                continue

            seen_rpps.add(rpps)

            batch.append(row)

            if len(batch) >= batch_size:
                self._flush_batch(
                    batch, custom_fields, existing_rpps, existing_orgs,
                    speciality_cache, stats, dry_run,
                )
                batch = []
                self._save_state(key, position, stats, source, total)

            now = time.monotonic()
            if now - last_progress >= PROGRESS_INTERVAL:
                last_progress = now
                self._print_progress(position, total, started_at, start, stats)

        if batch:
            self._flush_batch(
                batch, custom_fields, existing_rpps, existing_orgs,
                speciality_cache, stats, dry_run,
            )

        self._print_progress(position, total, started_at, start, stats, final=True)
        # The run went through: drop the progress file so the next one starts
        # from the first row.
        self._clear_state()

        processed = sum(stats.values())
        self.stdout.write(
            self.style.SUCCESS(
                f"\nProcessed: {processed} rows\n"
                f"  Created: {stats['created']}\n"
                f"  Updated: {stats['updated']}\n"
                f"  Skipped (duplicates): {stats['skipped']}\n"
                f"  Skipped (no address, email nor phone): "
                f"{stats['unreachable']}\n"
                f"  Errors: {stats['errors']}"
            )
        )

    def _flush_batch(self, batch, custom_fields, existing_rpps, existing_orgs,
                     speciality_cache, stats, dry_run):
        if dry_run:
            self._dry_run_batch(batch, existing_rpps, stats)
        else:
            self._process_batch(
                batch, custom_fields, existing_rpps, existing_orgs,
                speciality_cache, stats,
            )

    def _dry_run_batch(self, rows, existing_rpps, stats):
        for row in rows:
            if row[COL_RPPS] in existing_rpps:
                stats["updated"] += 1
            else:
                stats["created"] += 1

    def _process_batch(self, rows, custom_fields, existing_rpps, existing_orgs, speciality_cache, stats):
        user_ct = ContentType.objects.get_for_model(User)
        org_ct = ContentType.objects.get_for_model(Organisation)

        with transaction.atomic():
            for row in rows:
                try:
                    with transaction.atomic():
                        self._process_row(
                            row, custom_fields, existing_rpps, existing_orgs,
                            speciality_cache, user_ct, org_ct, stats,
                        )
                except Exception as exc:
                    logger.warning(f"Error processing RPPS {row[COL_RPPS]}: {exc}")
                    stats["errors"] += 1

    def _process_row(self, row, custom_fields, existing_rpps, existing_orgs,
                     speciality_cache, user_ct, org_ct, stats):
        rpps = row[COL_RPPS]
        last_name = row[COL_NOM].title()
        first_name = row[COL_PRENOM].title()
        job_title = row[COL_PROFESSION]
        email = row[COL_EMAIL].lower() or None
        phone = self._clean_phone(row[COL_TELEPHONE])
        street = self._build_street(row)
        postal_code = row[COL_CODE_POSTAL]
        city = self._clean_city(row[COL_COMMUNE])
        country = row[COL_PAYS]
        id_structure = row[COL_ID_STRUCTURE]
        raison_sociale = row[COL_RAISON_SOCIALE]
        savoir_faire = row[COL_SAVOIR_FAIRE]
        mode_exercice = row[COL_MODE_EXERCICE]
        siret = row[COL_SIRET]
        finess = row[COL_FINESS]

        # ── Organisation ────────────────────────────────────────────────
        organisation = None
        if raison_sociale and id_structure:
            if id_structure in existing_orgs:
                organisation = Organisation.objects.filter(pk=existing_orgs[id_structure]).first()
                if organisation:
                    Organisation.objects.filter(pk=organisation.pk).update(
                        street=street or None,
                        city=city or None,
                        postal_code=postal_code or None,
                        country=country or None,
                        phone=phone or None,
                        email=email or None,
                    )
            else:
                organisation = Organisation.objects.create(
                    name=raison_sociale,
                    street=street or None,
                    city=city or None,
                    postal_code=postal_code or None,
                    country=country or None,
                    phone=phone or None,
                    email=email or None,
                    imported=True,
                )
                existing_orgs[id_structure] = organisation.pk

            # Organisation custom fields
            for cf_name, cf_value in [
                ("Identifiant structure", id_structure),
                ("SIRET", siret),
                ("FINESS", finess),
            ]:
                cf = custom_fields.get(cf_name)
                if cf and cf_value and organisation:
                    CustomFieldValue.objects.update_or_create(
                        custom_field=cf,
                        content_type=org_ct,
                        object_id=organisation.pk,
                        defaults={"value": cf_value},
                    )

        # ── User ────────────────────────────────────────────────────────
        user_data = {
            "first_name": first_name,
            "last_name": last_name,
            "job_title": job_title,
            "is_practitioner": True,
            "imported": True,
        }

        claimed_email = None
        if rpps in existing_rpps:
            user_pk = existing_rpps[rpps]
            user = User.objects.filter(pk=user_pk).first()
            if user:
                claimed_email = self._claim_email(email, user_pk)
                fields = dict(user_data, main_organisation=organisation)
                # Only ever write an address, never wipe one: the dataset says
                # nothing about a practitioner whose site has no email.
                if claimed_email:
                    fields["email"] = claimed_email
                User.objects.filter(pk=user_pk).update(**fields)
                user.refresh_from_db()
                stats["updated"] += 1
            else:
                # User was deleted since last import, remove stale reference
                del existing_rpps[rpps]

        if rpps not in existing_rpps:
            claimed_email = self._claim_email(email, None)
            user = User(
                email=claimed_email,
                main_organisation=organisation,
                **user_data,
            )
            user.set_unusable_password()
            user.save()
            existing_rpps[rpps] = user.pk
            stats["created"] += 1

        if claimed_email:
            self._email_owner[claimed_email] = (user.pk, True)

        if organisation:
            user.organisations.add(organisation)

        # User custom fields (RPPS, Mode d'exercice)
        for cf_name, cf_value in [("RPPS", rpps), ("Mode d'exercice", mode_exercice)]:
            cf = custom_fields.get(cf_name)
            if cf and cf_value:
                CustomFieldValue.objects.update_or_create(
                    custom_field=cf,
                    content_type=user_ct,
                    object_id=user.pk,
                    defaults={"value": cf_value},
                )

        # Speciality: use savoir-faire if available, otherwise fall back to profession
        spec_name = savoir_faire or job_title
        if spec_name:
            if spec_name not in speciality_cache:
                spec, _ = Speciality.objects.get_or_create(name=spec_name)
                speciality_cache[spec_name] = spec
            user.specialities.add(speciality_cache[spec_name])

    def _row_has_address(self, row):
        return bool(
            row[COL_CODE_POSTAL] or row[COL_COMMUNE] or row[COL_LIBELLE_VOIE]
        )

    def _is_reachable(self, row):
        """Is there any way to contact that practitioner?

        The dataset lists an activity even when it records nothing to reach the
        person by: those rows describe a registration, not a place of practice,
        and importing them fills the directory with entries no patient can act
        on.
        """
        if self._row_has_address(row):
            return True
        if row[COL_EMAIL] or row[COL_TELEPHONE]:
            return True
        structure = row[COL_ID_STRUCTURE]
        return bool(structure) and structure in self._orgs_with_address

    def _build_street(self, row):
        parts = [
            row[COL_NUMERO_VOIE],
            row[COL_TYPE_VOIE],
            row[COL_LIBELLE_VOIE],
        ]
        return " ".join(part for part in parts if part)

    def _clean_phone(self, phone):
        if not phone:
            return None
        cleaned = re.sub(r"[^\d+]", "", phone)
        return cleaned or None

    def _clean_city(self, city):
        """Remove postal code prefix from city field (e.g. '97130 CAPESTERRE BELLE EAU' -> 'Capesterre Belle Eau')."""
        city = re.sub(r"^\d{5}\s*", "", city)
        return city.title() if city else None

    def _claim_email(self, email, current_pk):
        """Hand the address to a practitioner only if nobody else is behind it.

        The dataset publishes the address of the *site*, so every colleague of a
        practice carries the same one. The Organisation keeps it in every case;
        a practitioner only gets it while they turn out to be its sole holder,
        which is the reality for someone practising alone. As soon as a second
        practitioner shows up on it, it is taken back from the first rather than
        turned into a "+1" alias nobody can receive mail at.
        """
        if not email or email in self._shared_emails:
            return None

        owner_pk, owner_imported = self._email_owner.get(email, (None, False))
        if owner_pk is None or owner_pk == current_pk:
            return email
        if not owner_imported:
            # An account this import does not own: leave it well alone.
            return None

        User.objects.filter(pk=owner_pk).update(email=None)
        del self._email_owner[email]
        self._shared_emails.add(email)
        return None
