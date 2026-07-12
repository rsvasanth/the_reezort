"""Tests for CRM Loyalty endpoints.

Run with: bench run-tests --app the_reezort --module the_reezort.crm.test_loyalty
"""

import unittest
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase


class TestResortLoyaltyProgram(FrappeTestCase):
    def test_create_program(self):
        doc = frappe.get_doc(
            {
                "doctype": "Resort Loyalty Program",
                "program_name": "_Test Program Alpha",
                "status": "Active",
                "accrual_basis": "Spend",
                "redemption_basis": "Points",
            }
        )
        doc.insert(ignore_permissions=True)
        self.assertEqual(doc.status, "Active")
        doc.delete()

    def test_negative_expiry_months_blocked(self):
        doc = frappe.get_doc(
            {
                "doctype": "Resort Loyalty Program",
                "program_name": "_Test Program Beta",
                "status": "Draft",
                "accrual_basis": "Manual",
                "redemption_basis": "Points",
                "expiry_months": -1,
            }
        )
        with self.assertRaises(frappe.ValidationError):
            doc.insert(ignore_permissions=True)


class TestSeedLoyalty(FrappeTestCase):
    def setUp(self):
        # Clean up seed record if it exists from a prior test run
        if frappe.db.exists("Resort Loyalty Program", "REEZORT Rewards"):
            frappe.delete_doc("Resort Loyalty Program", "REEZORT Rewards", ignore_permissions=True)
            frappe.db.commit()

    def tearDown(self):
        if frappe.db.exists("Resort Loyalty Program", "REEZORT Rewards"):
            frappe.delete_doc("Resort Loyalty Program", "REEZORT Rewards", ignore_permissions=True)
            frappe.db.commit()

    def test_seed_creates_default_program(self):
        from the_reezort.crm.seed_loyalty import seed_default_loyalty_program

        name = seed_default_loyalty_program()
        self.assertEqual(name, "REEZORT Rewards")
        self.assertTrue(frappe.db.exists("Resort Loyalty Program", "REEZORT Rewards"))

    def test_seed_is_idempotent(self):
        from the_reezort.crm.seed_loyalty import seed_default_loyalty_program

        name1 = seed_default_loyalty_program()
        name2 = seed_default_loyalty_program()
        self.assertEqual(name1, name2)
        count = frappe.db.count("Resort Loyalty Program", {"program_name": "REEZORT Rewards"})
        self.assertEqual(count, 1)


