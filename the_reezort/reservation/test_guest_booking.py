"""Public guest booking tests — spec 002 direct-booking channel."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.property.api import seed_demo_property
from the_reezort.reservation.guest_booking import (
	MAX_ACTIVE_HOLDS_PER_GUEST,
	guest_lookup_booking,
	guest_request_booking,
	guest_search,
)


class TestGuestBooking(FrappeTestCase):
	def setUp(self):
		self.company = frappe.db.get_value("Company", {}, "name")
		if not self.company:
			self.skipTest("ERPNext Company required.")
		self.seed = seed_demo_property(company=self.company)
		self.property = self.seed["property"]
		self.arrival = add_days(today(), 14)
		self.departure = add_days(today(), 16)
		self.room_type = frappe.db.get_value(
			"Room Type", {"resort_property": self.property, "room_type_code": "DLX"}, "name"
		)

	def _booker(self, email="guest.web@example.com"):
		return {"full_name": "Web Guest", "email": email, "phone": "+919812345678"}

	# ---- search ----

	def test_search_returns_only_safe_fields(self):
		out = guest_search(self.property, self.arrival, self.departure, adults=2)
		self.assertGreater(len(out["offers"]), 0)
		offer = out["offers"][0]
		# Guest-safe projection — internal inventory/plan fields must NOT leak.
		for leaked in ("physical_count", "blocked_count", "applied_plan", "nightly_breakdown", "season_uplift_summary"):
			self.assertNotIn(leaked, offer)
		for expected in ("room_type", "room_type_name", "available_count", "total_amount", "fits_party"):
			self.assertIn(expected, offer)

	def test_search_rejects_past_arrival(self):
		with self.assertRaises(frappe.ValidationError):
			guest_search(self.property, add_days(today(), -1), add_days(today(), 2))

	# ---- request booking ----

	def test_request_creates_hold_and_profile(self):
		out = guest_request_booking(
			property=self.property,
			arrival_date=self.arrival,
			departure_date=self.departure,
			room_type=self.room_type,
			quantity=1,
			booker=self._booker(),
		)
		self.assertTrue(out["reference"])
		self.assertEqual(out["status"], "Hold")
		res = frappe.get_doc("Reservation", out["reference"])
		self.assertEqual(res.booking_source, "Website")
		self.assertTrue(res.booker_guest_profile)
		# A Room Hold blocks the inventory.
		self.assertTrue(frappe.db.exists("Room Hold", {"reservation": out["reference"], "status": "Active"}))

	def test_request_rejects_bad_email(self):
		with self.assertRaises(frappe.ValidationError):
			guest_request_booking(
				property=self.property,
				arrival_date=self.arrival,
				departure_date=self.departure,
				room_type=self.room_type,
				booker={"full_name": "X", "email": "not-an-email", "phone": "+919812345678"},
			)

	def test_request_caps_active_holds_per_guest(self):
		email = "spammer.web@example.com"
		for _i in range(MAX_ACTIVE_HOLDS_PER_GUEST):
			guest_request_booking(
				property=self.property,
				arrival_date=self.arrival,
				departure_date=self.departure,
				room_type=self.room_type,
				booker=self._booker(email=email),
			)
		# The next one is over the cap.
		with self.assertRaises(frappe.ValidationError):
			guest_request_booking(
				property=self.property,
				arrival_date=self.arrival,
				departure_date=self.departure,
				room_type=self.room_type,
				booker=self._booker(email=email),
			)

	# ---- lookup ----

	def test_lookup_requires_matching_email(self):
		booked = guest_request_booking(
			property=self.property,
			arrival_date=self.arrival,
			departure_date=self.departure,
			room_type=self.room_type,
			booker=self._booker(email="lookup.web@example.com"),
		)
		# Correct email → returns status.
		found = guest_lookup_booking(reference=booked["reference"], email="lookup.web@example.com")
		self.assertEqual(found["reference"], booked["reference"])
		self.assertEqual(found["status"], "Hold")
		# Wrong email → generic not-found (no enumeration).
		with self.assertRaises(frappe.ValidationError):
			guest_lookup_booking(reference=booked["reference"], email="attacker@example.com")

	# ---- online deposit ----

	def test_deposit_due_is_policy_percent_of_estimate(self):
		from the_reezort.reservation.guest_booking import _deposit_due

		booked = guest_request_booking(
			property=self.property,
			arrival_date=self.arrival,
			departure_date=self.departure,
			room_type=self.room_type,
			booker=self._booker(email="deposit.web@example.com"),
		)
		doc = frappe.get_doc("Reservation", booked["reference"])
		self.assertEqual(doc.deposit_policy, "Partial")
		due, required, paid = _deposit_due(doc)
		self.assertAlmostEqual(required, round(float(doc.total_estimated_amount) * 0.2, 2), delta=0.01)
		self.assertEqual(paid, 0)
		self.assertEqual(due, required)

	def test_deposit_order_rejects_wrong_email(self):
		from the_reezort.reservation.guest_booking import guest_deposit_order

		booked = guest_request_booking(
			property=self.property,
			arrival_date=self.arrival,
			departure_date=self.departure,
			room_type=self.room_type,
			booker=self._booker(email="pay.web@example.com"),
		)
		with self.assertRaises(frappe.ValidationError):
			guest_deposit_order(reference=booked["reference"], email="attacker@example.com")
