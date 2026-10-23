import logging

from django.core.management.base import BaseCommand
from django_tenants.utils import get_tenant_model, tenant_context

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        "Backfill the `organisations` field on existing patients that have "
        "none set, using their creator's current main_organisation. This "
        "repairs visibility for patients created before organisation "
        "visibility stopped following the creator's organisation live."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Show what would be changed without saving anything",
        )
        parser.add_argument(
            "--tenant", default=None,
            help="Only run for this tenant schema name (default: all tenants)",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        tenant_filter = options["tenant"]

        TenantModel = get_tenant_model()
        tenants = TenantModel.objects.exclude(schema_name="public")
        if tenant_filter:
            tenants = tenants.filter(schema_name=tenant_filter)

        total_updated = 0
        total_skipped = 0

        for tenant in tenants:
            with tenant_context(tenant):
                updated, skipped = self._backfill_tenant(tenant, dry_run)
                total_updated += updated
                total_skipped += skipped

        self.stdout.write(self.style.SUCCESS(
            f"\nDone. Updated: {total_updated}, skipped (no creator organisation): {total_skipped}"
        ))

    def _backfill_tenant(self, tenant, dry_run):
        from users.models import User

        patients = User.objects.filter(
            is_practitioner=False, organisations__isnull=True,
        ).select_related("created_by")

        updated = 0
        skipped = 0

        for patient in patients:
            creator = patient.created_by
            if not creator or not creator.main_organisation_id:
                skipped += 1
                continue

            if dry_run:
                self.stdout.write(
                    f"  [DRY-RUN] {tenant.schema_name}: patient pk={patient.pk} "
                    f"-> organisation pk={creator.main_organisation_id}"
                )
            else:
                patient.organisations.add(creator.main_organisation)

            updated += 1

        self.stdout.write(
            f"{tenant.schema_name}: updated={updated}, skipped={skipped}"
        )
        return updated, skipped