class TestEnrollLoyaltyMember(FrappeTestCase):
    """Tests for the enroll_loyalty_member endpoint."""

    def _make_guest_profile(self, suffix="01"):
        doc = frappe.get_doc(
            {
                "doctype": "Guest Profile",
                "full_name": f"_Test Guest {suffix}",
                "status": "Active",
            }
        )
        doc.insert(ignore_permissions=True)
        return doc.name

    def _make_program(self, name="_Test Enroll Program", status="Active"):
        if frappe.db.exists("Resort Loyalty Program", name):
            return name
        doc = frappe.get_doc(
            {
                "doctype": "Resort Loyalty Program",
                "program_name": name,
                "status": status,
                "accrual_basis": "Spend",
                "redemption_basis": "Points",
            }
        )
        doc.insert(ignore_permissions=True)
        return doc.name

    def tearDown(self):
        for dt in ("Loyalty Membership", "Loyalty Transaction"):
            for name in frappe.get_all(dt, filters={"loyalty_membership": ["like", "RZ-LMB-%"]}, pluck="name"):
                try:
                    frappe.delete_doc(dt, name, ignore_permissions=True)
                except Exception:
                    pass
        for name in frappe.get_all(
            "Loyalty Membership", filters={"guest_profile": ["like", "_Test%"]}, pluck="name"
        ):
            try:
                frappe.delete_doc("Loyalty Membership", name, ignore_permissions=True)
            except Exception:
                pass
        for name in frappe.get_all(
            "Guest Profile", filters={"full_name": ["like", "_Test Guest%"]}, pluck="name"
        ):
            try:
                frappe.delete_doc("Guest Profile", name, ignore_permissions=True)
            except Exception:
                pass
        for name in frappe.get_all(
            "Resort Loyalty Program", filters={"program_name": ["like", "_Test%"]}, pluck="name"
        ):
            try:
                frappe.delete_doc("Resort Loyalty Program", name, ignore_permissions=True)
            except Exception:
                pass
        if frappe.db.exists("Resort Loyalty Program", "REEZORT Rewards"):
            frappe.delete_doc("Resort Loyalty Program", "REEZORT Rewards", ignore_permissions=True)
        frappe.db.commit()

    def test_enroll_creates_membership(self):
        from the_reezort.crm.loyalty import enroll_loyalty_member

        guest = self._make_guest_profile("02")
        prog = self._make_program()

        result = enroll_loyalty_member({"guest_profile": guest, "loyalty_program": prog})
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["status"], "Active")
        self.assertIn("RZL-", result["data"]["membership_number"])

    def test_enroll_uses_default_program_when_none_given(self):
        from the_reezort.crm.loyalty import enroll_loyalty_member
        from the_reezort.crm.seed_loyalty import seed_default_loyalty_program

        seed_default_loyalty_program()
        guest = self._make_guest_profile("03")

        result = enroll_loyalty_member({"guest_profile": guest})
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["status"], "Active")

    def test_enroll_blocks_duplicate_active(self):
        from the_reezort.crm.loyalty import enroll_loyalty_member

        guest = self._make_guest_profile("04")
        prog = self._make_program("_Test No Dupe Program")

        enroll_loyalty_member({"guest_profile": guest, "loyalty_program": prog})
        with self.assertRaises(frappe.ValidationError):
            enroll_loyalty_member({"guest_profile": guest, "loyalty_program": prog})

    def test_enroll_inactive_program_blocked(self):
        from the_reezort.crm.loyalty import enroll_loyalty_member

        guest = self._make_guest_profile("05")
        prog = self._make_program("_Test Closed Program", status="Closed")

        with self.assertRaises(frappe.ValidationError):
            enroll_loyalty_member({"guest_profile": guest, "loyalty_program": prog})

    def test_enroll_missing_guest_profile_blocked(self):
        from the_reezort.crm.loyalty import enroll_loyalty_member

        with self.assertRaises(frappe.ValidationError):
            enroll_loyalty_member({})


