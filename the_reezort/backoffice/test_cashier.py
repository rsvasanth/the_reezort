"""Tests for Cashier Close shift reconciliation (008)."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from the_reezort.backoffice.cashier import (
	approve_cashier_close,
	get_cashier_close,
	list_cashier_closes,
	open_cashier_close,
	submit_cashier_close,
)


def _make_user(email, roles):
	if not frappe.db.exists("User", email):
		frappe.get_doc(
			{"doctype": "User", "email": email, "first_name": email.split("@")[0], "send_welcome_email": 0}
		).insert(ignore_permissions=True)
	u = frappe.get_doc("User", email)
	have = {r.role for r in u.roles}
	for role in roles:
		if role not in have and frappe.db.exists("Role", role):
			u.append("roles", {"role": role})
	u.save(ignore_permissions=True)
	return email


class TestCashierClose(FrappeTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def _open(self, cashier_user=None):
		return open_cashier_close(close_type="Front Desk", cash_float=2000, cashier_user=cashier_user)["data"]

	def test_open_creates_open_close(self):
		out = self._open()
		self.assertEqual(out["close_status"], "Open")
		self.assertTrue(out["opening_time"])
		self.assertEqual(flt(out["cash_float"]), 2000)

	def test_submit_balanced_auto_approves(self):
		close = self._open()
		# Declare exactly what's expected (0 in a fresh test window) → no variance.
		out = submit_cashier_close(
			close["name"], {"payments": [{"payment_mode": "Cash", "declared_amount": 0}]}
		)["data"]
		self.assertEqual(out["close_status"], "Approved")
		self.assertEqual(flt(out["variance_amount"]), 0)

	def test_variance_without_reason_is_rejected(self):
		close = self._open()
		with self.assertRaises(frappe.ValidationError):
			submit_cashier_close(
				close["name"], {"payments": [{"payment_mode": "Cash", "declared_amount": 500}]}
			)

	def test_small_variance_with_reason_auto_approves(self):
		close = self._open()
		out = submit_cashier_close(
			close["name"],
			{"payments": [{"payment_mode": "Cash", "declared_amount": 50}], "variance_reason": "rounding"},
		)["data"]
		# 50 is under the 100 default threshold → approved, reason recorded.
		self.assertEqual(out["close_status"], "Approved")
		self.assertEqual(flt(out["variance_amount"]), 50)
		self.assertEqual(out["variance_reason"], "rounding")

	def test_large_variance_needs_manager_approval(self):
		cashier = _make_user("cashier_x@example.com", [])
		close = self._open(cashier_user=cashier)
		out = submit_cashier_close(
			close["name"],
			{"payments": [{"payment_mode": "Cash", "declared_amount": 5000}], "variance_reason": "till short"},
		)["data"]
		self.assertEqual(out["close_status"], "Submitted")  # pending approval

		# Manager (Administrator) approves — different user than the cashier.
		approved = approve_cashier_close(close["name"], "Approve", note="verified with CCTV")["data"]
		self.assertEqual(approved["close_status"], "Approved")
		self.assertEqual(approved["approved_by"], "Administrator")

	def test_self_approval_blocked(self):
		# Cashier is Administrator; Administrator also tries to approve → blocked.
		close = self._open(cashier_user="Administrator")
		submit_cashier_close(
			close["name"],
			{"payments": [{"payment_mode": "Cash", "declared_amount": 5000}], "variance_reason": "short"},
		)
		with self.assertRaises(frappe.PermissionError):
			approve_cashier_close(close["name"], "Approve", note="self")

	def test_non_manager_cannot_approve(self):
		cashier = _make_user("cashier_y@example.com", [])
		close = self._open(cashier_user=cashier)
		submit_cashier_close(
			close["name"],
			{"payments": [{"payment_mode": "Cash", "declared_amount": 5000}], "variance_reason": "short"},
		)
		clerk = _make_user("clerk_z@example.com", [])
		frappe.set_user(clerk)
		with self.assertRaises(frappe.PermissionError):
			approve_cashier_close(close["name"], "Approve", note="nope")

	def test_open_blocked_for_unprivileged_role(self):
		"""Security regression guard (2026-07-10 audit): open/get/submit/list used
		to only check frappe.session.user != "Guest" — any authenticated staff
		login (e.g. Housekeeping) could open or list cashier shifts. Endpoints
		must now enforce doctype-level RBAC via frappe.has_permission."""
		clerk = _make_user("housekeeping_cashier_test@example.com", ["Housekeeping"])
		frappe.set_user(clerk)
		with self.assertRaises(frappe.PermissionError):
			open_cashier_close(close_type="Front Desk", cash_float=0)

	def test_list_includes_new_close(self):
		close = self._open()
		names = [c["name"] for c in list_cashier_closes()["data"]["closes"]]
		self.assertIn(close["name"], names)
