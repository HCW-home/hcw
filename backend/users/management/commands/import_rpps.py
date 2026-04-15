import csv
import logging
import os
import re
import tempfile
import zipfile

import requests as http_requests
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from consultations.models import CustomField, CustomFieldValue
from users.models import Organisation, Speciality, User

logger = logging.getLogger(__name__)

DATASET_API_URL = (
    "https://www.data.gouv.fr/api/1/datasets/"
    "annuaire-sante-extractions-des-donnees-en-libre-acces-"
    "des-professionnels-intervenant-dans-le-systeme-de-sante-rpps/"
)

# Column indices (0-based) from the RPPS pipe-delimited file
COL_RPPS = 1
COL_CIVILITE = 6
COL_NOM = 7
COL_PRENOM = 8
COL_CODE_PROFESSION = 9
COL_PROFESSION = 10
COL_SAVOIR_FAIRE = 16
COL_MODE_EXERCICE = 17
COL_SIRET = 20
COL_FINESS = 22
COL_RAISON_SOCIALE = 24
COL_NUMERO_VOIE = 28
COL_TYPE_VOIE = 31
COL_LIBELLE_VOIE = 32
COL_CODE_POSTAL = 35
COL_COMMUNE = 37
COL_PAYS = 39
COL_TELEPHONE = 40
COL_EMAIL = 43

PRACTITIONER_CUSTOM_FIELDS = [
    ("RPPS", "short_text"),
    ("Mode d'exercice", "short_text"),
]

ORGANISATION_CUSTOM_FIELDS = [
    ("SIRET", "short_text"),
    ("FINESS", "short_text"),
]


