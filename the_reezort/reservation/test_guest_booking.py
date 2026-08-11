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
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestGuestBooking(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		# ERPNext's own before_tests hook unconditionally wipes every Item Price
		# row at the start of a bench run-tests invocation (erpnext.setup.utils.
		# before_tests). Re-seed the room-rate pricing this module depends on —
		# otherwise every quoted/estimated amount silently prices at 0.
		company = frappe.db.get_value("Company", {}, "name")
		if company:
			seed_erpnext_demo_masters(company, currency=frappe.db.get_value("Company", company, "default_currency") or "INR")

	def setUp(self):
		# guest_request_booking() commits internally (real production requirement),
		# which defeats FrappeTestCase's rollback-based isolation and permanently
		# leaks Guest Profile / Reservation / Room Hold rows into this site on every
		# run. Suppress commits for the duration of each test.
		self._real_commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None
		self.addCleanup(lambda: setattr(frappe.db, "commit", self._real_commit))

		self.company = frappe.db.get_value("Company", {}, "name")
		if not self.company:
			self.skipTest("ERPNext Company required.")
		self.seed = seed_demo_property(company=self.company)
		self.property = self.seed["property"]
		# FrappeTestCase only rolls back at class teardown, not between tests, so
		# every test method in this class runs against the same DB state the
		# previous ones left behind. A fixed date range would make the handful of
		# room-booking tests here compete for the same 5-room DLX inventory and
		# fail in whichever order happens to exhaust it first — offset the window
		# per test method so each one books against its own slice of the calendar.
		day_offset = 14 + (abs(hash(self._testMethodName)) % 300)
		self.arrival = add_days(today(), day_offset)
		self.departure = add_days(today(), day_offset + 2)
		self.room_type = frappe.db.get_value(
			"Room Type", {"resort_property": self.property, "room_type_code": "DLX"}, "name"
		)
		# Guest identity emails are suffixed per test run so a run's assertions
		# never depend on (or collide with) another run's leftover Guest Profile /
		# Reservation state for a "fixed" address like "spammer.web@example.com".
		self._run = frappe.generate_hash(length=6)

	def _email(self, label):
		return f"{label}.{self._run}@example.com"

	def _booker(self, email=None):
		# _get_or_create_guest_profile() also matches on phone, so this must be
		# unique per test run too — otherwise two tests with different emails
		# but the same fixed phone silently collapse onto one Guest Profile and
		# each other's holds count toward MAX_ACTIVE_HOLDS_PER_GUEST.
		return {"full_name": "Web Guest", "email": email or self._email("guest.web"), "phone": f"+9198{self._run}00"}

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
		email = self._email("spammer.web")
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
		email = self._email("lookup.web")
		booked = guest_request_booking(
			property=self.property,
			arrival_date=self.arrival,
			departure_date=self.departure,
			room_type=self.room_type,
			booker=self._booker(email=email),
		)
		# Correct email → returns status.
		found = guest_lookup_booking(reference=booked["reference"], email=email)
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
			booker=self._booker(email=self._email("deposit.web")),
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
			booker=self._booker(email=self._email("pay.web")),
		)
		with self.assertRaises(frappe.ValidationError):
			guest_deposit_order(reference=booked["reference"], email="attacker@example.com")

	def test_request_backfills_email_on_phone_matched_profile(self):
		"""Regression: a Guest Profile created earlier with only a phone number
		(no email) must get the email backfilled when a later booking supplies
		one — otherwise the email-gated lookup/deposit endpoints can never match
		this guest again even though they gave a valid email on this booking."""
		phone = f"+9198{self._run}01"
		email = self._email("backfill.web")
		stale = frappe.get_doc(
			{"doctype": "Guest Profile", "guest_full_name": "Phone Only Guest", "phone": phone}
		).insert(ignore_permissions=True)
		self.assertFalse(stale.email)

		booked = guest_request_booking(
			property=self.property,
			arrival_date=self.arrival,
			departure_date=self.departure,
			room_type=self.room_type,
			booker={"full_name": "Phone Only Guest", "email": email, "phone": phone},
		)
		res = frappe.get_doc("Reservation", booked["reference"])
		self.assertEqual(res.booker_guest_profile, stale.name)
		stale.reload()
		self.assertEqual(stale.email, email)

		# The lookup now succeeds with the backfilled email.
		found = guest_lookup_booking(reference=booked["reference"], email=email)
		self.assertEqual(found["reference"], booked["reference"])
