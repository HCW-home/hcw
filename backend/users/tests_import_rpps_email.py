"""Regression tests: an RPPS email describes a site, not a person.

The dataset publishes one address per site under "Adresse e-mail (coord.
structure)", so every colleague of a practice carries the same one — 61% of the
practitioners who have an email share it. Writing it onto each of them used to
mint "contact+1@...", "contact+2@..." aliases that no mail server routes. The
address now belongs to the Organisation, and a practitioner only keeps it while
they are its sole holder, which is the reality of someone practising alone.

Practitioners without an email are ordinary imports: as long as they can be
reached some other way they must all be created, or the interactive map loses
them. Every row below therefore carries a phone number, so that these tests
exercise the email rule and not the reachability one, which
tests_import_rpps_contact covers.
"""

import csv
import os
import tempfile
from unittest.mock import patch

from django.core.management import call_command
from django_tenants.test.cases import TenantTestCase

from users import tasks
from users.management.commands.import_rpps import (
    COL_CODE_PROFESSION,
    COL_EMAIL,
    COL_ID_STRUCTURE,
    COL_NOM,
    COL_PRENOM,
    COL_PROFESSION,
    COL_RAISON_SOCIALE,
    COL_RPPS,
    COL_TELEPHONE,
    USED_COLUMNS,
)
from users.models import Organisation, User

SHARED = "rossignol@resopharma.fr"
SOLO = "solo@cabinet.fr"


def row(rpps, last_name, first_name, structure=None, name=None, email=None,
        phone="0557691030"):
    return {
        COL_RPPS: rpps,
        COL_NOM: last_name,
        COL_PRENOM: first_name,
        COL_PROFESSION: "Pharmacien",
        COL_CODE_PROFESSION: "21",
        COL_ID_STRUCTURE: structure or "",
        COL_RAISON_SOCIALE: name or "",
        COL_EMAIL: email or "",
        COL_TELEPHONE: phone,
    }


