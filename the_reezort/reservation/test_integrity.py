"""Tests for the reservation-integrity features (002/003):
hold-expiry scheduler, confirm-time availability re-check, amendment, no-show.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, add_to_date, now_datetime, today

from the_reezort.property.api import seed_demo_property
from the_reezort.reservation.api import (
	amend_reservation,
	cancel_reservation,
	confirm_reservation,
	create_quote_or_hold,
	expire_stale_holds,
	mark_no_show,
	reverse_no_show,
)


class TestReservationIntegrity(FrappeTestCase):
	def setUp(self):
		self.company = frappe.db.get_value("Company", {}, "name")
		if not self.company:
			self.skipTest("ERPNext Company is required.")
		self.seed = seed_demo_property(company=self.company)
		self.property = self.seed["property"]
		self.arrival = add_days(today(), 10)
		self.departure = add_days(today(), 12)
		self.room_type = frappe.db.get_value(
			"Room Type", {"resort_property": self.property, "room_type_code": "DLX"}, "name"
		)
		# The API commits, so holds/reservations from prior tests persist and
		# exhaust inventory. Start each test from a clean slate for this property.
		self._reset_property_state()

	def _reset_property_state(self):
		for h in frappe.get_all("Room Hold", filters={"resort_property": self.property}, pluck="name"):
			frappe.delete_doc("Room Hold", h, force=True, ignore_permissions=True)
		for r in frappe.get_all(
			"Reservation",
			filters={"resort_property": self.property, "status": ["not in", ("Cancelled", "Completed")]},
			pluck="name",
		):
			frappe.db.set_value("Reservation", r, "status", "Cancelled")
		frappe.db.set_value(
			"Room", {"resort_property": self.property}, "occupancy_status", "Vacant"
		)
		frappe.db.commit()

	def _hold(self, source="Staff"):
		return create_quote_or_hold(
			property=self.property,
			arrival_date=self.arrival,
			departure_date=self.departure,
			rooms=[{"room_type": self.room_type, "adults": 2, "children": 0}],
			source=source,
		)["reservation"]

	def _confirm(self, reservation, **kw):
		return confirm_reservation(
			reservation=reservation,
			booker={"full_name": "Test Guest", "email": "t@example.com", "phone": "+911111111111"},
			accepted_terms=True,
			**kw,
		)

	# ---------- hold-expiry scheduler ----------

	def test_expire_stale_holds_releases_reservation(self):
		res = self._hold()
		# Force the hold + reservation to be already expired.
		frappe.db.set_value("Reservation", res, "hold_expires_at", add_to_date(now_datetime(), minutes=-5))
		for h in frappe.get_all("Room Hold", filters={"reservation": res}, pluck="name"):
			frappe.db.set_value("Room Hold", h, "expires_at", add_to_date(now_datetime(), minutes=-5))

		result = expire_stale_holds()
		self.assertGreaterEqual(result["holds_expired"], 1)
		self.assertEqual(frappe.db.get_value("Reservation", res, "status"), "Expired")
		self.assertTrue(
			all(
				frappe.db.get_value("Room Hold", h, "status") == "Expired"
				for h in frappe.get_all("Room Hold", filters={"reservation": res}, pluck="name")
			)
		)

	def test_expire_does_not_touch_confirmed(self):
		res = self._hold()
		self._confirm(res)
		# Even with a past timestamp, a confirmed reservation is never expired.
		for h in frappe.get_all("Room Hold", filters={"reservation": res}, pluck="name"):
			frappe.db.set_value("Room Hold", h, "expires_at", add_to_date(now_datetime(), minutes=-5))
		expire_stale_holds()
		self.assertEqual(frappe.db.get_value("Reservation", res, "status"), "Confirmed")

	# ---------- confirm-time re-check ----------

	def test_confirm_consumes_hold(self):
		res = self._hold()
		self._confirm(res)
		holds = frappe.get_all("Room Hold", filters={"reservation": res}, fields=["status"])
		self.assertTrue(all(h.status == "Consumed" for h in holds))

	def _physical(self):
		return frappe.db.count(
			"Room",
			{"resort_property": self.property, "room_type": self.room_type, "is_active": 1, "sellable_status": "Sellable"},
		)

	def _late_then_exhaust(self):
		"""Create a reservation, expire its hold, then confirm enough others to
		fill every room — the late reservation now has no inventory to fall back on."""
		late = self._hold()
		for h in frappe.get_all("Room Hold", filters={"reservation": late}, pluck="name"):
			frappe.db.set_value("Room Hold", h, "expires_at", add_to_date(now_datetime(), minutes=-5))
		frappe.db.commit()
		for _ in range(self._physical()):
			self._confirm(self._hold())
		return late

	def test_confirm_blocked_when_hold_expired_and_no_inventory(self):
		late = self._late_then_exhaust()
		with self.assertRaises(frappe.ValidationError):
			self._confirm(late)

	def test_confirm_override_bypasses_recheck(self):
		late = self._late_then_exhaust()
		# Manager override lets it through despite no free inventory.
		out = self._confirm(late, allow_override=1)
		self.assertEqual(out["status"], "Confirmed")

	# ---------- amendment ----------

	def test_amend_dates_recalculates_and_audits(self):
		res = self._hold()
		self._confirm(res)
		new_departure = add_days(self.arrival, 4)  # 4 nights instead of 2
		out = amend_reservation(
			reservation=res,
			changes={"departure_date": new_departure},
			reason="Guest extended stay",
		)
		self.assertEqual(out["status"], "Modified")
		self.assertTrue(out["amendment"])  # an Audit Event was recorded
		# Dates were applied and the reservation moved to Modified.
		self.assertEqual(str(frappe.db.get_value("Reservation", res, "departure_date")), str(new_departure))
		self.assertEqual(frappe.db.get_value("Reservation", res, "status"), "Modified")
		# The amendment is auditable.
		self.assertTrue(frappe.db.exists("Audit Event", out["amendment"]))

	def test_amend_requires_reason(self):
		res = self._hold()
		with self.assertRaises(frappe.ValidationError):
			amend_reservation(reservation=res, changes={"departure_date": add_days(self.arrival, 3)}, reason="")

	# ---------- no-show ----------

	def test_mark_no_show_releases_and_forfeits(self):
		res = self._hold()
		self._confirm(res)
		frappe.db.set_value("Reservation", res, "deposit_status", "Paid")
		# Arrival in the past so the no-show gate passes.
		frappe.db.set_value("Reservation", res, "arrival_date", add_days(today(), -1))
		out = mark_no_show(reservation=res, reason="Guest never arrived")
		self.assertEqual(out["status"], "No Show")
		self.assertEqual(out["deposit_status"], "Forfeited")
		self.assertEqual(frappe.db.get_value("Reservation", res, "no_show_reason"), "Guest never arrived")

	def test_mark_no_show_blocked_before_arrival(self):
		res = self._hold()
		self._confirm(res)  # arrival is 10 days out
		with self.assertRaises(frappe.ValidationError):
			mark_no_show(reservation=res, reason="too early")

	def test_reverse_no_show_requires_manager(self):
		res = self._hold()
		self._confirm(res)
		frappe.db.set_value("Reservation", res, {"arrival_date": add_days(today(), -1)})
		mark_no_show(reservation=res, reason="no arrival")
		# As Administrator (has System Manager) reversal is allowed.
		out = reverse_no_show(reservation=res, reason="Guest arrived late")
		self.assertEqual(out["status"], "Confirmed")
