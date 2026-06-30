"""Tests for the full check-in process (003): context, KYC, registration, finalize gate."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.pms.api import (
	get_check_in_context,
	save_guest_kyc,
	save_registration_card,
	finalize_check_in,
)
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestCheckInProcess(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]
		cls.room_type = frappe.db.get_value(
			"Room",
			{"resort_property": cls.resort_property, "sellable_status": "Sellable", "occupancy_status": "Vacant", "is_active": 1},
			"room_type",
		)

	def setUp(self):
		super().setUp()
		# finalize_check_in commits, so reset room occupancy before each test for isolation.
		frappe.db.set_value("Room", {"resort_property": self.resort_property}, "occupancy_status", "Vacant")

	def _reservation(self, with_profile=True):
		profile_name = None
		if with_profile:
			profile_name = frappe.get_doc(
				{
					"doctype": "Guest Profile",
					"guest_full_name": "Arrival Guest",
					"email": frappe.generate_hash(length=8) + "@example.com",
				}
			).insert(ignore_permissions=True).name

		return frappe.get_doc(
			{
				"doctype": "Reservation",
				"resort_property": self.resort_property,
				"status": "Confirmed",
				"booking_source": "Direct",
				"arrival_date": add_days(today(), 1),
				"departure_date": add_days(today(), 3),
				"currency": self.currency,
				"staying_guest_profile": profile_name,
				"guests": [
					{
						"guest_profile": profile_name,
						"guest_name": "Arrival Guest",
						"guest_type": "Adult",
						"is_primary_guest": 1,
						"nationality": "Indian",
					}
				],
				"rooms": [{"room_type": self.room_type, "adults": 2, "children": 0, "status": "Confirmed"}],
			}
		).insert(ignore_permissions=True)

	# ---------- context ----------

	def test_context_shape_and_initial_readiness(self):
		res = self._reservation()
		ctx = get_check_in_context(res.name)

		self.assertEqual(ctx["reservation"], res.name)
		self.assertEqual(ctx["room_type"], self.room_type)
		self.assertTrue(len(ctx["available_rooms"]) > 0)
		self.assertEqual(ctx["nights"], 2)
		self.assertIsNotNone(ctx["guest"])
		# Nothing captured yet -> not ready to finalize.
		self.assertFalse(ctx["readiness"]["kyc"])
		self.assertFalse(ctx["readiness"]["registration"])
		self.assertFalse(ctx["readiness"]["can_finalize"])

	# ---------- KYC ----------

	def test_save_kyc_persists_and_verifies(self):
		res = self._reservation()
		out = save_guest_kyc(
			res.name,
			{"id_type": "Passport", "id_number": "P1234567", "nationality": "Indian", "address": "1 Beach Rd"},
			verify=1,
		)
		guest = frappe.get_doc("Guest Profile", out["guest_profile"])
		self.assertEqual(guest.id_type, "Passport")
		self.assertEqual(guest.id_number, "P1234567")
		self.assertTrue(guest.kyc_verified)
		self.assertTrue(guest.kyc_verified_at)
		self.assertEqual(get_check_in_context(res.name)["readiness"]["kyc"], True)

	def test_save_kyc_creates_profile_when_missing(self):
		res = self._reservation(with_profile=False)
		self.assertFalse(frappe.db.get_value("Reservation", res.name, "staying_guest_profile"))
		out = save_guest_kyc(res.name, {"id_type": "Aadhaar", "id_number": "1111 2222 3333"}, verify=1)
		self.assertTrue(out["guest_profile"])
		self.assertEqual(
			frappe.db.get_value("Reservation", res.name, "staying_guest_profile"), out["guest_profile"]
		)

	# ---------- registration card ----------

	def test_registration_card_idempotent_and_signing(self):
		res = self._reservation()
		first = save_registration_card(res.name, {"purpose_of_visit": "Leisure", "vehicle_number": "TN-01-1234"})
		self.assertFalse(first["registration_card"]["is_signed"])

		# Re-save with signature + terms -> same card, now signed.
		second = save_registration_card(
			res.name, {"signature": "data:image/png;base64,AAAA", "terms_accepted": 1}
		)
		self.assertEqual(first["registration_card"]["name"], second["registration_card"]["name"])
		self.assertTrue(second["registration_card"]["is_signed"])
		self.assertTrue(second["registration_card"]["signed_at"])
		self.assertEqual(
			frappe.db.count("Guest Registration Card", {"reservation": res.name}), 1
		)

	# ---------- finalize gate ----------

	def test_registration_card_snapshots_identity_from_profile(self):
		res = self._reservation()
		save_guest_kyc(res.name, {"id_type": "Passport", "id_number": "P55", "nationality": "Indian"}, verify=1)
		# Card payload carries no ID fields — they must be snapshotted from the profile.
		out = save_registration_card(res.name, {"purpose_of_visit": "Leisure"})
		card = out["registration_card"]
		self.assertEqual(card["id_type"], "Passport")
		self.assertEqual(card["id_number"], "P55")
		self.assertEqual(card["nationality"], "Indian")

	def test_finalize_blocked_without_kyc(self):
		res = self._reservation()
		with self.assertRaises(frappe.ValidationError):
			finalize_check_in(res.name)

	def test_finalize_blocked_without_signed_card(self):
		res = self._reservation()
		save_guest_kyc(res.name, {"id_type": "Passport", "id_number": "P1"}, verify=1)
		# No signed registration card yet.
		with self.assertRaises(frappe.ValidationError):
			finalize_check_in(res.name)

	def test_finalize_succeeds_when_ready_and_backfills_card(self):
		res = self._reservation()
		save_guest_kyc(res.name, {"id_type": "Passport", "id_number": "P1"}, verify=1)
		save_registration_card(res.name, {"signature": "data:image/png;base64,AAAA", "terms_accepted": 1})

		result = finalize_check_in(res.name)
		stay = frappe.get_doc("Stay", result["stay"])
		self.assertEqual(stay.stay_status, "In House")
		self.assertTrue(stay.current_room)
		# Card backfilled with the created stay.
		self.assertEqual(
			frappe.db.get_value("Guest Registration Card", result["registration_card"], "stay"), stay.name
		)

	def test_finalize_enforce_off_skips_gate(self):
		res = self._reservation()
		# No KYC, no card, but enforce=0 -> still checks in (used for migration/back-office).
		result = finalize_check_in(res.name, enforce=0)
		self.assertEqual(frappe.db.get_value("Stay", result["stay"], "stay_status"), "In House")