class ImportRppsEmailTests(TenantTestCase):
    def setUp(self):
        # Saving an address queues a geocoding task; keep it off the broker.
        queueing = patch.object(tasks.geocode_location, "delay")
        queueing.start()
        self.addCleanup(queueing.stop)

        self.state = os.path.join(tempfile.mkdtemp(), "state.json")

    def _import(self, rows, **options):
        handle = tempfile.NamedTemporaryFile(
            "w", suffix=".txt", delete=False, newline="", encoding="utf-8"
        )
        self.addCleanup(os.remove, handle.name)
        with handle:
            writer = csv.writer(handle, delimiter="|")
            writer.writerow(USED_COLUMNS)
            for values in rows:
                writer.writerow([values.get(name, "") for name in USED_COLUMNS])

        call_command(
            "import_rpps", file=handle.name, source="txt",
            state_file=self.state, **options,
        )

    # ── The address belongs to the structure ────────────────────────────

    def test_structure_email_lands_on_the_organisation(self):
        self._import([row("1", "Perves", "Marie-Laurence",
                          "S1", "PHARMACIE ROSSIGNOL EURL", SHARED)])

        organisation = Organisation.objects.get(name="PHARMACIE ROSSIGNOL EURL")
        self.assertEqual(organisation.email, SHARED)

    def test_colleagues_of_one_practice_share_no_address(self):
        self._import([
            row("1", "Perves", "Marie-Laurence", "S1", "PHARMACIE ROSSIGNOL EURL", SHARED),
            row("2", "Rossignol", "Eliane", "S1", "PHARMACIE ROSSIGNOL EURL", SHARED),
        ])

        self.assertEqual(Organisation.objects.get(name="PHARMACIE ROSSIGNOL EURL").email,
                         SHARED)
        practitioners = User.objects.filter(imported=True).order_by("last_name")
        self.assertEqual(practitioners.count(), 2)
        self.assertEqual([p.email for p in practitioners], [None, None])

    def test_no_plus_alias_is_ever_minted(self):
        self._import([
            row("1", "Perves", "Marie-Laurence", "S1", "PHARMACIE", SHARED),
            row("2", "Rossignol", "Eliane", "S1", "PHARMACIE", SHARED),
            row("3", "Martin", "Luc", "S1", "PHARMACIE", SHARED),
        ])

        addresses = User.objects.filter(imported=True).values_list("email", flat=True)
        self.assertFalse([a for a in addresses if a and "+" in a])

    def test_a_practitioner_alone_on_an_address_keeps_it(self):
        self._import([row("3", "Solo", "Jean", "S2", "CABINET SOLO", SOLO)])

        self.assertEqual(User.objects.get(imported=True).email, SOLO)
        self.assertEqual(Organisation.objects.get(name="CABINET SOLO").email, SOLO)

    # ── Nobody is dropped for lacking an address ────────────────────────

    def test_practitioners_reachable_without_an_email_are_imported(self):
        self._import([
            row("1", "Perves", "Marie-Laurence", "S1", "PHARMACIE", SHARED),
            row("2", "Rossignol", "Eliane", "S1", "PHARMACIE", SHARED),
            row("4", "Sansmail", "Pierre", "S3", "CABINET MUET"),
            row("5", "Sansstruct", "Paul"),
        ])

        imported = User.objects.filter(imported=True)
        self.assertEqual(imported.count(), 4)
        self.assertEqual(
            sorted(imported.values_list("last_name", flat=True)),
            ["Perves", "Rossignol", "Sansmail", "Sansstruct"],
        )
        self.assertIsNone(imported.get(last_name="Sansmail").email)
        self.assertIsNone(Organisation.objects.get(name="CABINET MUET").email)

    def test_a_practitioner_without_a_structure_is_still_imported(self):
        """Reachable by phone alone, with no site to attach them to."""
        self._import([row("5", "Sansstruct", "Paul")])

        practitioner = User.objects.get(imported=True)
        self.assertEqual(practitioner.last_name, "Sansstruct")
        self.assertIsNone(practitioner.main_organisation)

    # ── Existing accounts are left alone ────────────────────────────────

    def test_an_address_held_by_a_real_account_is_not_taken(self):
        User.objects.create(email=SOLO, first_name="Jean", last_name="Solo")

        self._import([row("3", "Solo", "Jean", "S2", "CABINET SOLO", SOLO)])

        self.assertEqual(User.objects.filter(email=SOLO).count(), 1)
        self.assertFalse(User.objects.get(email=SOLO).imported)
        self.assertIsNone(User.objects.get(imported=True).email)
        # The structure still records it: that is where it belongs.
        self.assertEqual(Organisation.objects.get(name="CABINET SOLO").email, SOLO)

    # ── Running it twice changes nothing ────────────────────────────────

    def test_importing_twice_is_stable(self):
        rows = [
            row("1", "Perves", "Marie-Laurence", "S1", "PHARMACIE", SHARED),
            row("2", "Rossignol", "Eliane", "S1", "PHARMACIE", SHARED),
            row("3", "Solo", "Jean", "S2", "CABINET SOLO", SOLO),
        ]
        self._import(rows)
        self._import(rows)

        imported = User.objects.filter(imported=True)
        self.assertEqual(imported.count(), 3)
        self.assertEqual(imported.get(last_name="Solo").email, SOLO)
        self.assertIsNone(imported.get(last_name="Perves").email)
        self.assertIsNone(imported.get(last_name="Rossignol").email)

    def test_a_second_holder_appearing_later_takes_the_address_back(self):
        self._import([row("1", "Perves", "Marie-Laurence", "S1", "PHARMACIE", SHARED)])
        self.assertEqual(User.objects.get(imported=True).email, SHARED)

        self._import([
            row("1", "Perves", "Marie-Laurence", "S1", "PHARMACIE", SHARED),
            row("2", "Rossignol", "Eliane", "S1", "PHARMACIE", SHARED),
        ])

        self.assertEqual(
            list(User.objects.filter(imported=True).values_list("email", flat=True)),
            [None, None],
        )