class TestPostLoyaltyTransaction(FrappeTestCase):
    """Tests for post_loyalty_transaction."""

    def _setup_membership(self, program_name="_Test Txn Program", requires_approval=0):
        if not frappe.db.exists("Resort Loyalty Program", program_name):
            prog = frappe.get_doc(
                {
                    "doctype": "Resort Loyalty Program",
                    "program_name": program_name,
                    "status": "Active",
                    "accrual_basis": "Spend",
                    "redemption_basis": "Points",
                    "requires_approval_for_adjustment": requires_approval,
                }
            )
            prog.insert(ignore_permissions=True)

        guest = frappe.get_doc(
            {
                "doctype": "Guest Profile",
                "full_name": f"_Test Txn Guest {program_name}",
                "status": "Active",
            }
        )
        guest.insert(ignore_permissions=True)

        mem = frappe.get_doc(
            {
                "doctype": "Loyalty Membership",
                "guest_profile": guest.name,
                "loyalty_program": program_name,
                "membership_number": f"RZL-{guest.name[-6:]}",
                "status": "Active",
                "points_balance": 0.0,
                "joined_on": frappe.utils.today(),
            }
        )
        mem.insert(ignore_permissions=True)
        frappe.db.commit()
        return mem.name

    def tearDown(self):
        for name in frappe.get_all(
            "Loyalty Transaction", filters={"loyalty_membership": ["like", "RZ-LMB-%"]}, pluck="name"
        ):
            try:
                frappe.delete_doc("Loyalty Transaction", name, ignore_permissions=True)
            except Exception:
                pass
        for name in frappe.get_all(
            "Loyalty Membership", filters={"guest_profile": ["like", "%"]}, pluck="name"
        ):
            try:
                frappe.delete_doc("Loyalty Membership", name, ignore_permissions=True)
            except Exception:
                pass
        for name in frappe.get_all(
            "Guest Profile", filters={"full_name": ["like", "_Test Txn%"]}, pluck="name"
        ):
            try:
                frappe.delete_doc("Guest Profile", name, ignore_permissions=True)
            except Exception:
                pass
        for name in frappe.get_all(
            "Resort Loyalty Program", filters={"program_name": ["like", "_Test Txn%"]}, pluck="name"
        ):
            try:
                frappe.delete_doc("Resort Loyalty Program", name, ignore_permissions=True)
            except Exception:
                pass
        frappe.db.commit()

    def test_accrual_posts_and_updates_balance(self):
        from the_reezort.crm.loyalty import post_loyalty_transaction

        mem = self._setup_membership("_Test Txn Program Accrual")
        result = post_loyalty_transaction(
            {"loyalty_membership": mem, "transaction_type": "Accrual", "points": 500}
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["status"], "Posted")
        self.assertAlmostEqual(result["data"]["points_balance"], 500.0)

    def test_redemption_subtracts_balance(self):
        from the_reezort.crm.loyalty import post_loyalty_transaction

        mem = self._setup_membership("_Test Txn Program Redeem")
        post_loyalty_transaction(
            {"loyalty_membership": mem, "transaction_type": "Accrual", "points": 1000}
        )
        result = post_loyalty_transaction(
            {"loyalty_membership": mem, "transaction_type": "Redemption", "points": 300}
        )
        self.assertTrue(result["ok"])
        self.assertAlmostEqual(result["data"]["points_balance"], 700.0)

    def test_redemption_blocked_on_insufficient_balance(self):
        from the_reezort.crm.loyalty import post_loyalty_transaction

        mem = self._setup_membership("_Test Txn Program Insuf")
        post_loyalty_transaction(
            {"loyalty_membership": mem, "transaction_type": "Accrual", "points": 100}
        )
        with self.assertRaises(frappe.ValidationError):
            post_loyalty_transaction(
                {"loyalty_membership": mem, "transaction_type": "Redemption", "points": 500}
            )

    def test_adjustment_requires_reason(self):
        from the_reezort.crm.loyalty import post_loyalty_transaction

        mem = self._setup_membership("_Test Txn Program AdjReason")
        with self.assertRaises(frappe.ValidationError):
            post_loyalty_transaction(
                {"loyalty_membership": mem, "transaction_type": "Adjustment", "points": 50}
            )

    def test_adjustment_gated_draft_when_approval_required(self):
        from the_reezort.crm.loyalty import post_loyalty_transaction

        mem = self._setup_membership("_Test Txn Program Gate", requires_approval=1)
        result = post_loyalty_transaction(
            {
                "loyalty_membership": mem,
                "transaction_type": "Adjustment",
                "points": 50,
                "reason": "Manual correction",
            }
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["status"], "Draft")
        # Balance should NOT have changed
        balance = frappe.db.get_value("Loyalty Membership", mem, "points_balance")
        self.assertAlmostEqual(float(balance or 0), 0.0)

    def test_adjustment_posts_directly_when_no_approval_required(self):
        from the_reezort.crm.loyalty import post_loyalty_transaction

        mem = self._setup_membership("_Test Txn Program NoGate", requires_approval=0)
        result = post_loyalty_transaction(
            {
                "loyalty_membership": mem,
                "transaction_type": "Adjustment",
                "points": 75,
                "reason": "Goodwill credit",
            }
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["status"], "Posted")
        self.assertAlmostEqual(result["data"]["points_balance"], 75.0)

    def test_balance_recomputed_from_posted_only(self):
        """A Draft adjustment must NOT affect points_balance."""
        from the_reezort.crm.loyalty import post_loyalty_transaction

        mem = self._setup_membership("_Test Txn Program RecoG", requires_approval=1)
        post_loyalty_transaction(
            {"loyalty_membership": mem, "transaction_type": "Accrual", "points": 200}
        )
        # Gated adjustment — stays Draft
        post_loyalty_transaction(
            {
                "loyalty_membership": mem,
                "transaction_type": "Adjustment",
                "points": 999,
                "reason": "Should not count",
            }
        )
        balance = frappe.db.get_value("Loyalty Membership", mem, "points_balance")
        # Should still be 200 from the Accrual only
        self.assertAlmostEqual(float(balance or 0), 200.0)


