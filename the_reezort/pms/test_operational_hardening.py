"""Regression tests for the operational-correctness gap fixes.

- Housekeeping-ready filter on room allocation (dirty rooms are not assignable
  or re-admitted to inventory until cleaned, unless the property allows it).
- Maintenance-blocker check actually blocks a room from passing inspection.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.housekeeping.api import _has_open_blocking_maintenance
from the_reezort.pms.api import _available_rooms, _resolve_vacant_room
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestAllocationHousekeepingFilter(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.prop = seed["property"]
		cls.room_type = frappe.db.get_value("Room", {"resort_property": cls.prop}, "room_type")

	def setUp(self):
		super().setUp()
		# Baseline: this property enforces housekeeping readiness.
		frappe.db.set_value("Resort Property", self.prop, "allow_dirty_room_allocation", 0)
		self.rooms = frappe.get_all(
			"Room", filters={"resort_property": self.prop, "room_type": self.room_type}, pluck="name"
		)
		for r in self.rooms:
			frappe.db.set_value(
				"Room", r,
				{"occupancy_status": "Vacant", "sellable_status": "Sellable", "housekeeping_status": "Dirty"},
			)

	def test_all_dirty_rooms_are_not_allocatable(self):
		self.assertEqual(_available_rooms(self.prop, self.room_type), [])
		self.assertIsNone(_resolve_vacant_room(self.prop, self.room_type))

	def test_clean_room_becomes_allocatable(self):
		target = self.rooms[0]
		frappe.db.set_value("Room", target, "housekeeping_status", "Clean")
		names = [r["name"] for r in _available_rooms(self.prop, self.room_type)]
		self.assertIn(target, names)
		self.assertEqual(_resolve_vacant_room(self.prop, self.room_type), target)

	def test_policy_override_allows_dirty_allocation(self):
		frappe.db.set_value("Resort Property", self.prop, "allow_dirty_room_allocation", 1)
		# With the policy on, even all-dirty rooms are allocatable again.
		self.assertTrue(_available_rooms(self.prop, self.room_type))
		self.assertIsNotNone(_resolve_vacant_room(self.prop, self.room_type))


class TestMaintenanceBlocker(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.prop = seed["property"]
		cls.room = frappe.db.get_value("Room", {"resort_property": cls.prop}, "name")

	def _ticket(self, priority, state):
		return frappe.get_doc(
			{
				"doctype": "Maintenance Ticket",
				"resort_property": self.prop,
				"room": self.room,
				"subject": f"Sec test {priority} {state}",
				"category": "Electrical",
				"priority": priority,
				"state": state,
			}
		).insert(ignore_permissions=True)

	def test_no_ticket_is_not_blocking(self):
		self.assertFalse(_has_open_blocking_maintenance(self.room))

	def test_open_high_ticket_blocks(self):
		t = self._ticket("High", "Reported")
		try:
			self.assertTrue(_has_open_blocking_maintenance(self.room))
		finally:
			frappe.delete_doc("Maintenance Ticket", t.name, force=True, ignore_permissions=True)

	def test_resolved_ticket_does_not_block(self):
		t = self._ticket("Urgent", "Resolved")
		try:
			self.assertFalse(_has_open_blocking_maintenance(self.room))
		finally:
			frappe.delete_doc("Maintenance Ticket", t.name, force=True, ignore_permissions=True)

	def test_low_priority_ticket_does_not_block(self):
		t = self._ticket("Low", "Reported")
		try:
			self.assertFalse(_has_open_blocking_maintenance(self.room))
		finally:
			frappe.delete_doc("Maintenance Ticket", t.name, force=True, ignore_permissions=True)
