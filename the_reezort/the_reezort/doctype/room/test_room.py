import frappe
from frappe.tests.utils import FrappeTestCase


def insert_doc(doctype: str, **values):
	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True, ignore_links=True)
	return doc


class TestRoom(FrappeTestCase):
	def make_inventory_setup(self, suffix: str):
		property_doc = insert_doc(
			"Resort Property",
			property_name=f"Test Resort {suffix}",
			property_code=f"TST-{suffix}",
			company=f"Test Company {suffix}",
			timezone="Asia/Kolkata",
		)
		building = insert_doc(
			"Resort Building",
			resort_property=property_doc.name,
			building_name=f"Main Wing {suffix}",
			building_code="MAIN",
		)
		floor = insert_doc(
			"Resort Floor",
			resort_property=property_doc.name,
			building=building.name,
			floor_label="Ground",
			floor_code="G",
		)
		room_type = insert_doc(
			"Room Type",
			resort_property=property_doc.name,
			room_type_name=f"Deluxe Room {suffix}",
			room_type_code="DLX",
			standard_adults=2,
			standard_children=0,
			max_occupancy=3,
		)

		return property_doc, building, floor, room_type

	def test_room_sets_display_status(self):
		property_doc, building, floor, room_type = self.make_inventory_setup("DISPLAY")

		room = insert_doc(
			"Room",
			resort_property=property_doc.name,
			building=building.name,
			floor=floor.name,
			room_type=room_type.name,
			room_number="101",
			occupancy_status="Vacant",
			housekeeping_status="Clean",
			maintenance_status="Available",
			sellable_status="Sellable",
		)

		self.assertEqual(room.display_status, "Vacant Clean")

	def test_maintenance_block_forces_room_not_sellable(self):
		property_doc, building, floor, room_type = self.make_inventory_setup("BLOCK")

		room = insert_doc(
			"Room",
			resort_property=property_doc.name,
			building=building.name,
			floor=floor.name,
			room_type=room_type.name,
			room_number="102",
			maintenance_status="Out of Order",
			sellable_status="Sellable",
		)

		self.assertEqual(room.sellable_status, "Not Sellable")
		self.assertEqual(room.display_status, "Out of Order")

	def test_room_number_is_unique_within_property_building(self):
		property_doc, building, floor, room_type = self.make_inventory_setup("DUP")

		insert_doc(
			"Room",
			resort_property=property_doc.name,
			building=building.name,
			floor=floor.name,
			room_type=room_type.name,
			room_number="201",
		)

		with self.assertRaises(frappe.ValidationError):
			insert_doc(
				"Room",
				resort_property=property_doc.name,
				building=building.name,
				floor=floor.name,
				room_type=room_type.name,
				room_number="201",
			)

	def test_room_rejects_parent_property_mismatch(self):
		property_a, _building_a, floor_a, room_type_a = self.make_inventory_setup("A")
		_property_b, building_b, _floor_b, _room_type_b = self.make_inventory_setup("B")

		with self.assertRaises(frappe.ValidationError):
			insert_doc(
				"Room",
				resort_property=property_a.name,
				building=building_b.name,
				floor=floor_a.name,
				room_type=room_type_a.name,
				room_number="301",
			)
