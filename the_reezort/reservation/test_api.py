import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.property.api import seed_demo_property
from the_reezort.reservation.api import (
	cancel_reservation,
	confirm_reservation,
	create_quote_or_hold,
	get_reservation_summary,
	search_availability,
	set_reservation_bill_to,
)
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestReservationAPI(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		# ERPNext's own before_tests hook unconditionally wipes every Item Price
		# row at the start of a bench run-tests invocation (erpnext.setup.utils.
		# before_tests). Re-seed the room-rate pricing this module depends on —
		# otherwise every estimated/deposit amount silently prices at 0.
		company = frappe.db.get_value("Company", {}, "name")
		if company:
			seed_erpnext_demo_masters(company, currency=frappe.db.get_value("Company", company, "default_currency") or "INR")

	def setUp(self):
		# Several endpoints under test (create_quote_or_hold, confirm_reservation, ...)
		# call frappe.db.commit() internally — a real production requirement, but it
		# defeats FrappeTestCase's rollback-based isolation (which only undoes
		# uncommitted work at class teardown), permanently leaking test data into
		# this site on every run. Suppress commits for the duration of each test;
		# reads within the same transaction still see the writes.
		self._real_commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None
		self.addCleanup(lambda: setattr(frappe.db, "commit", self._real_commit))

		self.company = frappe.db.get_value("Company", {}, "name")
		if not self.company:
			self.skipTest("ERPNext Company is required for reservation tests.")

		self.seed = seed_demo_property(company=self.company)
		self.property = self.seed["property"]
		self.arrival = add_days(today(), 10)
		self.departure = add_days(today(), 12)
		self.room_type = frappe.db.get_value("Room Type", {"resort_property": self.property, "room_type_code": "DLX"}, "name")

	def test_search_availability_returns_offers(self):
		result = search_availability(
			property=self.property,
			arrival_date=self.arrival,
			departure_date=self.departure,
			rooms=[{"adults": 2, "children": 0}],
		)

		self.assertGreater(len(result["offers"]), 0)
		self.assertIn("available_count", result["offers"][0])

	def test_create_hold_reduces_availability(self):
		before = search_availability(
			property=self.property,
			arrival_date=self.arrival,
			departure_date=self.departure,
			rooms=[{"adults": 2, "children": 0}],
		)
		before_count = next(row["available_count"] for row in before["offers"] if row["room_type"] == self.room_type)

		hold = create_quote_or_hold(
			property=self.property,
			arrival_date=self.arrival,
			departure_date=self.departure,
			rooms=[{"room_type": self.room_type, "adults": 2, "children": 0}],
			source="Staff",
		)

		after = search_availability(
			property=self.property,
			arrival_date=self.arrival,
			departure_date=self.departure,
			rooms=[{"adults": 2, "children": 0}],
		)
		after_count = next(row["available_count"] for row in after["offers"] if row["room_type"] == self.room_type)

		self.assertEqual(hold["status"], "Hold")
		self.assertEqual(after_count, before_count - 1)

	def test_confirm_reservation_consumes_hold(self):
		# Switch the policy off so the deposit gate doesn't fire here — this test
		# covers the consume-hold path. The gate has its own tests below.
		hold = create_quote_or_hold(
			property=self.property,
			arrival_date=add_days(today(), 20),
			departure_date=add_days(today(), 22),
			rooms=[{"room_type": self.room_type, "adults": 2, "children": 0}],
			source="Staff",
		)
		frappe.db.set_value("Reservation", hold["reservation"], "deposit_policy", "None")

		result = confirm_reservation(
			reservation=hold["reservation"],
			booker={"full_name": "Asha Mehta", "email": "asha@example.com", "phone": "+919999999999"},
			guests=[{"guest_name": "Asha Mehta", "is_primary_guest": True}],
			guarantee={"method": "Manual Approval"},
			accepted_terms=True,
		)

		self.assertEqual(result["status"], "Confirmed")
		self.assertEqual(frappe.db.get_value("Room Hold", {"reservation": hold["reservation"]}, "status"), "Consumed")

	def _confirm_fresh(self, days, booker):
		hold = create_quote_or_hold(
			property=self.property,
			arrival_date=add_days(today(), days),
			departure_date=add_days(today(), days + 2),
			rooms=[{"room_type": self.room_type, "adults": 2, "children": 0}],
			source="Staff",
		)
		frappe.db.set_value("Reservation", hold["reservation"], "deposit_policy", "None")
		confirm_reservation(
			reservation=hold["reservation"],
			booker=booker,
			guests=[{"guest_name": booker["full_name"], "is_primary_guest": True}],
			guarantee={"method": "Manual Approval"},
			accepted_terms=True,
		)
		return hold["reservation"]

	def test_confirm_links_erpnext_customer(self):
		reservation = self._confirm_fresh(30, {"full_name": "Corp Traveler", "email": "corp.traveler@example.com"})
		customer = frappe.db.get_value("Reservation", reservation, "erpnext_customer")
		self.assertTrue(customer, "confirmation should link an ERPNext Customer")
		self.assertTrue(frappe.db.exists("Customer", customer))

	def test_set_bill_to_customer_override(self):
		reservation = self._confirm_fresh(40, {"full_name": "TA Guest", "email": "ta.guest@example.com"})
		corp = frappe.get_doc(
			{
				"doctype": "Customer",
				"customer_name": "ZZ Acme Corp Travel",
				"customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
				"territory": frappe.db.get_value("Territory", {"is_group": 0}, "name"),
			}
		).insert(ignore_permissions=True).name

		out = set_reservation_bill_to(reservation=reservation, bill_to_customer=corp)
		self.assertEqual(out["bill_to_customer"], corp)
		self.assertEqual(frappe.db.get_value("Reservation", reservation, "bill_to_customer"), corp)

		cleared = set_reservation_bill_to(reservation=reservation, bill_to_customer=None)
		self.assertIsNone(cleared["bill_to_customer"])

	def test_set_bill_to_rejects_unknown_customer(self):
		reservation = self._confirm_fresh(50, {"full_name": "Ghost Guest", "email": "ghost@example.com"})
		with self.assertRaises(frappe.ValidationError):
			set_reservation_bill_to(reservation=reservation, bill_to_customer="NON-EXISTENT-CUST-999")

	# ---------- overbooking override approval gate (spec 002) ----------

	def _seed_override_policy(self, auto_role=None):
		# Approval Policy autonames on (action, threshold_amount) alone, so every
		# call here — from any test in this class — targets the same row. Clear
		# it first so tests don't collide with each other or with a prior run.
		frappe.db.delete("Approval Policy", {"action": "reservation_override", "threshold_amount": 0})
		return frappe.get_doc(
			{
				"doctype": "Approval Policy",
				"policy_name": f"reservation_override test {auto_role or 'none'}",
				"action": "reservation_override",
				"approver_role": "Resort Manager",
				"auto_approve_for_role": auto_role,
				"threshold_amount": 0,
				"source_doctype": "Reservation",
				"is_active": 1,
			}
		).insert(ignore_permissions=True)

	def test_override_gate_is_noop_without_policy(self):
		from the_reezort.reservation.api import _authorize_override

		# No policy configured → override proceeds silently (backward compatible).
		_authorize_override("RES-NOPOLICY", ["DLX"])

	def test_override_gate_requires_approval_with_policy(self):
		from the_reezort.approvals.api import ApprovalRequired
		from the_reezort.reservation.api import _authorize_override

		self._seed_override_policy()
		with self.assertRaises(ApprovalRequired):
			_authorize_override("RES-GATED", ["DLX"])

	def test_override_gate_auto_approves_for_role(self):
		from the_reezort.reservation.api import _authorize_override

		# Administrator holds System Manager → auto-approved, no raise.
		self._seed_override_policy(auto_role="System Manager")
		_authorize_override("RES-AUTO", ["DLX"])

	# ---------- forecast report ----------

	def test_forecast_counts_arrivals_in_window(self):
		from the_reezort.reservation.api import get_reservation_forecast

		reservation = self._confirm_fresh(6, {"full_name": "Forecast Guest", "email": "forecast@example.com"})
		arrival = str(frappe.db.get_value("Reservation", reservation, "arrival_date"))

		out = get_reservation_forecast(resort_property=self.property, start_date=str(today()), days=14)
		self.assertEqual(len(out["forecast"]), 14)
		day = next((d for d in out["forecast"] if d["date"] == arrival), None)
		self.assertIsNotNone(day, "the arrival day should be a bucket in the window")
		self.assertGreaterEqual(day["arrivals"], 1)
		self.assertGreaterEqual(day["rooms"], 1)
		self.assertGreaterEqual(out["totals"]["arrivals"], 1)

	def test_confirm_blocked_when_deposit_not_paid_under_partial_policy(self):
		hold = create_quote_or_hold(
			property=self.property,
			arrival_date=add_days(today(), 25),
			departure_date=add_days(today(), 27),
			rooms=[{"room_type": self.room_type, "adults": 2, "children": 0}],
			source="Staff",
		)
		# Default policy is now Partial; no deposit recorded -> confirm must throw.
		with self.assertRaises(frappe.ValidationError):
			confirm_reservation(
				reservation=hold["reservation"],
				booker={"full_name": "Block Test", "email": "block@example.com"},
				guests=[{"guest_name": "Block Test", "is_primary_guest": True}],
				guarantee={"method": "Manual Approval"},
				accepted_terms=True,
			)
		# Reservation moves to Deposit Pending so the UI can show the gate.
		self.assertEqual(frappe.db.get_value("Reservation", hold["reservation"], "status"), "Deposit Pending")

	def test_confirm_succeeds_after_recording_the_required_deposit(self):
		from the_reezort.reservation.api import get_reservation_deposit_state, record_booking_deposit

		hold = create_quote_or_hold(
			property=self.property,
			arrival_date=add_days(today(), 35),
			departure_date=add_days(today(), 37),
			rooms=[{"room_type": self.room_type, "adults": 2, "children": 0}],
			source="Staff",
		)
		state = get_reservation_deposit_state(hold["reservation"])
		self.assertGreater(state["required_amount"], 0)
		# Take the 20% deposit through the booking-deposit endpoint (carries booker → customer + folio).
		out = record_booking_deposit(
			reservation=hold["reservation"],
			booker={"full_name": "OK Test", "email": "ok@example.com", "phone": "+919999999998"},
			amount=state["required_amount"],
			mode_of_payment="Cash",
		)
		self.assertTrue(out["state"]["met"])

		result = confirm_reservation(
			reservation=hold["reservation"],
			booker={"full_name": "OK Test", "email": "ok@example.com"},
			guests=[{"guest_name": "OK Test", "is_primary_guest": True}],
			guarantee={"method": "Manual Approval"},
			accepted_terms=True,
		)
		self.assertEqual(result["status"], "Confirmed")
		self.assertEqual(frappe.db.get_value("Reservation", hold["reservation"], "deposit_status"), "Paid")

	def test_cancel_reservation_releases_hold(self):
		hold = create_quote_or_hold(
			property=self.property,
			arrival_date=add_days(today(), 30),
			departure_date=add_days(today(), 32),
			rooms=[{"room_type": self.room_type, "adults": 2, "children": 0}],
			source="Staff",
		)

		result = cancel_reservation(reservation=hold["reservation"], reason="Guest Request")

		self.assertEqual(result["status"], "Cancelled")
		self.assertEqual(frappe.db.get_value("Room Hold", {"reservation": hold["reservation"]}, "status"), "Released")

	def test_get_reservation_summary(self):
		hold = create_quote_or_hold(
			property=self.property,
			arrival_date=add_days(today(), 40),
			departure_date=add_days(today(), 42),
			rooms=[{"room_type": self.room_type, "adults": 2, "children": 0}],
			source="Staff",
		)

		summary = get_reservation_summary(reservation=hold["reservation"])

		self.assertEqual(summary["reservation"], hold["reservation"])
		self.assertEqual(summary["status"], "Hold")
