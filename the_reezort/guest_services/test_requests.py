"""Tests for Guest Services — request lifecycle, SLA resolution, status transitions, verify."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_to_date, now_datetime

from the_reezort.guest_services import api


class TestGuestRequests(FrappeTestCase):
    def setUp(self):
        company = frappe.db.get_value("Company", {}, "name")
        code = "ZZGSR"
        existing = frappe.db.get_value("Resort Property", {"property_code": code}, "name")
        self.prop = existing or frappe.get_doc(
            {
                "doctype": "Resort Property",
                "property_name": "ZZ GuestSvc",
                "property_code": code,
                "company": company,
                "timezone": "Asia/Kolkata",
            }
        ).insert(ignore_permissions=True).name

        # Ensure a Guest Request Type exists
        if not frappe.db.exists("Guest Request Type", {"request_type_code": "TOWELS"}):
            frappe.get_doc(
                {
                    "doctype": "Guest Request Type",
                    "request_type_name": "Extra Towels",
                    "request_type_code": "TOWELS",
                    "default_department": "Housekeeping",
                    "default_priority": "Normal",
                    "is_active": 1,
                }
            ).insert(ignore_permissions=True)
        self.req_type = frappe.db.get_value(
            "Guest Request Type", {"request_type_code": "TOWELS"}, "name"
        )

        # Ensure a Room exists for duplicate-warning tests
        if not frappe.db.exists("Room", {"room_number": "ZZ-301", "resort_property": self.prop}):
            frappe.get_doc(
                {
                    "doctype": "Room",
                    "resort_property": self.prop,
                    "room_number": "ZZ-301",
                    "room_type": frappe.db.get_value("Room Type", {}, "name") or "Standard",
                    "floor": "3",
                    "status": "Vacant",
                }
            ).insert(ignore_permissions=True)
        self.room = frappe.db.get_value(
            "Room", {"room_number": "ZZ-301", "resort_property": self.prop}, "name"
        )

    def _base_payload(self, **kw):
        p = {
            "property": self.prop,
            "request_type": self.req_type,
            "subject": "Please bring towels",
            "room": self.room,
            "priority": "Normal",
        }
        p.update(kw)
        return p

    # ---- create ----

    def test_create_returns_sla_times(self):
        out = api.create_guest_request(self._base_payload())
        d = out["data"]
        self.assertEqual(d["status"], "New")
        self.assertIsNotNone(d["response_due_at"])
        self.assertIsNotNone(d["resolution_due_at"])

    def test_create_missing_required_fields(self):
        with self.assertRaises(frappe.ValidationError):
            api.create_guest_request({"property": self.prop, "room": self.room})

    def test_create_missing_guest_context(self):
        with self.assertRaises(frappe.ValidationError):
            api.create_guest_request(
                {
                    "property": self.prop,
                    "request_type": self.req_type,
                    "subject": "No context",
                }
            )

    def test_duplicate_warning(self):
        payload = self._base_payload()
        first = api.create_guest_request(payload)
        self.assertIsNone(first.get("warnings"))

        second = api.create_guest_request(payload)
        warnings = second.get("warnings") or []
        self.assertTrue(
            any("Duplicate" in w for w in warnings),
            "Expected a duplicate warning, got: {0}".format(warnings),
        )

    # ---- assign ----

    def test_assign_transitions_to_assigned(self):
        name = api.create_guest_request(self._base_payload())["data"]["guest_request"]
        out = api.assign_guest_request(name, "Administrator")
        self.assertEqual(out["data"]["status"], "Assigned")
        self.assertEqual(out["data"]["assigned_to"], "Administrator")

    def test_assign_invalid_user(self):
        name = api.create_guest_request(self._base_payload())["data"]["guest_request"]
        with self.assertRaises(frappe.ValidationError):
            api.assign_guest_request(name, "nobody@nowhere.invalid")

    def test_assign_from_closed_rejected(self):
        name = api.create_guest_request(self._base_payload())["data"]["guest_request"]
        # Force to Closed via controlled path
        frappe.db.set_value("Guest Request", name, {
            "status": "Closed",
            "completed_at": now_datetime(),
            "closed_at": now_datetime(),
        })
        with self.assertRaises(frappe.ValidationError):
            api.assign_guest_request(name, "Administrator")

    # ---- status transitions ----

    def test_status_progression(self):
        name = api.create_guest_request(self._base_payload())["data"]["guest_request"]
        api.assign_guest_request(name, "Administrator")
        api.update_guest_request_status(name, "In Progress")
        out = api.update_guest_request_status(name, "Completed")
        self.assertEqual(out["data"]["status"], "Completed")
        self.assertIsNotNone(out["data"]["completed_at"])

    def test_invalid_transition_rejected(self):
        name = api.create_guest_request(self._base_payload())["data"]["guest_request"]
        with self.assertRaises(frappe.ValidationError):
            # New -> Closed is not a valid transition
            api.update_guest_request_status(name, "Closed")

    def test_close_after_complete(self):
        name = api.create_guest_request(self._base_payload())["data"]["guest_request"]
        api.assign_guest_request(name, "Administrator")
        api.update_guest_request_status(name, "In Progress")
        api.update_guest_request_status(name, "Completed")
        out = api.update_guest_request_status(name, "Closed")
        self.assertEqual(out["data"]["status"], "Closed")
        self.assertIsNotNone(out["data"]["closed_at"])

    # ---- verify ----

    def test_verify_satisfied(self):
        name = api.create_guest_request(self._base_payload())["data"]["guest_request"]
        api.assign_guest_request(name, "Administrator")
        api.update_guest_request_status(name, "In Progress")
        api.update_guest_request_status(name, "Completed")
        out = api.verify_guest_request(name, "Satisfied")
        self.assertEqual(out["data"]["status"], "Verified")
        self.assertEqual(out["data"]["guest_satisfaction"], "Satisfied")

    def test_verify_not_satisfied_reopens(self):
        name = api.create_guest_request(self._base_payload())["data"]["guest_request"]
        api.assign_guest_request(name, "Administrator")
        api.update_guest_request_status(name, "In Progress")
        api.update_guest_request_status(name, "Completed")
        out = api.verify_guest_request(name, "Not Satisfied")
        self.assertEqual(out["data"]["status"], "Reopened")

    def test_verify_on_non_completed_raises(self):
        name = api.create_guest_request(self._base_payload())["data"]["guest_request"]
        with self.assertRaises(frappe.ValidationError):
            api.verify_guest_request(name, "Satisfied")

    def test_verify_invalid_satisfaction_raises(self):
        name = api.create_guest_request(self._base_payload())["data"]["guest_request"]
        api.assign_guest_request(name, "Administrator")
        api.update_guest_request_status(name, "In Progress")
        api.update_guest_request_status(name, "Completed")
        with self.assertRaises(frappe.ValidationError):
            api.verify_guest_request(name, "Maybe")

    # ---- service console ----

    def test_get_service_console_returns_envelope(self):
        api.create_guest_request(self._base_payload())
        out = api.get_service_console(self.prop)
        d = out["data"]
        self.assertIn("requests", d)
        self.assertIn("complaints", d)
        self.assertIn("counts", d)
        self.assertGreaterEqual(d["counts"]["open_requests"], 1)

    # ---- SLA rule resolution ----

    def test_sla_rule_overrides_default(self):
        # Create a tight SLA rule for this property + type
        rule_name = None
        try:
            rule = frappe.get_doc(
                {
                    "doctype": "Service SLA Rule",
                    "resort_property": self.prop,
                    "request_type": self.req_type,
                    "priority": "Normal",
                    "response_minutes": 5,
                    "resolution_minutes": 10,
                    "is_active": 1,
                }
            ).insert(ignore_permissions=True)
            rule_name = rule.name

            out = api.create_guest_request(self._base_payload())
            d = out["data"]
            # resolution_due_at should be ~10 minutes from now, not 120
            from frappe.utils import get_datetime
            from datetime import timedelta

            res_due = get_datetime(d["resolution_due_at"])
            now = now_datetime()
            delta = (res_due - now).total_seconds() / 60
            # Should be <=15 minutes (rule says 10; allow some clock skew)
            self.assertLessEqual(delta, 15)
        finally:
            if rule_name:
                frappe.delete_doc("Service SLA Rule", rule_name, force=True)
