"""Tests for the Maintenance ticketing API — spec 009 first slice."""

from __future__ import annotations

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_to_date, now_datetime

from the_reezort.maintenance.api import (
	OPEN_STATES,
	assign_ticket,
	create_ticket,
	escalate_overdue_tickets,
	get_ticket,
	list_recent_for_room,
	list_tickets,
	transition_ticket,
)
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestMaintenanceApi(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		company = (
			frappe.db.get_single_value("Global Defaults", "default_company")
			or frappe.db.get_value("Company", {}, "name")
		)
		seed_erpnext_demo_masters(company, currency="INR")
		seed = seed_demo_property(company)
		cls.resort_property = seed["property"]
		cls.room = frappe.db.get_value("Room", {"resort_property": cls.resort_property}, "name")

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		# Clean slate per test so counts + list assertions are deterministic.
		frappe.db.delete("Maintenance Ticket", {"resort_property": self.resort_property})
		frappe.db.commit()

	# ------------------------------------------------------------------
	# Happy path: create → assign → start → resolve
	# ------------------------------------------------------------------

	def _create_ac_ticket(self, subject: str = "AC not cooling", priority: str = "High"):
		return create_ticket(
			{
				"resort_property": self.resort_property,
				"subject": subject,
				"category": "HVAC",
				"priority": priority,
				"room": self.room,
				"description": "Guest reports set 18°C, still 24°C",
			}
		)["data"]["ticket"]

	def test_create_assign_start_resolve_flow(self):
		t = self._create_ac_ticket()
		self.assertEqual(t["state"], "Reported")
		self.assertEqual(t["category"], "HVAC")
		self.assertEqual(t["priority"], "High")
		self.assertIsNotNone(t["sla_due"])
		self.assertEqual(t["raised_by"], "Administrator")

		# Assign → Reported → Assigned automatically.
		assigned = assign_ticket(t["name"], user="Administrator")["data"]["ticket"]
		self.assertEqual(assigned["state"], "Assigned")
		self.assertEqual(assigned["assigned_to"], "Administrator")
		self.assertIsNotNone(assigned["assigned_at"])

		# Start.
		started = transition_ticket(t["name"], "In Progress")["data"]["ticket"]
		self.assertEqual(started["state"], "In Progress")
		self.assertIsNotNone(started["started_at"])

		# Resolve with notes.
		resolved = transition_ticket(t["name"], "Resolved", notes="Compressor reset")["data"]["ticket"]
		self.assertEqual(resolved["state"], "Resolved")
		self.assertIn("Compressor reset", resolved["resolution_notes"])
		self.assertIsNotNone(resolved["resolved_at"])

		# Close.
		closed = transition_ticket(t["name"], "Closed")["data"]["ticket"]
		self.assertEqual(closed["state"], "Closed")
		self.assertIsNotNone(closed["closed_at"])

	# ------------------------------------------------------------------
	# Idempotency + dedupe warning
	# ------------------------------------------------------------------

	def test_create_is_idempotent_per_bucket(self):
		"""A double-tap inside the per-minute bucket returns the same ticket, reused=True."""
		r1 = create_ticket(
			{
				"resort_property": self.resort_property,
				"subject": "Leaking faucet",
				"category": "Plumbing",
				"room": self.room,
			}
		)
		r2 = create_ticket(
			{
				"resort_property": self.resort_property,
				"subject": "Leaking faucet",
				"category": "Plumbing",
				"room": self.room,
			}
		)
		self.assertEqual(r1["data"]["ticket"]["name"], r2["data"]["ticket"]["name"])
		self.assertTrue(r2["data"]["reused"])

	def test_similar_open_warning_within_window(self):
		"""Same room + category open in last 2h → warning on the SECOND create.
		Subject differs so it's not the idempotency dedupe."""
		self._create_ac_ticket(subject="AC noisy")
		r = create_ticket(
			{
				"resort_property": self.resort_property,
				"subject": "AC not cooling",
				"category": "HVAC",
				"room": self.room,
			}
		)
		codes = [w["code"] for w in r["warnings"]]
		self.assertIn("similar_open", codes)

	def test_allow_duplicate_suppresses_warning(self):
		self._create_ac_ticket(subject="AC noisy")
		r = create_ticket(
			{
				"resort_property": self.resort_property,
				"subject": "AC not cooling",
				"category": "HVAC",
				"room": self.room,
				"allow_duplicate": True,
			}
		)
		self.assertEqual(len(r["warnings"]), 0)

	# ------------------------------------------------------------------
	# State machine
	# ------------------------------------------------------------------

	def test_transition_reported_to_resolved_is_rejected(self):
		"""Reported cannot jump straight to Resolved — must go through
		Assigned or In Progress first."""
		t = self._create_ac_ticket()
		with self.assertRaises(frappe.ValidationError):
			transition_ticket(t["name"], "Resolved")

	def test_transition_closed_is_terminal(self):
		t = self._create_ac_ticket()
		assign_ticket(t["name"], user="Administrator")
		transition_ticket(t["name"], "In Progress")
		transition_ticket(t["name"], "Resolved", notes="ok")
		transition_ticket(t["name"], "Closed")
		with self.assertRaises(frappe.ValidationError):
			transition_ticket(t["name"], "In Progress")

	def test_duplicate_from_reported(self):
		master = self._create_ac_ticket(subject="AC master")
		dup = self._create_ac_ticket(subject="AC duplicate")
		result = transition_ticket(dup["name"], "Duplicate", notes=f"duplicate_of:{master['name']}")
		self.assertEqual(result["data"]["ticket"]["state"], "Duplicate")
		self.assertEqual(result["data"]["ticket"]["duplicate_of"], master["name"])

	def test_start_self_assigns_when_unassigned(self):
		"""transition_ticket to In Progress on an unassigned ticket self-assigns
		the current user — you can't work a ticket without owning it."""
		t = self._create_ac_ticket()
		self.assertIsNone(t["assigned_to"])
		started = transition_ticket(t["name"], "In Progress")["data"]["ticket"]
		self.assertEqual(started["assigned_to"], "Administrator")

	# ------------------------------------------------------------------
	# List + filtering
	# ------------------------------------------------------------------

	def test_list_tickets_filters_and_counts(self):
		self._create_ac_ticket(subject="Urgent AC", priority="Urgent")
		self._create_ac_ticket(subject="Normal AC", priority="Normal")
		hvac_only = list_tickets(resort_property=self.resort_property, priority="Urgent")["data"]
		self.assertEqual(len(hvac_only["tickets"]), 1)
		self.assertEqual(hvac_only["tickets"][0]["subject"], "Urgent AC")

		all_open = list_tickets(resort_property=self.resort_property)["data"]
		self.assertEqual(all_open["counts"]["Reported"], 2)
		self.assertEqual(all_open["overdue"], 0)

	def test_list_recent_for_room(self):
		self._create_ac_ticket(subject="First")
		self._create_ac_ticket(subject="Second")
		result = list_recent_for_room(self.room, limit=5)["data"]
		self.assertEqual(result["room"], self.room)
		self.assertEqual(len(result["tickets"]), 2)
		# Newest first.
		self.assertEqual(result["tickets"][0]["subject"], "Second")

	# ------------------------------------------------------------------
	# Escalation
	# ------------------------------------------------------------------

	def test_escalate_overdue_flags_past_due(self):
		t = self._create_ac_ticket()
		# Force sla_due into the past.
		frappe.db.set_value(
			"Maintenance Ticket",
			t["name"],
			"sla_due",
			add_to_date(now_datetime(), hours=-1),
			update_modified=False,
		)
		count = escalate_overdue_tickets()
		self.assertGreaterEqual(count, 1)
		fresh = get_ticket(t["name"])["data"]["ticket"]
		self.assertTrue(fresh["escalated"])

	def test_get_ticket_shape_carries_sla_view(self):
		t = self._create_ac_ticket()
		fresh = get_ticket(t["name"])["data"]["ticket"]
		for k in (
			"name", "state", "category", "priority", "room", "sla_due",
			"minutes_remaining", "is_overdue", "photos",
		):
			self.assertIn(k, fresh, f"key {k} missing from ticket dict")
