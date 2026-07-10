"""Tests for list_reservations (2026-07-10 audit fix): status scope, pagination,
and server-side search — closing the gap where Checked In guests and anything
past the first 50 records were invisible on the Reservations screen.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.property.api import seed_demo_property
from the_reezort.reservation.api import create_quote_or_hold, list_reservations


class TestListReservations(FrappeTestCase):
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
		frappe.db.set_value("Room", {"resort_property": self.property}, "occupancy_status", "Vacant")
		frappe.db.commit()

	def _hold(self):
		return create_quote_or_hold(
			property=self.property,
			arrival_date=self.arrival,
			departure_date=self.departure,
			rooms=[{"room_type": self.room_type, "adults": 2, "children": 0}],
			source="Staff",
		)["reservation"]

	def test_default_scope_excludes_checked_in(self):
		reservation = self._hold()
		frappe.db.set_value("Reservation", reservation, "status", "Checked In")
		frappe.db.commit()

		out = list_reservations(resort_property=self.property)
		names = [r["reservation"] for r in out["reservations"]]
		self.assertNotIn(reservation, names)

	def test_status_all_includes_checked_in(self):
		reservation = self._hold()
		frappe.db.set_value("Reservation", reservation, "status", "Checked In")
		frappe.db.commit()

		out = list_reservations(resort_property=self.property, status="all")
		names = [r["reservation"] for r in out["reservations"]]
		self.assertIn(reservation, names)

	def test_explicit_status_list_via_csv(self):
		reservation = self._hold()
		frappe.db.set_value("Reservation", reservation, "status", "Checked In")
		frappe.db.commit()

		out = list_reservations(resort_property=self.property, status="Checked In,Completed")
		names = [r["reservation"] for r in out["reservations"]]
		self.assertIn(reservation, names)

	def test_pagination_does_not_silently_truncate(self):
		for _ in range(3):
			self._hold()

		page_one = list_reservations(resort_property=self.property, page=1, page_length=2)
		self.assertEqual(len(page_one["reservations"]), 2)
		self.assertGreaterEqual(page_one["total_count"], 3)

		page_two = list_reservations(resort_property=self.property, page=2, page_length=2)
		self.assertGreaterEqual(len(page_two["reservations"]), 1)
		# No overlap between pages.
		self.assertEqual(
			set(r["reservation"] for r in page_one["reservations"])
			& set(r["reservation"] for r in page_two["reservations"]),
			set(),
		)

	def test_search_matches_reservation_name_beyond_first_page(self):
		reservation = self._hold()
		out = list_reservations(resort_property=self.property, search=reservation)
		names = [r["reservation"] for r in out["reservations"]]
		self.assertEqual(names, [reservation])

	def test_search_with_no_match_returns_empty_not_error(self):
		out = list_reservations(resort_property=self.property, search="NO-SUCH-RESERVATION-XYZ")
		self.assertEqual(out["reservations"], [])
		self.assertEqual(out["total_count"], 0)
