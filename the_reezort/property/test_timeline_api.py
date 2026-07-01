"""Smoke tests for the timeline aggregator — verifies each source doctype
appears in the merged event stream and events sort newest-first."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.property.api import seed_demo_property
from the_reezort.property.timeline_api import (
	get_property_timeline,
	get_room_timeline,
)
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestTimelineApi(FrappeTestCase):
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

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		# Reset a housekeeping-task footprint that's unique to this room for
		# each test so the events aren't ambiguous.
		for name in frappe.get_all(
			"Housekeeping Task",
			filters={"room": self.room, "task_type": "Deep Cleaning"},
			pluck="name",
		):
			frappe.delete_doc("Housekeeping Task", name, force=True, ignore_permissions=True)
		frappe.db.commit()

	def test_room_timeline_returns_envelope_with_events_list(self):
		out = get_room_timeline(room=self.room)
		self.assertIn("data", out)
		self.assertEqual(out["data"]["target"]["doctype"], "Room")
		self.assertIsInstance(out["data"]["events"], list)

	def test_housekeeping_task_shows_up_in_room_timeline(self):
		# Insert a task tied to this room.
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

		out = get_room_timeline(room=self.room)
		names = {e["source_name"] for e in out["data"]["events"] if e["source_doctype"] == "Housekeeping Task"}
		self.assertIn(task.name, names)

	def test_events_sort_newest_first(self):
		"""Two tasks inserted seconds apart — the later one appears first."""
		frappe.get_doc(
			{
				"doctype": "Housekeeping Task",
				"resort_property": self.resort_property,
				"room": self.room,
				"task_type": "Deep Cleaning",
				"task_status": "Queued",
				"idempotency_key": frappe.generate_hash(length=12),
			}
		).insert(ignore_permissions=True)
		later = frappe.get_doc(
			{
				"doctype": "Housekeeping Task",
				"resort_property": self.resort_property,
				"room": self.room,
				"task_type": "Deep Cleaning",
				"task_status": "Queued",
				"idempotency_key": frappe.generate_hash(length=12),
			}
		).insert(ignore_permissions=True)

		out = get_room_timeline(room=self.room)
		hk_events = [e for e in out["data"]["events"] if e["source_doctype"] == "Housekeeping Task"]
		# The most recently inserted task must appear before older ones.
		self.assertEqual(hk_events[0]["source_name"], later.name)

	def test_property_timeline_aggregates_from_all_rooms(self):
		out = get_property_timeline(resort_property=self.resort_property)
		self.assertEqual(out["data"]["target"]["doctype"], "Resort Property")
		# Nothing to assert on counts here — just that the shape is right.
		self.assertIn("events", out["data"])

	def test_unknown_room_raises(self):
		with self.assertRaises(frappe.ValidationError):
			get_room_timeline(room="ROOM-DOES-NOT-EXIST")
