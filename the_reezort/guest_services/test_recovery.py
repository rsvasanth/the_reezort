"""Tests for Guest Services — Complaint, Recovery, and Handoff.

Run with:  bench run-tests --app the_reezort --module the_reezort.guest_services.test_recovery
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.guest_services import recovery


class TestGuestComplaint(FrappeTestCase):
    """Guest Complaint lifecycle tests."""

    def setUp(self):
        company = frappe.db.get_value("Company", {}, "name")
        code = "ZZRC"
        existing = frappe.db.get_value("Resort Property", {"property_code": code}, "name")
        self.prop = existing or frappe.get_doc(
            {
                "doctype": "Resort Property",
                "property_name": "ZZ Recovery",
                "property_code": code,
                "company": company,
                "timezone": "Asia/Kolkata",
            }
        ).insert(ignore_permissions=True).name

    def _make_complaint(self, **overrides):
        payload = {
            "property": self.prop,
            "category": "Maintenance",
            "severity": "High",
            "summary": "AC not cooling",
            "details": "Guest reported warm room after two prior requests.",
            "desired_resolution": "Room move or urgent repair",
        }
        payload.update(overrides)
        return recovery.create_complaint(payload)

    # ------------------------------------------------------------------
    # create_complaint happy path
    # ------------------------------------------------------------------

    def test_create_complaint_returns_open(self):
        out = self._make_complaint()
        self.assertTrue(out["ok"])
        data = out["data"]
        self.assertTrue(data["guest_complaint"].startswith("RZ-CMP-"))
        self.assertEqual(data["status"], "Open")
        self.assertFalse(data["escalated"])

    def test_create_complaint_legal_risk_auto_escalates(self):
        out = self._make_complaint(legal_or_safety_risk=True)
        self.assertTrue(out["ok"])
        data = out["data"]
        self.assertEqual(data["status"], "Escalated")
        self.assertTrue(data["escalated"])
        # Verify persisted
        doc = frappe.get_doc("Guest Complaint", data["guest_complaint"])
        self.assertEqual(doc.status, "Escalated")
        self.assertEqual(doc.legal_or_safety_risk, 1)

    def test_create_complaint_invalid_category_raises(self):
        with self.assertRaises(frappe.ValidationError):
            self._make_complaint(category="NonExistent")

    def test_create_complaint_missing_summary_raises(self):
        with self.assertRaises(frappe.MandatoryError):
            recovery.create_complaint(
                {
                    "property": self.prop,
                    "category": "F&B",
                    "severity": "Low",
                    "details": "Some details",
                    # summary intentionally missing
                }
            )

    # ------------------------------------------------------------------
    # Closed guard — resolution_summary required
    # ------------------------------------------------------------------

    def test_close_without_resolution_summary_raises(self):
        out = self._make_complaint()
        name = out["data"]["guest_complaint"]
        doc = frappe.get_doc("Guest Complaint", name)
        doc.status = "Closed"
        # resolution_summary is empty — should throw
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

    def test_close_with_resolution_summary_succeeds(self):
        out = self._make_complaint()
        name = out["data"]["guest_complaint"]
        doc = frappe.get_doc("Guest Complaint", name)
        doc.status = "Closed"
        doc.resolution_summary = "Issue resolved; guest satisfied with room move."
        doc.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("Guest Complaint", name, "status"), "Closed")


class TestServiceRecovery(FrappeTestCase):
    """Service Recovery Action — approval gate tests."""

    def setUp(self):
        company = frappe.db.get_value("Company", {}, "name")
        code = "ZZSR"
        existing = frappe.db.get_value("Resort Property", {"property_code": code}, "name")
        prop = existing or frappe.get_doc(
            {
                "doctype": "Resort Property",
                "property_name": "ZZ ServiceRecovery",
                "property_code": code,
                "company": company,
                "timezone": "Asia/Kolkata",
            }
        ).insert(ignore_permissions=True).name

        # Create a complaint to link against
        cmp_out = recovery.create_complaint(
            {
                "property": prop,
                "category": "Staff",
                "severity": "Medium",
                "summary": "Rude staff encounter",
                "details": "Guest complained about front desk behavior.",
            }
        )
        self.complaint = cmp_out["data"]["guest_complaint"]

    # ------------------------------------------------------------------
    # Non-financial recovery — no approval needed
    # ------------------------------------------------------------------

    def test_non_financial_recovery_is_draft_no_approval(self):
        out = recovery.propose_service_recovery(
            {
                "guest_complaint": self.complaint,
                "recovery_type": "Apology",
                "reason": "Sincere apology from GM",
            }
        )
        self.assertTrue(out["ok"])
        data = out["data"]
        self.assertEqual(data["status"], "Draft")
        self.assertFalse(data["approval_required"])

    # ------------------------------------------------------------------
    # Financial recovery — approval gate
    # ------------------------------------------------------------------

    def test_financial_recovery_requires_approval(self):
        out = recovery.propose_service_recovery(
            {
                "guest_complaint": self.complaint,
                "recovery_type": "Complimentary Item",
                "estimated_value": 2500,
                "reason": "Repeated AC issue for VIP guest",
            }
        )
        self.assertTrue(out["ok"])
        data = out["data"]
        self.assertEqual(data["status"], "Pending Approval")
        self.assertTrue(data["approval_required"])

    def test_positive_estimated_value_triggers_approval(self):
        out = recovery.propose_service_recovery(
            {
                "guest_complaint": self.complaint,
                "recovery_type": "Manager Call",
                "estimated_value": 100,
                "reason": "Goodwill gesture with cost",
            }
        )
        self.assertTrue(out["ok"])
        self.assertEqual(out["data"]["status"], "Pending Approval")
        self.assertTrue(out["data"]["approval_required"])

    def test_financial_recovery_blocks_posting_without_approval_request(self):
        """Controller must block status=Posted to Billing without approval_request."""
        doc = frappe.get_doc(
            {
                "doctype": "Service Recovery Action",
                "guest_complaint": self.complaint,
                "recovery_type": "Discount",
                "status": "Posted to Billing",
                "estimated_value": 500,
                "approval_required": 1,
                "reason": "Trying to post without approval",
                # approval_request intentionally absent
            }
        )
        with self.assertRaises(frappe.ValidationError):
            doc.insert(ignore_permissions=True)

    def test_recovery_without_complaint_or_request_raises(self):
        with self.assertRaises(frappe.MandatoryError):
            recovery.propose_service_recovery(
                {
                    "recovery_type": "Apology",
                    "reason": "No source linked",
                    # neither guest_complaint nor guest_request
                }
            )

    def test_complaint_status_advances_to_recovery_proposed(self):
        out = recovery.propose_service_recovery(
            {
                "guest_complaint": self.complaint,
                "recovery_type": "Amenity",
                "reason": "Welcome gift for inconvenience",
            }
        )
        self.assertTrue(out["ok"])
        status = frappe.db.get_value("Guest Complaint", self.complaint, "status")
        self.assertEqual(status, "Recovery Proposed")


class TestServiceHandoff(FrappeTestCase):
    """Service Handoff — cross-module link tests."""

    def setUp(self):
        company = frappe.db.get_value("Company", {}, "name")
        code = "ZZSH"
        existing = frappe.db.get_value("Resort Property", {"property_code": code}, "name")
        prop = existing or frappe.get_doc(
            {
                "doctype": "Resort Property",
                "property_name": "ZZ ServiceHandoff",
                "property_code": code,
                "company": company,
                "timezone": "Asia/Kolkata",
            }
        ).insert(ignore_permissions=True).name

        cmp_out = recovery.create_complaint(
            {
                "property": prop,
                "category": "Maintenance",
                "severity": "High",
                "summary": "Leak from ceiling",
                "details": "Water dripping in room 201.",
            }
        )
        self.complaint = cmp_out["data"]["guest_complaint"]

    def test_create_handoff_returns_created_status(self):
        out = recovery.create_service_handoff(
            {
                "source_doctype": "Guest Complaint",
                "source_name": self.complaint,
                "target_module": "Maintenance",
            }
        )
        self.assertTrue(out["ok"])
        data = out["data"]
        self.assertTrue(data["service_handoff"].startswith("RZ-SHF-"))
        self.assertEqual(data["status"], "Created")
        self.assertEqual(data["target_doctype"], "Maintenance Ticket")

    def test_create_handoff_invalid_module_raises(self):
        with self.assertRaises(frappe.ValidationError):
            recovery.create_service_handoff(
                {
                    "source_doctype": "Guest Complaint",
                    "source_name": self.complaint,
                    "target_module": "InvalidModule",
                }
            )

    def test_create_handoff_missing_source_raises(self):
        with self.assertRaises(frappe.MandatoryError):
            recovery.create_service_handoff(
                {
                    "source_doctype": "Guest Complaint",
                    # source_name missing
                    "target_module": "Maintenance",
                }
            )

    def test_create_handoff_nonexistent_source_raises(self):
        with self.assertRaises(frappe.DoesNotExistError):
            recovery.create_service_handoff(
                {
                    "source_doctype": "Guest Complaint",
                    "source_name": "RZ-CMP-NOTEXIST-99999",
                    "target_module": "Maintenance",
                }
            )
