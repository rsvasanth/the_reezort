"""Tests for the Property Management CRUD + equipment APIs."""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.setup import api, management


class TestPropertyManagement(FrappeTestCase):
	def setUp(self):
		self.company = frappe.db.get_value("Company", {}, "name")
		prop = api.create_property(
			{
				"property_name": "ZZ Mgmt",
				"property_code": "ZZMGMT",
				"company": self.company,
				"timezone": "Asia/Kolkata",
			}
		)["data"]["property"]["name"]
		self.prop = prop
		self.building = api.create_building(
			{"resort_property": prop, "building_name": "Blk", "building_code": "BLK"}
		)["data"]["building"]["name"]
		self.floor = api.create_floor(
			{"resort_property": prop, "building": self.building, "floor_label": "F1", "floor_code": "1"}
		)["data"]["floor"]["name"]
		self.room_type = api.create_room_type(
			{
				"resort_property": prop,
				"room_type_name": "Std",
				"room_type_code": "STD",
				"standard_adults": 2,
				"max_occupancy": 2,
			}
		)["data"]["room_type"]["name"]
		self.room = api.create_rooms_bulk(
			{
				"resort_property": prop,
				"building": self.building,
				"floor": self.floor,
				"room_type": self.room_type,
				"room_numbers": ["M101"],
			}
		)
		self.room_name = f"{prop}-M101"

	def test_update_and_soft_deactivate(self):
		res = management.update_record(
			"Room",
			self.room_name,
			{"room_name": "Sea View", "housekeeping_status": "Dirty", "reason": "Test override"},
		)
		self.assertIn("room_name", res["data"]["changed"])
		self.assertEqual(res["data"]["record"]["room_name"], "Sea View")
		self.assertEqual(res["data"]["record"]["housekeeping_status"], "Dirty")

		management.set_active("Room", self.room_name, 0)
		self.assertEqual(frappe.db.get_value("Room", self.room_name, "is_active"), 0)

	def test_amenity_catalog_and_room_equipment(self):
		wifi = management.create_amenity({"amenity_name": "WiFi", "amenity_code": "WIFI"})["data"]["amenity"]["name"]
		tv = management.create_amenity({"amenity_name": "TV", "amenity_code": "TV"})["data"]["amenity"]["name"]

		out = management.set_room_equipment(
			self.room_name,
			[
				{"amenity": wifi, "condition": "Working", "label": "Router"},
				{"amenity": tv, "condition": "Faulty", "quantity": 1},
			],
		)
		self.assertEqual(out["data"]["count"], 2)

		got = management.get_room_equipment(self.room_name)["data"]
		self.assertEqual(len(got["items"]), 2)
		conditions = {i["amenity"]: i["condition"] for i in got["items"]}
		self.assertEqual(conditions[tv], "Faulty")

		# Replacing with fewer items overwrites, not appends.
		management.set_room_equipment(self.room_name, [{"amenity": wifi, "condition": "Working"}])
		self.assertEqual(len(management.get_room_equipment(self.room_name)["data"]["items"]), 1)

	def test_equipment_rejects_unknown_amenity(self):
		with self.assertRaises(frappe.ValidationError):
			management.set_room_equipment(self.room_name, [{"amenity": "NOPE-NOT-REAL", "condition": "Working"}])

	def test_delete_guarded_by_dependents(self):
		# Property has buildings/rooms → hard delete must be refused (not crash).
		with self.assertRaises(frappe.ValidationError):
			management.delete_record("Resort Property", self.prop)

	def test_delete_unmanaged_doctype_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			management.delete_record("User", "Administrator")