class Command(BaseCommand):
    help = "Import practitioners from the RPPS dataset (data.gouv.fr)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--file", help="Path to a local RPPS file (skip download)"
        )
        parser.add_argument(
            "--url", help="Direct download URL (skip API discovery)"
        )
        parser.add_argument(
            "--profession-code",
            help="Filter by profession code (e.g. 40=Dentiste, 50=Sage-Femme)",
        )
        parser.add_argument(
            "--batch-size", type=int, default=500, help="Transaction batch size"
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and report stats without writing to DB",
        )

    def handle(self, *args, **options):
        self._do_import(options)

    def _do_import(self, options):
        file_path = self._resolve_file(options)
        custom_fields = self._ensure_custom_fields(options["dry_run"])
        self._import_file(file_path, custom_fields, options)

    # ── Download / file resolution ──────────────────────────────────────

    def _resolve_file(self, options):
        if options.get("file"):
            path = options["file"]
            if not os.path.exists(path):
                raise CommandError(f"File not found: {path}")
            return path

        url = options.get("url") or self._discover_download_url()
        return self._download_and_extract(url)

    def _discover_download_url(self):
        self.stdout.write("Fetching dataset metadata from data.gouv.fr...")
        resp = http_requests.get(DATASET_API_URL, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        for resource in data.get("resources", []):
            title = (resource.get("title") or "").lower()
            fmt = (resource.get("format") or "").lower()
            if "ps_libreacces" in title.replace(" ", "_").lower() and fmt in (
                "csv",
                "zip",
                "txt",
            ):
                url = resource["url"]
                self.stdout.write(f"Found resource: {resource['title']}")
                return url

        raise CommandError(
            "Could not find a PS_LibreAcces resource in the dataset. "
            "Use --url to provide a direct download URL."
        )

    def _download_and_extract(self, url):
        self.stdout.write(f"Downloading {url}...")
        resp = http_requests.get(url, stream=True, timeout=300)
        resp.raise_for_status()

        suffix = ".zip" if ".zip" in url.lower() else ".txt"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        total = 0
        for chunk in resp.iter_content(chunk_size=8192):
            tmp.write(chunk)
            total += len(chunk)
        tmp.close()
        self.stdout.write(f"Downloaded {total / 1024 / 1024:.1f} MB")

        if zipfile.is_zipfile(tmp.name):
            return self._extract_zip(tmp.name)
        return tmp.name

    def _extract_zip(self, zip_path):
        self.stdout.write("Extracting ZIP...")
        tmpdir = tempfile.mkdtemp()
        with zipfile.ZipFile(zip_path, "r") as zf:
            names = zf.namelist()
            txt_files = [
                n for n in names if n.lower().endswith((".txt", ".csv"))
            ]
            if not txt_files:
                raise CommandError(f"No .txt/.csv file found in ZIP: {names}")
            target = txt_files[0]
            zf.extract(target, tmpdir)
            self.stdout.write(f"Extracted: {target}")
            return os.path.join(tmpdir, target)

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

    def _import_file(self, file_path, custom_fields, options):
        profession_filter = options.get("profession_code")
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

        # Pre-load existing SIRET -> organisation_pk mapping
        siret_field = custom_fields.get("SIRET")
        existing_orgs = {}
        if siret_field:
            org_ct = ContentType.objects.get_for_model(Organisation)
            existing_orgs = dict(
                CustomFieldValue.objects.filter(
                    custom_field=siret_field, content_type=org_ct
                ).values_list("value", "object_id")
            )

        # Pre-load specialities
        speciality_cache = {s.name: s for s in Speciality.objects.all()}

        stats = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
        seen_rpps = set()
        batch = []

        self.stdout.write(f"Parsing {file_path}...")

        # Detect encoding
        encoding = self._detect_encoding(file_path)

        with open(file_path, "r", encoding=encoding, errors="replace") as f:
            reader = csv.reader(f, delimiter="|")
            header = next(reader, None)
            if not header:
                raise CommandError("Empty file")

            for line_num, row in enumerate(reader, start=2):
                if len(row) < COL_EMAIL + 1:
                    continue

                rpps = row[COL_RPPS].strip()
                if not rpps:
                    continue

                if profession_filter and row[COL_CODE_PROFESSION].strip() != profession_filter:
                    continue

                if rpps in seen_rpps:
                    stats["skipped"] += 1
                    continue
                seen_rpps.add(rpps)

                batch.append(row)

                if len(batch) >= batch_size:
                    if not dry_run:
                        self._process_batch(
                            batch,
                            custom_fields,
                            existing_rpps,
                            existing_orgs,
                            speciality_cache,
                            stats,
                        )
                    else:
                        self._dry_run_batch(batch, existing_rpps, stats)
                    batch = []

            # Process remaining
            if batch:
                if not dry_run:
                    self._process_batch(
                        batch,
                        custom_fields,
                        existing_rpps,
                        existing_orgs,
                        speciality_cache,
                        stats,
                    )
                else:
                    self._dry_run_batch(batch, existing_rpps, stats)

        total = sum(stats.values())
        self.stdout.write(
            self.style.SUCCESS(
                f"\nProcessed: {total} rows\n"
                f"  Created: {stats['created']}\n"
                f"  Updated: {stats['updated']}\n"
                f"  Skipped (duplicates): {stats['skipped']}\n"
                f"  Errors: {stats['errors']}"
            )
        )

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

    def _dry_run_batch(self, rows, existing_rpps, stats):
        for row in rows:
            rpps = row[COL_RPPS].strip()
            if rpps in existing_rpps:
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
                    rpps = row[COL_RPPS].strip()
                    logger.warning(f"Error processing RPPS {rpps}: {exc}")
                    stats["errors"] += 1

    def _process_row(self, row, custom_fields, existing_rpps, existing_orgs,
                     speciality_cache, user_ct, org_ct, stats):
        rpps = row[COL_RPPS].strip()
        last_name = row[COL_NOM].strip().title()
        first_name = row[COL_PRENOM].strip().title()
        job_title = row[COL_PROFESSION].strip()
        email = row[COL_EMAIL].strip().lower() or None
        phone = self._clean_phone(row[COL_TELEPHONE].strip())
        street = self._build_street(row)
        postal_code = row[COL_CODE_POSTAL].strip()
        city = self._clean_city(row[COL_COMMUNE].strip())
        country = row[COL_PAYS].strip() if len(row) > COL_PAYS else None
        raison_sociale = row[COL_RAISON_SOCIALE].strip() if len(row) > COL_RAISON_SOCIALE else None
        savoir_faire = row[COL_SAVOIR_FAIRE].strip()
        mode_exercice = row[COL_MODE_EXERCICE].strip()
        siret = row[COL_SIRET].strip()
        finess = row[COL_FINESS].strip()

        # ── Organisation ────────────────────────────────────────────────
        organisation = None
        if raison_sociale and siret:
            if siret in existing_orgs:
                organisation = Organisation.objects.filter(pk=existing_orgs[siret]).first()
                if organisation:
                    Organisation.objects.filter(pk=organisation.pk).update(
                        street=street or None,
                        city=city or None,
                        postal_code=postal_code or None,
                        country=country or None,
                        phone=phone or None,
                    )
            else:
                organisation = Organisation.objects.create(
                    name=raison_sociale,
                    street=street or None,
                    city=city or None,
                    postal_code=postal_code or None,
                    country=country or None,
                    phone=phone or None,
                )
                existing_orgs[siret] = organisation.pk

            # Organisation custom fields (SIRET, FINESS)
            for cf_name, cf_value in [("SIRET", siret), ("FINESS", finess)]:
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
        }

        if rpps in existing_rpps:
            user_pk = existing_rpps[rpps]
            User.objects.filter(pk=user_pk).update(
                **user_data,
                main_organisation=organisation,
            )
            user = User.objects.get(pk=user_pk)
            stats["updated"] += 1
        else:
            user = User(
                email=email,
                main_organisation=organisation,
                **user_data,
            )
            user.set_unusable_password()
            user.save()
            existing_rpps[rpps] = user.pk
            stats["created"] += 1

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

        # Speciality
        if savoir_faire:
            if savoir_faire not in speciality_cache:
                spec, _ = Speciality.objects.get_or_create(name=savoir_faire)
                speciality_cache[savoir_faire] = spec
            user.specialities.add(speciality_cache[savoir_faire])

    def _build_street(self, row):
        parts = []
        numero = row[COL_NUMERO_VOIE].strip()
        type_voie = row[COL_TYPE_VOIE].strip()
        libelle = row[COL_LIBELLE_VOIE].strip()
        if numero:
            parts.append(numero)
        if type_voie:
            parts.append(type_voie)
        if libelle:
            parts.append(libelle)
        return " ".join(parts)

    def _clean_phone(self, phone):
        if not phone:
            return None
        cleaned = re.sub(r"[^\d+]", "", phone)
        return cleaned or None

    def _clean_city(self, city):
        """Remove postal code prefix from city field (e.g. '97130 CAPESTERRE BELLE EAU' -> 'Capesterre Belle Eau')."""
        city = re.sub(r"^\d{5}\s*", "", city)
        return city.title() if city else None
