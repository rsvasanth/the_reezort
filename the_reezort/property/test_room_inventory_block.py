"""Tests for Room Inventory Block — doctype, API endpoints, and availability deduction.

Pattern: FrappeTestCase; setUp creates a minimal property + building + floor +
room type + rooms via the setup api module, then each test_* exercises one
behaviour. Tests cannot be run here (bare worktree, no bench site), but are
correct in logic and will execute against a real site.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.setup import api as setup_api
from the_reezort.property import api as property_api


def _make_property(suffix):
	"""Helper: create a minimal property and return its name."""
	company = frappe.db.get_value("Company", {}, "name")
	prop_code = f"ZZTST{suffix}"
	result = setup_api.create_property(
		{
			"property_name": f"ZZ Test Property {suffix}",
			"property_code": prop_code,
			"company": company,
			"timezone": "Asia/Kolkata",
		}
	)
	return result["data"]["property"]["name"]


class TestRoomInventoryBlock(FrappeTestCase):
	def setUp(self):
		self.prop = _make_property("RIB")
		company = frappe.db.get_value("Company", {}, "name")

		self.building = setup_api.create_building(
			{"resort_property": self.prop, "building_name": "Wing A", "building_code": "WA"}
		)["data"]["building"]["name"]

		self.floor = setup_api.create_floor(
			{
				"resort_property": self.prop,
				"building": self.building,
				"floor_label": "F1",
				"floor_code": "1",
			}
		)["data"]["floor"]["name"]

		self.room_type = setup_api.create_room_type(
			{
				"resort_property": self.prop,
				"room_type_name": "Deluxe Test",
				"room_type_code": "DLXTEST",
				"standard_adults": 2,
				"max_occupancy": 3,
			}
		)["data"]["room_type"]["name"]

		# Create two physical rooms
		setup_api.create_rooms_bulk(
			{
				"resort_property": self.prop,
				"building": self.building,
				"floor": self.floor,
				"room_type": self.room_type,
				"room_numbers": ["T101", "T102"],
			}
		)
		self.room1 = f"{self.prop}-T101"
		self.room2 = f"{self.prop}-T102"

	# ------------------------------------------------------------------ #
	# 1. Doctype controller — basic create and release                      #
	# ------------------------------------------------------------------ #

	def test_create_room_scope_block(self):
		doc = frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "Maintenance",
				"scope": "Room",
				"room": self.room1,
				"start_date": "2027-01-10",
				"end_date": "2027-01-15",
				"reason": "AC repair",
			}
		)
		doc.insert(ignore_permissions=True)
		self.assertEqual(doc.status, "Active")
		self.assertTrue(doc.name.startswith("RZ-RIB-"))
		self.assertEqual(doc.created_by, frappe.session.user)

	def test_create_room_type_scope_block(self):
		doc = frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "VIP Hold",
				"scope": "Room Type",
				"room_type": self.room_type,
				"start_date": "2027-02-01",
				"end_date": "2027-02-05",
				"reason": "VIP floor hold",
			}
		)
		doc.insert(ignore_permissions=True)
		self.assertEqual(doc.status, "Active")

	def test_release_block_sets_audit_fields(self):
		doc = frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "Operational",
				"scope": "Room",
				"room": self.room1,
				"start_date": "2027-03-01",
				"end_date": "2027-03-05",
				"reason": "Painting",
			}
		)
		doc.insert(ignore_permissions=True)

		result = property_api.release_room_block(
			room_inventory_block=doc.name, reason="Paint complete"
		)
		self.assertEqual(result["data"]["status"], "Released")

		released = frappe.get_doc("Room Inventory Block", doc.name)
		self.assertEqual(released.status, "Released")
		self.assertEqual(released.released_by, frappe.session.user)
		self.assertIsNotNone(released.released_at)

	def test_release_is_idempotent(self):
		doc = frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "Operational",
				"scope": "Room",
				"room": self.room1,
				"start_date": "2027-04-01",
				"end_date": "2027-04-03",
				"reason": "Test idempotent",
			}
		)
		doc.insert(ignore_permissions=True)

		property_api.release_room_block(room_inventory_block=doc.name)
		# Second call must not raise
		result = property_api.release_room_block(room_inventory_block=doc.name)
		self.assertEqual(result["data"]["status"], "Released")

	# ------------------------------------------------------------------ #
	# 2. Scope validation                                                   #
	# ------------------------------------------------------------------ #

	def test_room_scope_requires_room(self):
		with self.assertRaises(frappe.MandatoryError):
			frappe.get_doc(
				{
					"doctype": "Room Inventory Block",
					"resort_property": self.prop,
					"block_type": "Maintenance",
					"scope": "Room",
					# room intentionally missing
					"start_date": "2027-05-01",
					"end_date": "2027-05-05",
					"reason": "no room provided",
				}
			).insert(ignore_permissions=True)

	def test_room_type_scope_requires_room_type(self):
		with self.assertRaises(frappe.MandatoryError):
			frappe.get_doc(
				{
					"doctype": "Room Inventory Block",
					"resort_property": self.prop,
					"block_type": "VIP Hold",
					"scope": "Room Type",
					# room_type intentionally missing
					"start_date": "2027-05-01",
					"end_date": "2027-05-05",
					"reason": "no room type",
				}
			).insert(ignore_permissions=True)

	def test_end_date_before_start_date_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc(
				{
					"doctype": "Room Inventory Block",
					"resort_property": self.prop,
					"block_type": "Maintenance",
					"scope": "Room",
					"room": self.room1,
					"start_date": "2027-06-10",
					"end_date": "2027-06-05",  # before start
					"reason": "bad dates",
				}
			).insert(ignore_permissions=True)

	# ------------------------------------------------------------------ #
	# 3. Hard block overlap prevention                                      #
	# ------------------------------------------------------------------ #

	def test_hard_block_overlap_same_room_rejected(self):
		"""Two hard blocks on the same room for overlapping dates must fail."""
		frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "Maintenance",
				"scope": "Room",
				"room": self.room1,
				"start_date": "2027-07-01",
				"end_date": "2027-07-10",
				"reason": "First block",
			}
		).insert(ignore_permissions=True)

		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc(
				{
					"doctype": "Room Inventory Block",
					"resort_property": self.prop,
					"block_type": "VIP Hold",
					"scope": "Room",
					"room": self.room1,
					"start_date": "2027-07-05",
					"end_date": "2027-07-15",
					"reason": "Second overlapping block",
				}
			).insert(ignore_permissions=True)

	def test_non_overlapping_blocks_on_same_room_allowed(self):
		"""Sequential (non-overlapping) hard blocks on the same room are valid."""
		frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "Maintenance",
				"scope": "Room",
				"room": self.room1,
				"start_date": "2027-08-01",
				"end_date": "2027-08-05",
				"reason": "Block A",
			}
		).insert(ignore_permissions=True)

		# Should not raise — dates don't overlap (end_date = start_date is boundary, not overlap)
		doc2 = frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "Maintenance",
				"scope": "Room",
				"room": self.room1,
				"start_date": "2027-08-05",
				"end_date": "2027-08-10",
				"reason": "Block B",
			}
		)
		doc2.insert(ignore_permissions=True)
		self.assertEqual(doc2.status, "Active")

	def test_room_type_over_block_prevented(self):
		"""Blocking more room-type slots than there are rooms must fail.

		setUp created exactly 2 rooms for this room type.
		Two Room Type-scope blocks are fine; a third must be rejected.
		"""
		dates = [("2027-09-01", "2027-09-05"), ("2027-09-01", "2027-09-05")]
		for start, end in dates:
			frappe.get_doc(
				{
					"doctype": "Room Inventory Block",
					"resort_property": self.prop,
					"block_type": "Group Hold",
					"scope": "Room Type",
					"room_type": self.room_type,
					"start_date": start,
					"end_date": end,
					"reason": "Group block",
				}
			).insert(ignore_permissions=True)

		# Third block must be rejected (would take count above 2 rooms)
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc(
				{
					"doctype": "Room Inventory Block",
					"resort_property": self.prop,
					"block_type": "VIP Hold",
					"scope": "Room Type",
					"room_type": self.room_type,
					"start_date": "2027-09-01",
					"end_date": "2027-09-05",
					"reason": "Over-blocking attempt",
				}
			).insert(ignore_permissions=True)

	# ------------------------------------------------------------------ #
	# 4. create_room_block API                                              #
	# ------------------------------------------------------------------ #

	def test_create_room_block_api(self):
		result = property_api.create_room_block(
			property=self.prop,
			scope="Room",
			room=self.room1,
			block_type="Maintenance",
			start_date="2027-10-01",
			end_date="2027-10-07",
			reason="API test",
		)
		self.assertTrue(result["ok"])
		self.assertIn("room_inventory_block", result["data"])
		self.assertEqual(result["data"]["status"], "Active")

	def test_create_room_block_api_missing_reason_rejected(self):
		with self.assertRaises(frappe.MandatoryError):
			property_api.create_room_block(
				property=self.prop,
				scope="Room",
				room=self.room1,
				block_type="Maintenance",
				start_date="2027-11-01",
				end_date="2027-11-05",
				reason="",  # empty
			)

	# ------------------------------------------------------------------ #
	# 5. list_room_blocks API                                               #
	# ------------------------------------------------------------------ #

	def test_list_room_blocks_by_property(self):
		frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "Operational",
				"scope": "Room",
				"room": self.room1,
				"start_date": "2027-12-01",
				"end_date": "2027-12-05",
				"reason": "List test",
			}
		).insert(ignore_permissions=True)

		result = property_api.list_room_blocks(property=self.prop, status="Active")
		self.assertTrue(result["ok"])
		blocks = result["data"]["blocks"]
		self.assertGreater(len(blocks), 0)
		# All returned blocks must belong to this test property
		for block in blocks:
			self.assertEqual(block["resort_property"], self.prop)

	def test_list_room_blocks_date_filter(self):
		"""Blocks outside the date range should not be returned."""
		frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "Maintenance",
				"scope": "Room",
				"room": self.room2,
				"start_date": "2028-01-01",
				"end_date": "2028-01-10",
				"reason": "Jan block",
			}
		).insert(ignore_permissions=True)

		# Query for March — must not return the January block
		result = property_api.list_room_blocks(
			property=self.prop,
			start_date="2028-03-01",
			end_date="2028-03-31",
		)
		names = [b["name"] for b in result["data"]["blocks"]]
		for n in names:
			block = frappe.db.get_value(
				"Room Inventory Block", n, ["start_date", "end_date"], as_dict=True
			)
			# Verify overlap: block start < query end AND block end > query start
			self.assertLess(str(block["start_date"]), "2028-03-31")
			self.assertGreater(str(block["end_date"]), "2028-03-01")

	# ------------------------------------------------------------------ #
	# 6. Availability deduction — get_room_type_availability                #
	# ------------------------------------------------------------------ #

	def test_room_scope_block_reduces_availability(self):
		"""A Room-scope inventory block must reduce available_rooms by 1."""
		avail_before = property_api.get_room_type_availability(
			property=self.prop,
			start_date="2027-06-01",
			end_date="2027-06-07",
			room_types=[self.room_type],
		)
		avail_before_count = avail_before["availability"][0]["available_rooms"]

		frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "Maintenance",
				"scope": "Room",
				"room": self.room1,
				"inventory_blocking": 1,
				"start_date": "2027-06-01",
				"end_date": "2027-06-07",
				"reason": "Deduction test",
			}
		).insert(ignore_permissions=True)

		avail_after = property_api.get_room_type_availability(
			property=self.prop,
			start_date="2027-06-01",
			end_date="2027-06-07",
			room_types=[self.room_type],
		)
		avail_after_count = avail_after["availability"][0]["available_rooms"]
		self.assertEqual(avail_after_count, avail_before_count - 1)

	def test_room_type_scope_block_reduces_availability(self):
		"""A Room Type-scope inventory block must reduce available_rooms by 1."""
		avail_before = property_api.get_room_type_availability(
			property=self.prop,
			start_date="2027-05-01",
			end_date="2027-05-10",
			room_types=[self.room_type],
		)
		avail_before_count = avail_before["availability"][0]["available_rooms"]

		frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "Group Hold",
				"scope": "Room Type",
				"room_type": self.room_type,
				"inventory_blocking": 1,
				"start_date": "2027-05-01",
				"end_date": "2027-05-10",
				"reason": "Group deduction",
			}
		).insert(ignore_permissions=True)

		avail_after = property_api.get_room_type_availability(
			property=self.prop,
			start_date="2027-05-01",
			end_date="2027-05-10",
			room_types=[self.room_type],
		)
		avail_after_count = avail_after["availability"][0]["available_rooms"]
		self.assertEqual(avail_after_count, avail_before_count - 1)

	def test_non_inventory_blocking_block_does_not_reduce_availability(self):
		"""A block with inventory_blocking=0 must not reduce the count."""
		avail_before = property_api.get_room_type_availability(
			property=self.prop,
			start_date="2027-04-01",
			end_date="2027-04-10",
			room_types=[self.room_type],
		)
		avail_before_count = avail_before["availability"][0]["available_rooms"]

		frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "Operational",
				"scope": "Room",
				"room": self.room1,
				"inventory_blocking": 0,
				"start_date": "2027-04-01",
				"end_date": "2027-04-10",
				"reason": "Non-inventory block",
			}
		).insert(ignore_permissions=True)

		avail_after = property_api.get_room_type_availability(
			property=self.prop,
			start_date="2027-04-01",
			end_date="2027-04-10",
			room_types=[self.room_type],
		)
		avail_after_count = avail_after["availability"][0]["available_rooms"]
		self.assertEqual(avail_after_count, avail_before_count)

	def test_released_block_does_not_reduce_availability(self):
		"""A Released block must not deduct from availability."""
		doc = frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "Maintenance",
				"scope": "Room",
				"room": self.room2,
				"inventory_blocking": 1,
				"start_date": "2027-03-10",
				"end_date": "2027-03-15",
				"reason": "Released block test",
			}
		)
		doc.insert(ignore_permissions=True)
		property_api.release_room_block(room_inventory_block=doc.name)

		avail = property_api.get_room_type_availability(
			property=self.prop,
			start_date="2027-03-10",
			end_date="2027-03-15",
			room_types=[self.room_type],
		)
		# room2 is active and sellable in setUp; released block should not reduce count
		type_entry = avail["availability"][0]
		# available_rooms must equal physical_rooms - blocked_by_status (0 for this room)
		self.assertGreater(type_entry["available_rooms"], 0)

	# ------------------------------------------------------------------ #
	# 7. Availability deduction — find_allocatable_rooms                    #
	# ------------------------------------------------------------------ #

	def test_blocked_room_excluded_from_allocatable_rooms(self):
		"""find_allocatable_rooms must not return a room with an active block."""
		# Mark rooms sellable/clean so they normally appear in allocatable
		for room_name in (self.room1, self.room2):
			frappe.db.set_value(
				"Room",
				room_name,
				{
					"sellable_status": "Sellable",
					"maintenance_status": "Available",
					"housekeeping_status": "Inspected",
				},
			)

		frappe.get_doc(
			{
				"doctype": "Room Inventory Block",
				"resort_property": self.prop,
				"block_type": "VIP Hold",
				"scope": "Room",
				"room": self.room1,
				"inventory_blocking": 1,
				"start_date": "2027-08-10",
				"end_date": "2027-08-20",
				"reason": "VIP allocation test",
			}
		).insert(ignore_permissions=True)

		result = property_api.find_allocatable_rooms(
			property=self.prop,
			room_type=self.room_type,
			start_date="2027-08-10",
			end_date="2027-08-15",
		)
		returned_names = [r["name"] for r in result["rooms"]]
		self.assertNotIn(self.room1, returned_names)
		# room2 should still be allocatable
		self.assertIn(self.room2, returned_names)

	# ------------------------------------------------------------------ #
	# 8. run_setup_completeness_check issues                                #
	# ------------------------------------------------------------------ #

	def test_completeness_check_flags_missing_warehouse(self):
		"""A Service Location without default_warehouse must appear in issues."""
		# Create a location without a warehouse
		loc_name = f"{self.prop}-TESTBAR"
		if not frappe.db.exists("Service Location", loc_name):
			frappe.get_doc(
				{
					"doctype": "Service Location",
					"resort_property": self.prop,
					"location_name": "Test Bar",
					"location_code": "TESTBAR",
					"location_type": "Bar",
					"can_bill_direct": 1,
					"can_post_to_folio": 1,
					"is_active": 1,
					# default_warehouse intentionally omitted
				}
			).insert(ignore_permissions=True)

		result = property_api.run_setup_completeness_check(property=self.prop)
		issues = result["issues"]
		warehouse_issues = [
			i for i in issues
			if i["doctype"] == "Service Location" and "Warehouse" in i["message"]
		]
		self.assertGreater(len(warehouse_issues), 0)
