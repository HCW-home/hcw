import logging
import time

import requests as http_requests
from django.core.management.base import BaseCommand
from django.db.models import Q

from users.models import Organisation, User

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {"User-Agent": "HCW-Home/1.0"}


class Command(BaseCommand):
    help = "Geocode User and Organisation records that have an address but no location"

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit", type=int, default=0,
            help="Max records to geocode (0 = unlimited)",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Show what would be geocoded without making requests",
        )
        parser.add_argument(
            "--model", choices=["user", "organisation", "all"], default="all",
            help="Which model to geocode",
        )

    def handle(self, *args, **options):
        limit = options["limit"]
        dry_run = options["dry_run"]
        model = options["model"]
        total = 0
        address_cache = {}

        if model in ("organisation", "all"):
            count = self._geocode_model(
                Organisation, limit, dry_run, address_cache,
            )
            total += count
            if limit:
                limit -= count

        if model in ("user", "all") and (not options["limit"] or limit > 0):
            count = self._geocode_model(
                User, limit, dry_run, address_cache,
            )
            total += count

        self.stdout.write(self.style.SUCCESS(
            f"\nDone. Geocoded: {total}, Cache hits: {len(address_cache)} unique addresses"
        ))

    def _geocode_model(self, model, limit, dry_run, address_cache):
        name = model.__name__
        qs = model.objects.filter(
            Q(location__isnull=True) | Q(location=""),
        ).exclude(
            Q(city__isnull=True) | Q(city=""),
        )

        if limit:
            qs = qs[:limit]

        records = list(qs)
        self.stdout.write(f"\n{name}: {len(records)} records to geocode")

        geocoded = 0
        failed = 0
        cached = 0

        for obj in records:
            address = self._build_address(obj)
            if not address:
                continue

            if dry_run:
                self.stdout.write(f"  [DRY-RUN] {name} pk={obj.pk}: {address}")
                geocoded += 1
                continue

            if address in address_cache:
                obj.location = address_cache[address]
                obj.save(update_fields=["location"])
                cached += 1
                geocoded += 1
                continue

            coords = self._nominatim_search(address)
            if coords:
                obj.location = coords
                obj.save(update_fields=["location"])
                address_cache[address] = coords
                geocoded += 1
            else:
                failed += 1

            time.sleep(1)

        self.stdout.write(
            f"  {name}: geocoded={geocoded}, cached={cached}, failed={failed}"
        )
        return geocoded

    def _build_address(self, obj):
        parts = [obj.street, obj.postal_code, obj.city, obj.country]
        address = ", ".join(p.strip() for p in parts if p and p.strip())
        return address or None

    def _nominatim_search(self, address):
        try:
            resp = http_requests.get(
                NOMINATIM_URL,
                params={"q": address, "format": "json", "limit": 1},
                headers=NOMINATIM_HEADERS,
                timeout=10,
            )
            resp.raise_for_status()
            results = resp.json()
        except Exception as exc:
            logger.warning(f"Nominatim request failed for '{address}': {exc}")
            return None

        if not results:
            logger.info(f"No result for '{address}'")
            return None

        return f"{results[0]['lat']},{results[0]['lon']}"
