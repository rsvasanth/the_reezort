"""Tests for the Spare Part Request API — spec 009 §spare_parts slice."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.maintenance.spares import (
    approve_spare_part_request,
    create_spare_material_request,
    issue_spare_parts,
    list_spare_requests,
    request_spare_parts,
)
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_ticket(resort_property, room=None):
    doc = frappe.get_doc(
        {
            "doctype": "Maintenance Ticket",
            "resort_property": resort_property,
            "subject": "Spare parts test ticket",
            "category": "Electrical",
            "priority": "Normal",
            "room": room,
            "description": "Test",
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc.name


def _make_item(item_code="TEST-FUSE-001", uom="Nos"):
    """Ensure a minimal Item record exists for testing."""
    if not frappe.db.exists("Item", item_code):
        item = frappe.get_doc(
            {
                "doctype": "Item",
                "item_code": item_code,
                "item_name": item_code,
                "item_group": "All Item Groups",
                "stock_uom": uom,
            }
        )
        item.insert(ignore_permissions=True)
        frappe.db.commit()
    return item_code


def _make_warehouse(name="Stores - TEST"):
    if not frappe.db.exists("Warehouse", name):
        company = (
            frappe.db.get_single_value("Global Defaults", "default_company")
            or frappe.db.get_value("Company", {}, "name")
        )
        wh = frappe.get_doc(
            {
                "doctype": "Warehouse",
                "warehouse_name": name,
                "company": company,
            }
        )
        wh.insert(ignore_permissions=True)
        frappe.db.commit()
    return name


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------


class TestSparesApi(FrappeTestCase):
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
        cls.item_code = _make_item()
        cls.warehouse = _make_warehouse()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        # Clean slate.
        frappe.db.delete("Spare Part Request", {})
        frappe.db.delete("Maintenance Ticket", {"resort_property": self.resort_property})
        frappe.db.commit()
        self.ticket = _make_ticket(self.resort_property, self.room)

    # ------------------------------------------------------------------
    # request_spare_parts
    # ------------------------------------------------------------------

    def test_request_creates_spr_in_requested_status(self):
        result = request_spare_parts(
            ticket=self.ticket,
            lines=[
                {
                    "item_code": self.item_code,
                    "requested_qty": 2,
                    "warehouse": self.warehouse,
                    "uom": "Nos",
                }
            ],
            reason="Fuse blown",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["request_status"], "Requested")
        spr_name = result["data"]["spare_request"]
        spr = frappe.get_doc("Spare Part Request", spr_name)
        self.assertEqual(len(spr.lines), 1)
        self.assertEqual(spr.lines[0].item_code, self.item_code)

    def test_request_requires_lines(self):
        with self.assertRaises(frappe.ValidationError):
            request_spare_parts(ticket=self.ticket, lines=[], reason="no lines")

    def test_request_requires_item_code(self):
        with self.assertRaises(frappe.ValidationError):
            request_spare_parts(
                ticket=self.ticket,
                lines=[{"requested_qty": 1}],
                reason="missing item",
            )

    def test_request_requires_positive_qty(self):
        with self.assertRaises(frappe.ValidationError):
            request_spare_parts(
                ticket=self.ticket,
                lines=[{"item_code": self.item_code, "requested_qty": 0}],
                reason="zero qty",
            )

    # ------------------------------------------------------------------
    # approve_spare_part_request
    # ------------------------------------------------------------------

    def _create_requested_spr(self):
        result = request_spare_parts(
            ticket=self.ticket,
            lines=[
                {
                    "item_code": self.item_code,
                    "requested_qty": 3,
                    "warehouse": self.warehouse,
                    "uom": "Nos",
                }
            ],
            reason="Capacitor replacement",
        )
        return result["data"]["spare_request"]

    def test_approve_sets_status_approved(self):
        spr_name = self._create_requested_spr()
        result = approve_spare_part_request(spare_request=spr_name, decision="Approved")
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["request_status"], "Approved")
        spr = frappe.get_doc("Spare Part Request", spr_name)
        self.assertEqual(spr.approved_by, "Administrator")
        # approved_qty should default to requested_qty.
        self.assertEqual(spr.lines[0].approved_qty, 3)

    def test_reject_sets_status_rejected(self):
        spr_name = self._create_requested_spr()
        result = approve_spare_part_request(spare_request=spr_name, decision="Rejected")
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["request_status"], "Rejected")

    def test_approve_invalid_decision_raises(self):
        spr_name = self._create_requested_spr()
        with self.assertRaises(frappe.ValidationError):
            approve_spare_part_request(spare_request=spr_name, decision="Maybe")

    def test_approve_non_requested_status_raises(self):
        spr_name = self._create_requested_spr()
        approve_spare_part_request(spare_request=spr_name, decision="Approved")
        # Approving again should raise.
        with self.assertRaises(frappe.ValidationError):
            approve_spare_part_request(spare_request=spr_name, decision="Approved")

    # ------------------------------------------------------------------
    # issue_spare_parts — idempotency is the critical invariant
    # ------------------------------------------------------------------

    def _create_approved_spr(self):
        spr_name = self._create_requested_spr()
        approve_spare_part_request(spare_request=spr_name, decision="Approved")
        return spr_name

    @patch("the_reezort.maintenance.spares._build_stock_entry")
    def test_issue_creates_stock_entry_and_updates_status(self, mock_build):
        """Mock out actual ERPNext SE creation; verify state machine."""
        spr_name = self._create_approved_spr()
        spr = frappe.get_doc("Spare Part Request", spr_name)
        idempotency_key = spr.idempotency_key

        # Build a fake SE doc.
        fake_se = MagicMock()
        fake_se.name = "SE-TEST-001"
        mock_build.return_value = fake_se

        result = issue_spare_parts(
            spare_request=spr_name, idempotency_key=idempotency_key
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["stock_entry"], "SE-TEST-001")
        self.assertFalse(result["data"]["reused"])

        spr.reload()
        self.assertEqual(spr.stock_entry, "SE-TEST-001")
        self.assertIn(spr.request_status, ("Issued", "Partially Issued"))

    @patch("the_reezort.maintenance.spares._build_stock_entry")
    def test_issue_idempotent_on_replay(self, mock_build):
        """Calling issue_spare_parts again with same key must NOT create a second SE."""
        spr_name = self._create_approved_spr()
        spr = frappe.get_doc("Spare Part Request", spr_name)
        idempotency_key = spr.idempotency_key

        fake_se = MagicMock()
        fake_se.name = "SE-TEST-IDEM-001"
        mock_build.return_value = fake_se

        # First call.
        issue_spare_parts(spare_request=spr_name, idempotency_key=idempotency_key)
        call_count_after_first = mock_build.call_count

        # Second call — must short-circuit.
        result2 = issue_spare_parts(spare_request=spr_name, idempotency_key=idempotency_key)
        self.assertTrue(result2["ok"])
        self.assertTrue(result2["data"]["reused"])
        # _build_stock_entry must NOT have been called again.
        self.assertEqual(mock_build.call_count, call_count_after_first)

    def test_issue_wrong_status_raises(self):
        spr_name = self._create_requested_spr()  # still Requested, not Approved
        spr = frappe.get_doc("Spare Part Request", spr_name)
        with self.assertRaises(frappe.ValidationError):
            issue_spare_parts(
                spare_request=spr_name, idempotency_key=spr.idempotency_key
            )

    @patch("the_reezort.maintenance.spares._build_stock_entry")
    def test_issue_key_mismatch_raises(self, mock_build):
        spr_name = self._create_approved_spr()
        with self.assertRaises(frappe.ValidationError):
            issue_spare_parts(
                spare_request=spr_name, idempotency_key="WRONG-KEY"
            )

    # ------------------------------------------------------------------
    # create_spare_material_request
    # ------------------------------------------------------------------

    @patch("the_reezort.maintenance.spares._build_material_request")
    def test_create_material_request_sets_status(self, mock_build):
        spr_name = self._create_approved_spr()

        fake_mr = MagicMock()
        fake_mr.name = "MR-TEST-001"
        mock_build.return_value = fake_mr

        result = create_spare_material_request(spare_request=spr_name)
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["material_request"], "MR-TEST-001")
        self.assertEqual(result["data"]["request_status"], "Material Requested")

        spr = frappe.get_doc("Spare Part Request", spr_name)
        self.assertEqual(spr.material_request, "MR-TEST-001")
        self.assertEqual(spr.request_status, "Material Requested")

    @patch("the_reezort.maintenance.spares._build_material_request")
    def test_create_material_request_idempotent(self, mock_build):
        """Second call returns existing MR without calling _build again."""
        spr_name = self._create_approved_spr()
        fake_mr = MagicMock()
        fake_mr.name = "MR-TEST-IDEM-001"
        mock_build.return_value = fake_mr

        create_spare_material_request(spare_request=spr_name)
        call_count = mock_build.call_count

        result2 = create_spare_material_request(spare_request=spr_name)
        self.assertTrue(result2["data"]["reused"])
        self.assertEqual(mock_build.call_count, call_count)

    def test_create_material_request_wrong_status_raises(self):
        spr_name = self._create_requested_spr()  # Requested, not Approved
        with self.assertRaises(frappe.ValidationError):
            create_spare_material_request(spare_request=spr_name)

    # ------------------------------------------------------------------
    # list_spare_requests
    # ------------------------------------------------------------------

    def test_list_by_ticket(self):
        self._create_requested_spr()
        self._create_requested_spr()
        result = list_spare_requests(ticket_or_property=self.ticket)
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["count"], 2)

    def test_list_by_property(self):
        self._create_requested_spr()
        result = list_spare_requests(ticket_or_property=self.resort_property)
        self.assertTrue(result["ok"])
        self.assertGreaterEqual(result["data"]["count"], 1)

    def test_list_empty_returns_ok(self):
        result = list_spare_requests(ticket_or_property="NONEXISTENT-TICKET-9999")
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["count"], 0)
