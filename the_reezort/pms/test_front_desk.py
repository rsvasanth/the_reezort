"""Tests for the Front Desk board."""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.setup import api as setup_api
from the_reezort.pms import front_desk


class TestFrontDesk(FrappeTestCase):
	def setUp(self):
		company = frappe.db.get_value("Company", {}, "name")
		self.prop = setup_api.create_property(
			{"property_name": "ZZ FD", "property_code": "ZZFD", "company": company, "timezone": "Asia/Kolkata"}
		)["data"]["property"]["name"]
		self.rt = setup_api.create_room_type(
			{"resort_property": self.prop, "room_type_name": "Std", "room_type_code": "STD", "standard_adults": 2, "max_occupancy": 2}
		)["data"]["room_type"]["name"]
		building = setup_api.create_building(
			{"resort_property": self.prop, "building_name": "B", "building_code": "B"}
		)["data"]["building"]["name"]
		floor = setup_api.create_floor(
			{"resort_property": self.prop, "building": building, "floor_label": "F1", "floor_code": "1"}
		)["data"]["floor"]["name"]
		setup_api.create_rooms_bulk(
			{"resort_property": self.prop, "building": building, "floor": floor, "room_type": self.rt, "room_numbers": ["F01"]}
		)
		self.stay = frappe.get_doc(
			{
				"doctype": "Stay",
				"resort_property": self.prop,
				"customer": frappe.db.get_value("Customer", {}, "name") or frappe.get_doc({"doctype": "Customer", "customer_name": "ZZ FD Guest"}).insert(ignore_permissions=True).name,
				"primary_guest_name": "In House Guest",
				"stay_status": "In House",
				"arrival_date": "2026-06-26",
				"departure_date": "2026-06-30",
				"room_type": self.rt,
				"current_room": f"{self.prop}-F01",
				"folio_status": "Active",
			}
		).insert(ignore_permissions=True).name

	def test_board_structure_and_in_house(self):
		board = front_desk.get_front_desk_board(resort_property=self.prop)
		self.assertIn("arrivals", board)
		self.assertIn("in_house", board)
		self.assertIn("counts", board)
		rows = [r for r in board["in_house"] if r["stay"] == self.stay]
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0]["guest"], "In House Guest")
		self.assertEqual(board["counts"]["in_house"], 1)

	def test_guest_requires_login(self):
		frappe.set_user("Guest")
		try:
			with self.assertRaises(frappe.PermissionError):
				front_desk.get_front_desk_board()
		finally:
			frappe.set_user("Administrator")

	def _arrival(self, kyc_verified, deposit_status, guest_name):
		from the_reezort.reservation.api import create_quote_or_hold

		hold = create_quote_or_hold(
			property=self.prop,
			arrival_date="2026-07-01",
			departure_date="2026-07-03",
			rooms=[{"room_type": self.rt, "adults": 2, "children": 0}],
			source="Staff",
		)
		res = hold["reservation"]
		profile = frappe.get_doc(
			{"doctype": "Guest Profile", "guest_full_name": guest_name, "kyc_verified": kyc_verified}
		).insert(ignore_permissions=True).name
		frappe.db.set_value(
			"Reservation",
			res,
			{"status": "Confirmed", "staying_guest_profile": profile, "deposit_status": deposit_status},
		)
		return res

	def test_arrival_carries_readiness_with_blockers(self):
		res = self._arrival(kyc_verified=0, deposit_status="Pending", guest_name="ZZ Blocked Guest")
		board = front_desk.get_front_desk_board(resort_property=self.prop)
		row = next((a for a in board["arrivals"] if a["reservation"] == res), None)
		self.assertIsNotNone(row)
		r = row["readiness"]
		self.assertEqual(r["kyc"], "pending")  # profile exists, not verified
		self.assertEqual(r["deposit"], "Pending")
		self.assertEqual(r["registration"], "pending")
		self.assertFalse(r["clear"])

	def test_arrival_clear_when_kyc_and_deposit_settled(self):
		res = self._arrival(kyc_verified=1, deposit_status="Paid", guest_name="ZZ Clear Guest")
		board = front_desk.get_front_desk_board(resort_property=self.prop)
		row = next((a for a in board["arrivals"] if a["reservation"] == res), None)
		self.assertIsNotNone(row)
		self.assertEqual(row["readiness"]["kyc"], "verified")
		self.assertTrue(row["readiness"]["clear"])
