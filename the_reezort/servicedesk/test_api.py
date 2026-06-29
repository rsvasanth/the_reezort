"""Tests for Service Desk — SLA, lifecycle, escalation."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_to_date, now_datetime

from the_reezort.servicedesk import api


class TestServiceDesk(FrappeTestCase):
	def setUp(self):
		company = frappe.db.get_value("Company", {}, "name")
		code = "ZZSD"
		existing = frappe.db.get_value("Resort Property", {"property_code": code}, "name")
		self.prop = existing or frappe.get_doc(
			{
				"doctype": "Resort Property",
				"property_name": "ZZ SD",
				"property_code": code,
				"company": company,
				"timezone": "Asia/Kolkata",
			}
		).insert(ignore_permissions=True).name

	def _create(self, key, **kw):
		payload = {"resort_property": self.prop, "subject": "Towels please", "idempotency_key": key}
		payload.update(kw)
		return api.create_ticket(payload)

	def test_create_computes_sla_and_idempotent(self):
		out = self._create("zztest-1", priority="Urgent", category="Guest Request")
		t = out["data"]["ticket"]
		self.assertFalse(out["data"]["reused"])
		self.assertEqual(t["status"], "Open")
		self.assertIsNotNone(t["sla_due"])
		# Urgent = 30 min target; freshly opened so remaining is ~30 and not overdue.
		self.assertFalse(t["is_overdue"])
		self.assertLessEqual(t["minutes_remaining"], 30)
		self.assertGreater(t["minutes_remaining"], 20)

		again = self._create("zztest-1", priority="Urgent")
		self.assertTrue(again["data"]["reused"])
		self.assertEqual(again["data"]["ticket"]["name"], t["name"])

	def test_assign_and_resolve(self):
		t = self._create("zztest-2")["data"]["ticket"]["name"]
		assigned = api.assign_ticket(t, "Administrator")["data"]["ticket"]
		self.assertEqual(assigned["status"], "In Progress")
		self.assertEqual(assigned["assigned_to"], "Administrator")
		resolved = api.update_status(t, "Resolved")["data"]["ticket"]
		self.assertEqual(resolved["status"], "Resolved")
		self.assertIsNotNone(frappe.db.get_value("Service Ticket", t, "resolved_at"))

	def test_invalid_priority_and_category(self):
		with self.assertRaises(frappe.ValidationError):
			self._create("zztest-3", priority="Whenever")
		with self.assertRaises(frappe.ValidationError):
			self._create("zztest-4", category="Nonsense")

	def test_create_requires_idempotency_key(self):
		with self.assertRaises(frappe.ValidationError):
			api.create_ticket({"resort_property": self.prop, "subject": "x"})

	def test_escalate_overdue(self):
		name = self._create("zztest-5", priority="High")["data"]["ticket"]["name"]
		# Backdate the SLA into the past and confirm the board flags it overdue.
		frappe.db.set_value("Service Ticket", name, "sla_due", add_to_date(now_datetime(), minutes=-10))
		board = api.get_service_board(resort_property=self.prop)["data"]
		row = next(t for t in board["tickets"] if t["name"] == name)
		self.assertTrue(row["is_overdue"])
		self.assertGreaterEqual(board["overdue"], 1)
		# Escalation job flags it.
		n = api.escalate_overdue_tickets()
		self.assertGreaterEqual(n, 1)
		self.assertEqual(frappe.db.get_value("Service Ticket", name, "escalated"), 1)
