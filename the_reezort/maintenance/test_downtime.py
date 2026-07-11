"""Tests for Room Downtime API — module 009 core spine.

Covers:
  · create_room_downtime happy path
  · Sellability flip: Active blocking downtime → room maintenance_status changes
  · Release path: verify_and_release_room → downtime Released → room restored
  · OOO supervisor gate
  · extend_room_downtime
  · request_room_release → ticket Verification Required
  · add_ticket_note
  · get_room_downtime_board + get_engineering_board
"""

from __future__ import annotations

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_to_date, now_datetime

from the_reezort.maintenance.api import (
    add_ticket_note,
    create_ticket,
    transition_ticket,
)
from the_reezort.maintenance.downtime import (
    create_room_downtime,
    extend_room_downtime,
    get_engineering_board,
    get_room_downtime_board,
    request_room_release,
    verify_and_release_room,
)
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestRoomDowntimeApi(FrappeTestCase):
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
        frappe.db.delete("Room Downtime", {"resort_property": self.resort_property})
        frappe.db.delete("Maintenance Release Verification", {})
        frappe.db.delete("Maintenance Ticket", {"resort_property": self.resort_property})
        # Reset room maintenance status.
        if self.room:
            frappe.db.set_value("Room", self.room, "maintenance_status", "Available",
                                update_modified=False)
        frappe.db.commit()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _create_ticket(self, subject: str = "AC failure") -> dict:
        return create_ticket({
            "resort_property": self.resort_property,
            "subject": subject,
            "category": "HVAC",
            "priority": "High",
            "room": self.room,
        })["data"]["ticket"]

    def _create_downtime(self, ticket_name: str, downtime_type: str = "Under Repair") -> dict:
        now = now_datetime()
        return create_room_downtime({
            "room": self.room,
            "maintenance_ticket": ticket_name,
            "downtime_type": downtime_type,
            "start_at": str(now),
            "expected_release_at": str(add_to_date(now, hours=4)),
            "reason": "Test downtime",
            "revenue_impact_class": "High",
            "housekeeping_required": 1,
        })["data"]["downtime"]

    # ------------------------------------------------------------------
    # create_room_downtime
    # ------------------------------------------------------------------

    def test_create_downtime_happy_path(self):
        ticket = self._create_ticket()
        downtime = self._create_downtime(ticket["name"])

        self.assertEqual(downtime["downtime_status"], "Active")
        self.assertEqual(downtime["downtime_type"], "Under Repair")
        self.assertEqual(downtime["room"], self.room)

    def test_create_downtime_sets_ticket_revenue_blocking(self):
        ticket = self._create_ticket()
        downtime = self._create_downtime(ticket["name"])

        ticket_doc = frappe.get_doc("Maintenance Ticket", ticket["name"])
        self.assertEqual(ticket_doc.downtime, downtime["name"])
        self.assertEqual(int(ticket_doc.revenue_blocking), 1)

    # ------------------------------------------------------------------
    # Sellability flip
    # ------------------------------------------------------------------

    def test_active_blocking_downtime_sets_room_under_maintenance(self):
        """Under Repair → Room.maintenance_status = Under Maintenance."""
        ticket = self._create_ticket()
        self._create_downtime(ticket["name"], downtime_type="Under Repair")

        status = frappe.db.get_value("Room", self.room, "maintenance_status")
        self.assertEqual(status, "Under Maintenance")

    def test_active_ooo_downtime_sets_room_out_of_order(self):
        """Out of Order → Room.maintenance_status = Out of Order."""
        ticket = self._create_ticket()
        now = now_datetime()
        create_room_downtime({
            "room": self.room,
            "maintenance_ticket": ticket["name"],
            "downtime_type": "Out of Order",
            "start_at": str(now),
            "expected_release_at": str(add_to_date(now, hours=8)),
            "reason": "Major flood",
            "revenue_impact_class": "Critical",
            "approved_by": "Administrator",  # Satisfies OOO gate.
            "housekeeping_required": 1,
        })

        status = frappe.db.get_value("Room", self.room, "maintenance_status")
        self.assertEqual(status, "Out of Order")

    def test_released_downtime_restores_room_to_available(self):
        """After verify_and_release passes, room maintenance_status = Available."""
        ticket = self._create_ticket()
        # Walk ticket to Resolved so release path works.
        transition_ticket(ticket["name"], "In Progress")
        transition_ticket(ticket["name"], "Resolved", notes="Fixed")

        downtime = self._create_downtime(ticket["name"])
        request_room_release(downtime["name"], notes="Ready to verify")

        verify_and_release_room(downtime["name"], {
            "verification_status": "Passed",
            "verified_by": "Administrator",
            "notes": "All clear",
        })

        status = frappe.db.get_value("Room", self.room, "maintenance_status")
        self.assertEqual(status, "Available")

    # ------------------------------------------------------------------
    # OOO supervisor gate
    # ------------------------------------------------------------------

    def test_ooo_without_approved_by_raises(self):
        ticket = self._create_ticket()
        now = now_datetime()
        with self.assertRaises(frappe.ValidationError):
            create_room_downtime({
                "room": self.room,
                "maintenance_ticket": ticket["name"],
                "downtime_type": "Out of Order",
                "start_at": str(now),
                "expected_release_at": str(add_to_date(now, hours=8)),
                "reason": "Flood",
                "revenue_impact_class": "Critical",
                # No approved_by — should raise.
            })

    # ------------------------------------------------------------------
    # extend_room_downtime
    # ------------------------------------------------------------------

    def test_extend_increments_extension_count(self):
        ticket = self._create_ticket()
        downtime = self._create_downtime(ticket["name"])

        new_release = str(add_to_date(now_datetime(), hours=8))
        extended = extend_room_downtime(downtime["name"], new_release, "Need more time")["data"]["downtime"]

        self.assertEqual(extended["downtime_status"], "Extended")
        self.assertEqual(extended["extension_count"], 1)
        self.assertEqual(extended["expected_release_at"], new_release)

    # ------------------------------------------------------------------
    # request_room_release
    # ------------------------------------------------------------------

    def test_request_release_sets_pending_status(self):
        ticket = self._create_ticket()
        transition_ticket(ticket["name"], "In Progress")
        transition_ticket(ticket["name"], "Resolved", notes="Done")

        downtime = self._create_downtime(ticket["name"])
        result = request_room_release(downtime["name"], notes="Repair complete")

        self.assertEqual(result["data"]["downtime"]["downtime_status"], "Pending Release")
        ticket_state = frappe.db.get_value("Maintenance Ticket", ticket["name"], "state")
        self.assertEqual(ticket_state, "Verification Required")

    # ------------------------------------------------------------------
    # verify_and_release_room
    # ------------------------------------------------------------------

    def test_verify_passed_releases_ticket_to_released(self):
        ticket = self._create_ticket()
        transition_ticket(ticket["name"], "In Progress")
        transition_ticket(ticket["name"], "Resolved", notes="Fixed")

        downtime = self._create_downtime(ticket["name"])
        request_room_release(downtime["name"])
        result = verify_and_release_room(downtime["name"], {
            "verification_status": "Passed",
            "verified_by": "Administrator",
        })

        self.assertEqual(result["data"]["downtime"]["downtime_status"], "Released")
        ticket_state = frappe.db.get_value("Maintenance Ticket", ticket["name"], "state")
        self.assertEqual(ticket_state, "Released")

    def test_verify_creates_mrv_record(self):
        ticket = self._create_ticket()
        transition_ticket(ticket["name"], "In Progress")
        transition_ticket(ticket["name"], "Resolved", notes="Fixed")
        downtime = self._create_downtime(ticket["name"])
        request_room_release(downtime["name"])
        verify_and_release_room(downtime["name"], {
            "verification_status": "Passed",
            "verified_by": "Administrator",
        })

        mrv = frappe.db.get_value(
            "Maintenance Release Verification",
            {"room_downtime": downtime["name"]},
            ["name", "verification_status"],
            as_dict=True,
        )
        self.assertIsNotNone(mrv)
        self.assertEqual(mrv["verification_status"], "Passed")

    def test_verify_failed_keeps_downtime_pending(self):
        ticket = self._create_ticket()
        downtime = self._create_downtime(ticket["name"])
        request_room_release(downtime["name"])

        result = verify_and_release_room(downtime["name"], {
            "verification_status": "Failed",
            "verified_by": "Administrator",
            "notes": "AC still not working",
        })

        # Downtime stays in Pending Release on failure.
        dt_status = frappe.db.get_value("Room Downtime", downtime["name"], "downtime_status")
        self.assertEqual(dt_status, "Pending Release")
        self.assertGreater(len(result.get("blockers", [])), 0)

    # ------------------------------------------------------------------
    # add_ticket_note
    # ------------------------------------------------------------------

    def test_add_ticket_note_appends_to_technical_notes(self):
        ticket = self._create_ticket()
        add_ticket_note(ticket["name"], "Compressor replaced", visibility="Internal")
        t_doc = frappe.get_doc("Maintenance Ticket", ticket["name"])
        self.assertIn("Compressor replaced", t_doc.technical_notes or "")

    def test_add_guest_safe_note_goes_to_correct_field(self):
        ticket = self._create_ticket()
        add_ticket_note(ticket["name"], "AC being serviced", visibility="Guest Safe")
        t_doc = frappe.get_doc("Maintenance Ticket", ticket["name"])
        self.assertIn("AC being serviced", t_doc.guest_safe_note or "")

    # ------------------------------------------------------------------
    # Board views
    # ------------------------------------------------------------------

    def test_get_room_downtime_board_returns_active_downtimes(self):
        ticket = self._create_ticket()
        self._create_downtime(ticket["name"])
        result = get_room_downtime_board(self.resort_property)
        self.assertGreaterEqual(len(result["data"]["downtimes"]), 1)

    def test_get_engineering_board_returns_open_tickets(self):
        self._create_ticket(subject="Open ticket A")
        result = get_engineering_board(self.resort_property)
        self.assertGreaterEqual(len(result["data"]["tickets"]), 1)
