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
)


class TestReservationAPI(FrappeTestCase):
	def setUp(self):
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
		hold = create_quote_or_hold(
			property=self.property,
			arrival_date=add_days(today(), 20),
			departure_date=add_days(today(), 22),
			rooms=[{"room_type": self.room_type, "adults": 2, "children": 0}],
			source="Staff",
		)

		result = confirm_reservation(
			reservation=hold["reservation"],
			booker={"full_name": "Asha Mehta", "email": "asha@example.com", "phone": "+919999999999"},
			guests=[{"guest_name": "Asha Mehta", "is_primary_guest": True}],
			guarantee={"method": "Manual Approval"},
			accepted_terms=True,
		)

		self.assertEqual(result["status"], "Confirmed")
		self.assertEqual(frappe.db.get_value("Room Hold", {"reservation": hold["reservation"]}, "status"), "Consumed")

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
