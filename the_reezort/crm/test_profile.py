"""Tests for CRM Profile / 360 / Consent / Preference endpoints.

Run with: bench run-tests --app the_reezort --module the_reezort.crm.test_profile
These use FrappeTestCase for DB isolation; bench is required to run them.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.crm import api as crm_api


def _make_profile(full_name="Test Guest", email=None, phone=None):
    """Helper: create a minimal Guest Profile and return doc."""
    doc = frappe.get_doc(
        {
            "doctype": "Guest Profile",
            "guest_full_name": full_name,
            "full_name": full_name,
            "primary_email": email or "",
            "email": email or "",
            "primary_phone": phone or "",
            "phone": phone or "",
            "status": "Active",
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc


class TestGuestProfileController(FrappeTestCase):
    def test_status_defaults_to_active(self):
        doc = _make_profile("Status Default Guest")
        self.assertEqual(doc.status, "Active")

    def test_full_name_synced_from_guest_full_name(self):
        doc = _make_profile("Sync Name Guest")
        self.assertEqual(doc.full_name, "Sync Name Guest")


class TestCreateOrUpdateGuestProfile(FrappeTestCase):
    def test_creates_new_profile(self):
        result = crm_api.create_or_update_guest_profile(
            full_name="New Profile Guest",
            email="newprofile@test.example",
        )
        self.assertTrue(result["ok"])
        self.assertIn("guest_profile", result["data"])
        self.assertEqual(result["data"]["status"], "Active")

    def test_upsert_by_email_updates_existing(self):
        existing = _make_profile("Existing Guest", email="existing@test.example")
        result = crm_api.create_or_update_guest_profile(
            full_name="Existing Guest Updated",
            email="existing@test.example",
        )
        self.assertEqual(result["data"]["guest_profile"], existing.name)

    def test_upsert_by_phone_finds_existing(self):
        existing = _make_profile("Phone Guest", phone="+911234567890")
        result = crm_api.create_or_update_guest_profile(
            full_name="Phone Guest",
            phone="+911234567890",
        )
        self.assertEqual(result["data"]["guest_profile"], existing.name)

    def test_create_without_full_name_raises(self):
        with self.assertRaises(frappe.exceptions.ValidationError):
            crm_api.create_or_update_guest_profile(email="noname@test.example")


class TestRecordGuestConsent(FrappeTestCase):
    def setUp(self):
        self.gp = _make_profile("Consent Test Guest", email="consent@test.example")

    def test_creates_consent_record(self):
        result = crm_api.record_guest_consent(
            guest_profile=self.gp.name,
            purpose="Marketing",
            channel="Email",
            status="Granted",
            source="Guest Portal",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["status"], "Granted")

    def test_granted_marketing_sets_do_not_contact_false(self):
        crm_api.record_guest_consent(
            guest_profile=self.gp.name,
            purpose="Marketing",
            channel="Email",
            status="Granted",
            source="Guest Portal",
        )
        do_not_contact = frappe.db.get_value("Guest Profile", self.gp.name, "do_not_contact")
        self.assertEqual(do_not_contact, 0)

    def test_withdrawn_marketing_flips_do_not_contact_true(self):
        # First grant, then withdraw
        crm_api.record_guest_consent(
            guest_profile=self.gp.name,
            purpose="Marketing",
            channel="Email",
            status="Granted",
            source="Guest Portal",
        )
        crm_api.record_guest_consent(
            guest_profile=self.gp.name,
            purpose="Marketing",
            channel="Email",
            status="Withdrawn",
            source="Guest Portal",
        )
        do_not_contact = frappe.db.get_value("Guest Profile", self.gp.name, "do_not_contact")
        self.assertEqual(do_not_contact, 1)

    def test_no_marketing_consent_means_do_not_contact(self):
        # Fresh profile with no consents → do_not_contact stays 1 after recompute
        crm_api._recompute_do_not_contact(self.gp.name)
        do_not_contact = frappe.db.get_value("Guest Profile", self.gp.name, "do_not_contact")
        self.assertEqual(do_not_contact, 1)

    def test_nonexistent_profile_raises(self):
        with self.assertRaises(frappe.exceptions.DoesNotExistError):
            crm_api.record_guest_consent(
                guest_profile="DOES-NOT-EXIST",
                purpose="Marketing",
                channel="Email",
                status="Granted",
            )


class TestUpdateGuestPreference(FrappeTestCase):
    def setUp(self):
        self.gp = _make_profile("Pref Test Guest")

    def test_creates_preference(self):
        result = crm_api.update_guest_preference(
            guest_profile=self.gp.name,
            preference_type="Pillow",
            preference_value="Foam pillow",
            sensitivity="Normal",
            source="Staff",
        )
        self.assertTrue(result["ok"])
        self.assertTrue(result["data"]["is_active"])

    def test_upserts_existing_preference(self):
        r1 = crm_api.update_guest_preference(
            guest_profile=self.gp.name,
            preference_type="Food",
            preference_value="Vegetarian",
        )
        r2 = crm_api.update_guest_preference(
            guest_profile=self.gp.name,
            preference_type="Food",
            preference_value="Vegetarian",
        )
        self.assertEqual(r1["data"]["guest_preference"], r2["data"]["guest_preference"])

    def test_nonexistent_profile_raises(self):
        with self.assertRaises(frappe.exceptions.DoesNotExistError):
            crm_api.update_guest_preference(
                guest_profile="DOES-NOT-EXIST",
                preference_type="Food",
                preference_value="Vegan",
            )


class TestGetGuest360(FrappeTestCase):
    def setUp(self):
        self.gp = _make_profile("360 Test Guest", email="g360@test.example")
        # Add a preference
        crm_api.update_guest_preference(
            guest_profile=self.gp.name,
            preference_type="Room",
            preference_value="High floor",
        )
        # Grant a consent
        crm_api.record_guest_consent(
            guest_profile=self.gp.name,
            purpose="Marketing",
            channel="Email",
            status="Granted",
        )

    def test_360_returns_profile(self):
        result = crm_api.get_guest_360(self.gp.name)
        self.assertTrue(result["ok"])
        data = result["data"]
        self.assertEqual(data["guest_profile"], self.gp.name)
        self.assertEqual(data["full_name"], "360 Test Guest")

    def test_360_includes_preferences(self):
        result = crm_api.get_guest_360(self.gp.name)
        prefs = result["data"]["preferences"]
        self.assertGreaterEqual(len(prefs), 1)
        self.assertEqual(prefs[0]["preference_type"], "Room")

    def test_360_includes_consents(self):
        result = crm_api.get_guest_360(self.gp.name)
        consents = result["data"]["consents"]
        self.assertGreaterEqual(len(consents), 1)
        self.assertEqual(consents[0]["purpose"], "Marketing")

    def test_360_nonexistent_profile_raises(self):
        with self.assertRaises(frappe.exceptions.DoesNotExistError):
            crm_api.get_guest_360("DOES-NOT-EXIST")


class TestListGuestProfiles(FrappeTestCase):
    """Regression: the Guests directory must never show a blank row. A profile
    with only guest_full_name/email/phone set (e.g. a legacy record predating
    the full_name sync hook, or one only reachable via those fields) must still
    surface a name and a contact via the display_name/display_contact fallback."""

    def test_legacy_profile_without_full_name_still_displays(self):
        doc = frappe.get_doc(
            {
                "doctype": "Guest Profile",
                "guest_full_name": "Legacy Only Guest",
                "phone": "+919800011122",
            }
        )
        # Bypass the controller's full_name sync to simulate a pre-hook legacy
        # record where only guest_full_name/phone ended up populated.
        doc.flags.ignore_validate = True
        doc.insert(ignore_permissions=True)
        self.assertFalse(doc.full_name)

        rows = crm_api.list_guest_profiles(search="Legacy Only Guest")["data"]["guests"]
        match = next((r for r in rows if r["name"] == doc.name), None)
        self.assertIsNotNone(match)
        self.assertEqual(match["display_name"], "Legacy Only Guest")
        self.assertEqual(match["display_contact"], "+919800011122")

    def test_list_includes_lifetime_stays_and_last_stay(self):
        doc = _make_profile("Stays Field Guest", email="stays.field@example.com")
        frappe.db.set_value("Guest Profile", doc.name, {"lifetime_stays": 3, "last_stay_date": "2026-01-01"})
        rows = crm_api.list_guest_profiles(search="Stays Field Guest")["data"]["guests"]
        match = next((r for r in rows if r["name"] == doc.name), None)
        self.assertIsNotNone(match)
        self.assertEqual(match["lifetime_stays"], 3)
        self.assertEqual(str(match["last_stay_date"]), "2026-01-01")