class TestListAndGet(FrappeTestCase):
    """Tests for list_loyalty_transactions and get_membership."""

    def _bootstrap(self):
        if not frappe.db.exists("Resort Loyalty Program", "_Test LG Program"):
            prog = frappe.get_doc(
                {
                    "doctype": "Resort Loyalty Program",
                    "program_name": "_Test LG Program",
                    "status": "Active",
                    "accrual_basis": "Spend",
                    "redemption_basis": "Points",
                }
            )
            prog.insert(ignore_permissions=True)

        guest = frappe.get_doc(
            {"doctype": "Guest Profile", "full_name": "_Test LG Guest", "status": "Active"}
        )
        guest.insert(ignore_permissions=True)

        mem = frappe.get_doc(
            {
                "doctype": "Loyalty Membership",
                "guest_profile": guest.name,
                "loyalty_program": "_Test LG Program",
                "membership_number": f"RZL-LG-{guest.name[-4:]}",
                "status": "Active",
                "points_balance": 0.0,
                "joined_on": frappe.utils.today(),
            }
        )
        mem.insert(ignore_permissions=True)
        frappe.db.commit()
        return guest.name, mem.name

    def tearDown(self):
        for name in frappe.get_all("Loyalty Transaction", pluck="name"):
            try:
                frappe.delete_doc("Loyalty Transaction", name, ignore_permissions=True)
            except Exception:
                pass
        for name in frappe.get_all("Loyalty Membership", pluck="name"):
            try:
                frappe.delete_doc("Loyalty Membership", name, ignore_permissions=True)
            except Exception:
                pass
        for name in frappe.get_all(
            "Guest Profile", filters={"full_name": "_Test LG Guest"}, pluck="name"
        ):
            try:
                frappe.delete_doc("Guest Profile", name, ignore_permissions=True)
            except Exception:
                pass
        if frappe.db.exists("Resort Loyalty Program", "_Test LG Program"):
            frappe.delete_doc("Resort Loyalty Program", "_Test LG Program", ignore_permissions=True)
        frappe.db.commit()

    def test_list_loyalty_transactions_empty(self):
        from the_reezort.crm.loyalty import list_loyalty_transactions

        _, mem = self._bootstrap()
        result = list_loyalty_transactions(membership=mem)
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["total"], 0)

    def test_list_loyalty_transactions_after_post(self):
        from the_reezort.crm.loyalty import list_loyalty_transactions, post_loyalty_transaction

        _, mem = self._bootstrap()
        post_loyalty_transaction(
            {"loyalty_membership": mem, "transaction_type": "Accrual", "points": 100}
        )
        result = list_loyalty_transactions(membership=mem)
        self.assertEqual(result["data"]["total"], 1)
        self.assertEqual(result["data"]["transactions"][0]["transaction_type"], "Accrual")

    def test_get_membership_returns_active(self):
        from the_reezort.crm.loyalty import get_membership

        guest, mem = self._bootstrap()
        result = get_membership(guest_profile=guest)
        self.assertTrue(result["ok"])
        self.assertIsNotNone(result["data"]["membership"])
        self.assertEqual(result["data"]["membership"]["status"], "Active")

    def test_get_membership_no_enrollment_returns_null(self):
        from the_reezort.crm.loyalty import get_membership

        guest = frappe.get_doc(
            {"doctype": "Guest Profile", "full_name": "_Test LG NoMem Guest", "status": "Active"}
        )
        guest.insert(ignore_permissions=True)
        frappe.db.commit()

        result = get_membership(guest_profile=guest.name)
        self.assertTrue(result["ok"])
        self.assertIsNone(result["data"]["membership"])

        frappe.delete_doc("Guest Profile", guest.name, ignore_permissions=True)
        frappe.db.commit()
