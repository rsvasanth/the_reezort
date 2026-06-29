import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.property.api import (
	find_allocatable_rooms,
	get_management_dashboard_snapshot,
	get_room_status_board,
	get_room_type_availability,
	run_setup_completeness_check,
	seed_demo_property,
)


class TestPropertyAPI(FrappeTestCase):
	def setUp(self):
		self.company = frappe.db.get_value("Company", {}, "name")
		if not self.company:
			self.skipTest("ERPNext Company is required for demo property seed tests.")

		self.seed = seed_demo_property(company=self.company)
		self.property = self.seed["property"]

	def test_seed_demo_property_is_idempotent(self):
		second_seed = seed_demo_property(company=self.company)

		self.assertEqual(second_seed["property"], self.property)
		self.assertEqual(second_seed["rooms"], self.seed["rooms"])

	def test_room_status_board_returns_rooms(self):
		result = get_room_status_board(property=self.property)

		self.assertGreater(len(result["rooms"]), 0)
		self.assertIn("display_status", result["rooms"][0])
		self.assertIn("room_type_name", result["rooms"][0])

	def test_room_type_availability_returns_counts(self):
		result = get_room_type_availability(property=self.property)

		self.assertGreater(len(result["availability"]), 0)
		self.assertIn("available_rooms", result["availability"][0])
		self.assertEqual(result["calculation_basis"], "property_inventory_only")

	def test_find_allocatable_rooms_scores_ready_rooms(self):
		room_type = frappe.db.get_value("Room Type", {"resort_property": self.property, "room_type_code": "DLX"}, "name")
		result = find_allocatable_rooms(property=self.property, room_type=room_type)

		self.assertGreater(len(result["rooms"]), 0)
		self.assertGreaterEqual(result["rooms"][0]["score"], 80)
		self.assertIn("sellable", result["rooms"][0]["reasons"])

	def test_setup_completeness_check_reports_complete(self):
		result = run_setup_completeness_check(property=self.property)

		self.assertTrue(result["complete"])
		self.assertEqual(result["missing"], [])

	def test_management_dashboard_snapshot_has_kpis(self):
		result = get_management_dashboard_snapshot(property=self.property)

		self.assertGreater(result["kpis"]["total_rooms"], 0)
		self.assertIn("availability", result)
		self.assertIn("rooms", result)
