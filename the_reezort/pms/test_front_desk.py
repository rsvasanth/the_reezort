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
