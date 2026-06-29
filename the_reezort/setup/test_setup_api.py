"""Tests for the Property Setup onboarding APIs.

Runs as Administrator inside FrappeTestCase's rolled-back transaction, so the
created masters never persist.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.setup import api


class TestPropertySetup(FrappeTestCase):
	def setUp(self):
		self.company = frappe.db.get_value("Company", {}, "name")
		self.assertTrue(self.company, "test site has no Company to attach a property to")
		self.code = "ZZSETUP"

	def test_full_chain_and_idempotency(self):
		created = api.create_property(
			{
				"property_name": "ZZ Setup Test",
				"property_code": self.code,
				"company": self.company,
				"timezone": "Asia/Kolkata",
			}
		)
		self.assertTrue(created["ok"])
		self.assertFalse(created["data"]["reused"])
		prop = created["data"]["property"]["name"]

		# Re-running the same step reuses, never duplicates.
		again = api.create_property(
			{
				"property_name": "ZZ Setup Test",
				"property_code": self.code,
				"company": self.company,
				"timezone": "Asia/Kolkata",
			}
		)
		self.assertTrue(again["data"]["reused"])
		self.assertEqual(again["data"]["property"]["name"], prop)

		building = api.create_building(
			{"resort_property": prop, "building_name": "Block A", "building_code": "BLKA"}
		)["data"]["building"]["name"]

		floor = api.create_floor(
			{"resort_property": prop, "building": building, "floor_label": "Floor 1", "floor_code": "1"}
		)["data"]["floor"]["name"]

		room_type = api.create_room_type(
			{
				"resort_property": prop,
				"room_type_name": "Deluxe",
				"room_type_code": "DLX",
				"standard_adults": 2,
				"max_occupancy": 3,
			}
		)["data"]["room_type"]["name"]

		bulk = api.create_rooms_bulk(
			{
				"resort_property": prop,
				"building": building,
				"floor": floor,
				"room_type": room_type,
				"room_numbers": ["Z101", "Z102"],
			}
		)
		self.assertEqual(bulk["data"]["created_count"], 2)
		self.assertEqual(bulk["data"]["skipped_count"], 0)

		# Overlapping re-run: only the new number is created, the dup is skipped.
		bulk2 = api.create_rooms_bulk(
			{
				"resort_property": prop,
				"building": building,
				"floor": floor,
				"room_type": room_type,
				"room_numbers": ["Z102", "Z103"],
			}
		)
		self.assertEqual(bulk2["data"]["created_count"], 1)
		self.assertEqual(bulk2["data"]["skipped_count"], 1)
		self.assertTrue(bulk2["warnings"])

		tree = api.get_property_tree(prop)["data"]
		self.assertEqual(tree["counts"]["buildings"], 1)
		self.assertEqual(tree["counts"]["floors"], 1)
		self.assertEqual(tree["counts"]["room_types"], 1)
		self.assertEqual(tree["counts"]["rooms"], 3)

	def test_room_type_max_occupancy_guard(self):
		prop = api.create_property(
			{
				"property_name": "ZZ Guard",
				"property_code": "ZZGUARD",
				"company": self.company,
				"timezone": "Asia/Kolkata",
			}
		)["data"]["property"]["name"]
		with self.assertRaises(frappe.ValidationError):
			api.create_room_type(
				{
					"resort_property": prop,
					"room_type_name": "Bad",
					"room_type_code": "BAD",
					"standard_adults": 4,
					"max_occupancy": 2,
				}
			)

	def test_rooms_reject_floor_from_other_building(self):
		prop = api.create_property(
			{
				"property_name": "ZZ Cross",
				"property_code": "ZZCROSS",
				"company": self.company,
				"timezone": "Asia/Kolkata",
			}
		)["data"]["property"]["name"]
		b1 = api.create_building(
			{"resort_property": prop, "building_name": "B1", "building_code": "B1"}
		)["data"]["building"]["name"]
		b2 = api.create_building(
			{"resort_property": prop, "building_name": "B2", "building_code": "B2"}
		)["data"]["building"]["name"]
		floor_in_b2 = api.create_floor(
			{"resort_property": prop, "building": b2, "floor_label": "F1", "floor_code": "1"}
		)["data"]["floor"]["name"]
		room_type = api.create_room_type(
			{
				"resort_property": prop,
				"room_type_name": "Std",
				"room_type_code": "STD",
				"standard_adults": 2,
				"max_occupancy": 2,
			}
		)["data"]["room_type"]["name"]
		# Floor belongs to b2, but we claim building b1 → must be rejected.
		with self.assertRaises(frappe.ValidationError):
			api.create_rooms_bulk(
				{
					"resort_property": prop,
					"building": b1,
					"floor": floor_in_b2,
					"room_type": room_type,
					"room_numbers": ["X1"],
				}
			)
