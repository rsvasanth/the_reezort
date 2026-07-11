"""Tests for the Preventive Maintenance API — spec 009."""

from __future__ import annotations

from datetime import date, timedelta

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import getdate

from the_reezort.maintenance.preventive import (
    _advance_date,
    create_preventive_plan,
    generate_preventive_tasks,
    list_preventive_plans,
    list_preventive_tasks,
)
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestPreventiveMaintenance(FrappeTestCase):
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
        frappe.db.delete("Preventive Maintenance Task", {})
        frappe.db.delete("Preventive Maintenance Plan", {"property": self.resort_property})
        frappe.db.commit()

    # ------------------------------------------------------------------
    # _advance_date unit tests
    # ------------------------------------------------------------------

    def test_advance_daily(self):
        d = date(2026, 7, 11)
        self.assertEqual(_advance_date(d, "Daily"), date(2026, 7, 12))

    def test_advance_weekly(self):
        d = date(2026, 7, 11)
        self.assertEqual(_advance_date(d, "Weekly"), date(2026, 7, 18))

    def test_advance_monthly(self):
        d = date(2026, 1, 31)
        # Jan 31 + 1 month -> Feb 28 (clamped)
        result = _advance_date(d, "Monthly")
        self.assertEqual(result, date(2026, 2, 28))

    def test_advance_quarterly(self):
        d = date(2026, 1, 15)
        self.assertEqual(_advance_date(d, "Quarterly"), date(2026, 4, 15))

    def test_advance_annual(self):
        d = date(2026, 3, 1)
        self.assertEqual(_advance_date(d, "Annual"), date(2027, 3, 1))

    def test_advance_manual_no_change(self):
        d = date(2026, 7, 11)
        self.assertEqual(_advance_date(d, "Manual"), d)

    def test_advance_runtime_based_no_change(self):
        d = date(2026, 7, 11)
        self.assertEqual(_advance_date(d, "Runtime Based"), d)

    # ------------------------------------------------------------------
    # create_preventive_plan
    # ------------------------------------------------------------------

    def _make_plan_payload(self, **overrides):
        base = {
            "plan_name": "HVAC Filter Check",
            "property": self.resort_property,
            "plan_scope": "Room",
            "recurrence_type": "Monthly",
            "next_due_date": "2026-08-01",
            "room": self.room,
            "expected_minutes": 30,
            "responsible_team": "Engineering",
        }
        base.update(overrides)
        return base

    def test_create_plan_success(self):
        result = create_preventive_plan(self._make_plan_payload())
        self.assertTrue(result["ok"])
        plan_name = result["data"]["plan"]
        self.assertTrue(plan_name.startswith("RZ-PMP-"))
        doc = frappe.get_doc("Preventive Maintenance Plan", plan_name)
        self.assertEqual(doc.plan_name, "HVAC Filter Check")
        self.assertEqual(doc.recurrence_type, "Monthly")
        self.assertEqual(doc.active, 1)

    def test_create_plan_missing_required_throws(self):
        payload = self._make_plan_payload()
        del payload["plan_name"]
        with self.assertRaises(frappe.exceptions.ValidationError):
            create_preventive_plan(payload)

    # ------------------------------------------------------------------
    # generate_preventive_tasks — basic generation
    # ------------------------------------------------------------------

    def _create_plan(self, **overrides):
        payload = self._make_plan_payload(**overrides)
        result = create_preventive_plan(payload)
        return result["data"]["plan"]

    def test_generate_creates_task_and_ticket(self):
        plan_name = self._create_plan(next_due_date="2026-07-10")
        result = generate_preventive_tasks(
            property=self.resort_property, through_date="2026-07-11"
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["generated_count"], 1)
        gen = result["data"]["generated"][0]
        self.assertEqual(gen["plan"], plan_name)
        self.assertTrue(gen["task"].startswith("RZ-PMT-"))
        # Ticket should have been created
        self.assertIsNotNone(gen["ticket"])
        ticket = frappe.get_doc("Maintenance Ticket", gen["ticket"])
        self.assertEqual(ticket.source_doctype, "Preventive Maintenance Plan")
        self.assertEqual(ticket.source_name, plan_name)

    def test_generate_advances_next_due_date(self):
        plan_name = self._create_plan(next_due_date="2026-07-01", recurrence_type="Monthly")
        generate_preventive_tasks(property=self.resort_property, through_date="2026-07-11")
        new_due = frappe.db.get_value("Preventive Maintenance Plan", plan_name, "next_due_date")
        self.assertEqual(getdate(new_due), date(2026, 8, 1))

    # ------------------------------------------------------------------
    # Idempotency: double-generation for same plan + due_date is a no-op
    # ------------------------------------------------------------------

    def test_generate_is_idempotent(self):
        self._create_plan(next_due_date="2026-07-10")
        # First call
        r1 = generate_preventive_tasks(property=self.resort_property, through_date="2026-07-11")
        self.assertEqual(r1["data"]["generated_count"], 1)

        # Reset next_due_date back to the same value to simulate a replay
        # (in real life idempotency guards against double-call before date advance)
        # Instead we directly test: call again with the already-advanced date
        # that now points to a future date — nothing should generate
        r2 = generate_preventive_tasks(property=self.resort_property, through_date="2026-07-11")
        self.assertEqual(r2["data"]["generated_count"], 0)
        self.assertEqual(r2["data"]["skipped_count"], 0)
        # The task count in the DB should still be exactly 1
        count = frappe.db.count("Preventive Maintenance Task", {})
        self.assertEqual(count, 1)

    def test_generate_same_due_date_skipped(self):
        """Directly verifying that inserting the same plan+due_date pair is skipped."""
        plan_name = self._create_plan(next_due_date="2026-07-05", recurrence_type="Manual")
        # First generation
        r1 = generate_preventive_tasks(property=self.resort_property, through_date="2026-07-11")
        self.assertEqual(r1["data"]["generated_count"], 1)

        # Force next_due_date back to the same date to simulate retry
        frappe.db.set_value("Preventive Maintenance Plan", plan_name, "next_due_date", date(2026, 7, 5))
        frappe.db.commit()

        r2 = generate_preventive_tasks(property=self.resort_property, through_date="2026-07-11")
        self.assertEqual(r2["data"]["generated_count"], 0)
        self.assertEqual(r2["data"]["skipped_count"], 1)
        self.assertEqual(r2["data"]["skipped"][0]["plan"], plan_name)

    # ------------------------------------------------------------------
    # Plans not due are not generated
    # ------------------------------------------------------------------

    def test_future_plan_not_generated(self):
        self._create_plan(next_due_date="2026-08-01")
        result = generate_preventive_tasks(
            property=self.resort_property, through_date="2026-07-11"
        )
        self.assertEqual(result["data"]["generated_count"], 0)

    # ------------------------------------------------------------------
    # Inactive plans are skipped
    # ------------------------------------------------------------------

    def test_inactive_plan_not_generated(self):
        self._create_plan(next_due_date="2026-07-01", active=0)
        result = generate_preventive_tasks(
            property=self.resort_property, through_date="2026-07-11"
        )
        self.assertEqual(result["data"]["generated_count"], 0)

    # ------------------------------------------------------------------
    # list_preventive_plans / list_preventive_tasks
    # ------------------------------------------------------------------

    def test_list_plans(self):
        self._create_plan(plan_name="Plan A")
        self._create_plan(plan_name="Plan B", next_due_date="2026-09-01")
        result = list_preventive_plans(property=self.resort_property)
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["total"], 2)

    def test_list_tasks_after_generation(self):
        self._create_plan(next_due_date="2026-07-05")
        generate_preventive_tasks(property=self.resort_property, through_date="2026-07-11")
        result = list_preventive_tasks(property=self.resort_property)
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["total"], 1)

    def test_list_tasks_filtered_by_status(self):
        self._create_plan(next_due_date="2026-07-05")
        generate_preventive_tasks(property=self.resort_property, through_date="2026-07-11")
        result = list_preventive_tasks(
            property=self.resort_property,
            filters={"task_status": "Generated"},
        )
        self.assertEqual(result["data"]["total"], 1)
        result_none = list_preventive_tasks(
            property=self.resort_property,
            filters={"task_status": "Completed"},
        )
        self.assertEqual(result_none["data"]["total"], 0)
