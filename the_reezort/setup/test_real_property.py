"""Tests for room-type rate plumbing (Item + Item Price + _room_rate)."""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.setup import api as setup_api
from the_reezort.reservation.api import _room_rate


class TestRoomRate(FrappeTestCase):
	def setUp(self):
		company = frappe.db.get_value("Company", {}, "name")
		self.prop = setup_api.create_property(
			{"property_name": "ZZ Rate", "property_code": "ZZRATE", "company": company, "timezone": "Asia/Kolkata"}
		)["data"]["property"]["name"]
		self.price_list = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")

	def _rate(self, item):
		return frappe.db.get_value(
			"Item Price", {"item_code": item, "price_list": self.price_list, "selling": 1}, "price_list_rate"
		)

	def test_create_room_type_with_rate_wires_item_and_price(self):
		rt = setup_api.create_room_type(
			{"resort_property": self.prop, "room_type_name": "Villa", "room_type_code": "ZZV", "standard_adults": 2, "max_occupancy": 3, "nightly_rate": 10000}
		)["data"]["room_type"]["name"]
		self.assertTrue(frappe.db.exists("Item", "ROOM-ZZV"))
		self.assertEqual(frappe.db.get_value("Room Type", rt, "erpnext_item"), "ROOM-ZZV")
		self.assertEqual(self._rate("ROOM-ZZV"), 10000)

	def test_room_rate_uses_linked_item(self):
		rt = setup_api.create_room_type(
			{"resort_property": self.prop, "room_type_name": "Villa2", "room_type_code": "ZZV2", "standard_adults": 2, "max_occupancy": 3, "nightly_rate": 7500}
		)["data"]["room_type"]["name"]
		self.assertEqual(_room_rate(rt, 3), 22500)

	def test_rate_idempotent_update_on_reuse(self):
		setup_api.create_room_type(
			{"resort_property": self.prop, "room_type_name": "Villa3", "room_type_code": "ZZV3", "standard_adults": 2, "max_occupancy": 3, "nightly_rate": 5000}
		)
		# Re-create (reuse path) with a new rate → price updates.
		setup_api.create_room_type(
			{"resort_property": self.prop, "room_type_name": "Villa3", "room_type_code": "ZZV3", "standard_adults": 2, "max_occupancy": 3, "nightly_rate": 6000}
		)
		self.assertEqual(self._rate("ROOM-ZZV3"), 6000)

	def test_room_type_without_rate_has_no_item(self):
		rt = setup_api.create_room_type(
			{"resort_property": self.prop, "room_type_name": "Free", "room_type_code": "ZZF", "standard_adults": 2, "max_occupancy": 2}
		)["data"]["room_type"]["name"]
		self.assertFalse(frappe.db.get_value("Room Type", rt, "erpnext_item"))
