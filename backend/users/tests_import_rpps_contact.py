"""Regression tests: only import practitioners someone can actually reach.

A quarter of the dataset (495 516 practitioners) records a registration and
nothing else — no postal address, no email, no phone number, on any of their
rows. Importing them fills the directory and the map with entries no patient can
act on, so they are left out. A practitioner is kept as soon as one of their
activity rows carries an address, an email or a phone number, or points at a
structure whose address is already known.
"""

import csv
import os
import tempfile
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django_tenants.test.cases import TenantTestCase

from users import tasks
from users.management.commands.import_rpps import (
    COL_CODE_POSTAL,
    COL_COMMUNE,
    COL_EMAIL,
    COL_ID_STRUCTURE,
    COL_LIBELLE_VOIE,
    COL_NOM,
    COL_PRENOM,
    COL_PROFESSION,
    COL_RAISON_SOCIALE,
    COL_RPPS,
    COL_TELEPHONE,
    USED_COLUMNS,
)
from users.models import Organisation, User


def row(rpps, last_name, **fields):
    values = {
        COL_RPPS: rpps,
        COL_NOM: last_name,
        COL_PRENOM: "Jean",
        COL_PROFESSION: "Médecin",
    }
    values.update(fields)
    return values


class ReachablePractitionerTests(TenantTestCase):
    def setUp(self):
        queueing = patch.object(tasks.geocode_location, "delay")
        queueing.start()
        self.addCleanup(queueing.stop)
        self.state = os.path.join(tempfile.mkdtemp(), "state.json")

    def _import(self, rows):
        handle = tempfile.NamedTemporaryFile(
            "w", suffix=".txt", delete=False, newline="", encoding="utf-8"
        )
        self.addCleanup(os.remove, handle.name)
        with handle:
            writer = csv.writer(handle, delimiter="|")
            writer.writerow(USED_COLUMNS)
            for values in rows:
                writer.writerow([values.get(name, "") for name in USED_COLUMNS])

        out = StringIO()
        call_command("import_rpps", file=handle.name, source="txt",
                     state_file=self.state, stdout=out)
        return out.getvalue()

    def _imported(self):
        return sorted(
            User.objects.filter(imported=True).values_list("last_name", flat=True)
        )

    # ── One contact detail is enough ────────────────────────────────────

    def test_a_postal_address_is_enough(self):
        self._import([row("1", "Adresse", **{
            COL_LIBELLE_VOIE: "de l'Isle", COL_CODE_POSTAL: "33230",
            COL_COMMUNE: "Guîtres",
        })])

        self.assertEqual(self._imported(), ["Adresse"])

    def test_an_email_alone_is_enough(self):
        self._import([row("2", "Mail", **{COL_EMAIL: "solo@cabinet.fr"})])

        self.assertEqual(self._imported(), ["Mail"])

    def test_a_phone_alone_is_enough(self):
        self._import([row("3", "Tel", **{COL_TELEPHONE: "0557691030"})])

        self.assertEqual(self._imported(), ["Tel"])

    def test_a_city_alone_is_enough(self):
        self._import([row("4", "Ville", **{COL_COMMUNE: "Guîtres"})])

        self.assertEqual(self._imported(), ["Ville"])

    # ── Nothing to reach them by ────────────────────────────────────────

    def test_a_practitioner_with_no_contact_detail_is_left_out(self):
        self._import([row("5", "Fantome")])

        self.assertEqual(self._imported(), [])

    def test_they_are_reported_separately_from_duplicates(self):
        output = self._import([
            row("5", "Fantome"),
            row("6", "Joignable", **{COL_TELEPHONE: "0557691030"}),
        ])

        self.assertIn("Skipped (no address, email nor phone): 1", output)
        self.assertIn("Created: 1", output)

    # ── A later row can still bring them in ─────────────────────────────

    def test_a_later_activity_row_rescues_them(self):
        self._import([
            row("7", "Tardif"),                       # registration only
            row("7", "Tardif", **{COL_CODE_POSTAL: "33230",
                                  COL_COMMUNE: "Guîtres"}),
        ])

        self.assertEqual(self._imported(), ["Tardif"])
        practitioner = User.objects.get(imported=True)
        self.assertIsNone(practitioner.main_organisation)

    def test_the_rescuing_row_is_the_one_imported(self):
        self._import([
            row("8", "Tardif"),
            row("8", "Tardif", **{
                COL_ID_STRUCTURE: "S1", COL_RAISON_SOCIALE: "CABINET",
                COL_CODE_POSTAL: "33230", COL_COMMUNE: "Guîtres",
            }),
        ])

        practitioner = User.objects.get(imported=True)
        self.assertEqual(practitioner.main_organisation.name, "CABINET")

    # ── Reachable through their structure ───────────────────────────────

    def test_a_structure_with_an_address_makes_them_reachable(self):
        self._import([
            row("9", "Collegue", **{
                COL_ID_STRUCTURE: "S1", COL_RAISON_SOCIALE: "CABINET",
                COL_CODE_POSTAL: "33230", COL_COMMUNE: "Guîtres",
            }),
            row("10", "Sanscoord", **{COL_ID_STRUCTURE: "S1"}),
        ])

        self.assertEqual(self._imported(), ["Collegue", "Sanscoord"])

    def test_a_structure_known_from_a_previous_import_still_counts(self):
        self._import([row("9", "Collegue", **{
            COL_ID_STRUCTURE: "S1", COL_RAISON_SOCIALE: "CABINET",
            COL_CODE_POSTAL: "33230", COL_COMMUNE: "Guîtres",
        })])
        self.assertEqual(Organisation.objects.get(name="CABINET").postal_code,
                         "33230")

        self._import([row("10", "Sanscoord", **{COL_ID_STRUCTURE: "S1"})])

        self.assertIn("Sanscoord", self._imported())

    def test_an_unknown_structure_does_not_make_them_reachable(self):
        self._import([row("11", "Orphelin", **{COL_ID_STRUCTURE: "S404"})])

        self.assertEqual(self._imported(), [])
