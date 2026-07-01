"""Smoke tests for room insights aggregator."""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.property.api import seed_demo_property
from the_reezort.property.insights_api import get_room_insights
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestInsightsApi(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.company = (
			frappe.db.get_single_value("Global Defaults", "default_company")
			or frappe.db.get_value("Company", {}, "name")
		)
		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]
		cls.room = frappe.db.get_value("Room", {"resort_property": cls.resort_property}, "name")

	def test_shape_and_defaults(self):
		out = get_room_insights(room=self.room)
		data = out["data"]
		for key in (
			"room",
			"hero_image",
			"gallery",
			"current",
			"upcoming",
			"tasks",
			"equipment",
			"occupancy_pct_30d",
			"revenue_30d",
		):
			self.assertIn(key, data)
		self.assertEqual(data["room"], self.room)
		self.assertIsInstance(data["gallery"], list)
		self.assertIsInstance(data["upcoming"], list)
		self.assertIsInstance(data["tasks"], dict)
		self.assertIsInstance(data["equipment"], dict)

	def test_unknown_room_raises(self):
		with self.assertRaises(frappe.ValidationError):
			get_room_insights(room="DOES-NOT-EXIST")

	def test_tasks_summary_reflects_open_task(self):
		task = frappe.get_doc(
			{
				"doctype": "Housekeeping Task",
				"resort_property": self.resort_property,
				"room": self.room,
				"task_type": "Deep Cleaning",
				"task_status": "Queued",
				"priority": "High",
				"idempotency_key": frappe.generate_hash(length=12),
			}
		).insert(ignore_permissions=True)
		try:
			out = get_room_insights(room=self.room)
			self.assertGreaterEqual(out["data"]["tasks"]["open_count"], 1)
			self.assertGreaterEqual(out["data"]["tasks"]["high_priority_open"], 1)
		finally:
			frappe.delete_doc("Housekeeping Task", task.name, force=True, ignore_permissions=True)
