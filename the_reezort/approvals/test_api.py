"""Tests for the approval framework + audit event integration."""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.approvals.api import ApprovalRequired, decide_request, require_approval
from the_reezort.audit.api import record_audit_event


class TestApprovalFramework(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()

	def setUp(self):
		super().setUp()
		# Clean out any leftover policies from earlier runs.
		for name in frappe.get_all("Approval Policy", pluck="name"):
			frappe.delete_doc("Approval Policy", name, force=True, ignore_permissions=True)
		for name in frappe.get_all("Approval Request", pluck="name"):
			frappe.delete_doc("Approval Request", name, force=True, ignore_permissions=True)

	def _policy(self, action, threshold=0, source_doctype=None, auto_role=None):
		return frappe.get_doc({
			"doctype": "Approval Policy",
			"policy_name": f"{action} > {threshold}",
			"action": action,
			"approver_role": "System Manager",
			"threshold_amount": threshold,
			"source_doctype": source_doctype,
			"auto_approve_for_role": auto_role,
			"is_active": 1,
		}).insert(ignore_permissions=True)

	# ----- require_approval -----

	def test_no_policy_lets_action_proceed(self):
		proceed, req = require_approval(
			action="void",
			source_doctype="Folio Line",
			source_name="FL-x",
			payload={"amount": 100},
		)
		self.assertTrue(proceed)
		self.assertIsNone(req)

	def test_below_threshold_lets_action_proceed(self):
		self._policy("refund", threshold=10000)
		proceed, _req = require_approval(
			action="refund",
			source_doctype="Folio Line",
			source_name="FL-y",
			payload={"amount": 5000},
		)
		self.assertTrue(proceed)

	def test_over_threshold_raises_and_creates_pending_request(self):
		self._policy("refund", threshold=10000)
		with self.assertRaises(ApprovalRequired):
			require_approval(
				action="refund",
				source_doctype="Folio Line",
				source_name="FL-z",
				payload={"amount": 15000, "reason": "Guest goodwill"},
			)
		# Pending request now exists.
		self.assertTrue(frappe.db.exists("Approval Request", {"source_name": "FL-z", "state": "Pending"}))

	def test_idempotent_reraises_for_same_pending_request(self):
		self._policy("refund", threshold=1000)
		with self.assertRaises(ApprovalRequired):
			require_approval(
				action="refund", source_doctype="Folio Line",
				source_name="FL-p", payload={"amount": 5000},
			)
		# Second call re-uses the same request — still Pending, still raises.
		with self.assertRaises(ApprovalRequired):
			require_approval(
				action="refund", source_doctype="Folio Line",
				source_name="FL-p", payload={"amount": 5000},
			)
		# Only one request should exist.
		self.assertEqual(
			frappe.db.count("Approval Request", {"source_name": "FL-p"}), 1,
		)

	def test_approved_request_lets_action_proceed_on_retry(self):
		self._policy("refund", threshold=1000)
		try:
			require_approval(
				action="refund", source_doctype="Folio Line",
				source_name="FL-q", payload={"amount": 3000},
			)
		except ApprovalRequired:
			pass
		req_name = frappe.db.get_value("Approval Request", {"source_name": "FL-q"}, "name")

		# Simulate a different user approving.
		# We can't easily swap sessions in test — flip state directly.
		frappe.db.set_value("Approval Request", req_name, {"state": "Approved", "decided_by": "Administrator"})

		proceed, out = require_approval(
			action="refund", source_doctype="Folio Line",
			source_name="FL-q", payload={"amount": 3000},
			approval_request=req_name,
		)
		self.assertTrue(proceed)
		self.assertEqual(out, req_name)

	def test_auto_approve_for_role_writes_request_in_auto_state(self):
		# Requester is Administrator (default test user) — grant System Manager.
		self._policy("refund", threshold=1000, auto_role="System Manager")
		proceed, req_name = require_approval(
			action="refund", source_doctype="Folio Line",
			source_name="FL-auto", payload={"amount": 5000},
		)
		self.assertTrue(proceed)
		self.assertEqual(
			frappe.db.get_value("Approval Request", req_name, "state"), "Auto-Approved",
		)

	# ----- decide_request -----

	def test_decide_request_rejects_self_approval(self):
		self._policy("refund", threshold=1000)
		try:
			require_approval(
				action="refund", source_doctype="Folio Line",
				source_name="FL-self", payload={"amount": 5000},
			)
		except ApprovalRequired:
			pass
		req_name = frappe.db.get_value("Approval Request", {"source_name": "FL-self"}, "name")
		with self.assertRaises(frappe.PermissionError):
			decide_request(req_name, "Approved", "Should be blocked — self approval")

	def test_audit_event_written_on_decision(self):
		self._policy("refund", threshold=1000)
		try:
			require_approval(
				action="refund", source_doctype="Folio Line",
				source_name="FL-audit", payload={"amount": 5000},
			)
		except ApprovalRequired:
			pass
		req_name = frappe.db.get_value("Approval Request", {"source_name": "FL-audit"}, "name")
		# Fake a different session by setting requester to a non-Administrator user directly.
		frappe.db.set_value("Approval Request", req_name, "requester", "test@example.com")
		before = frappe.db.count("Audit Event", {"action": "approval_decided"})
		decide_request(req_name, "Approved", "Verified with guest")
		after = frappe.db.count("Audit Event", {"action": "approval_decided"})
		self.assertEqual(after, before + 1)


class TestAuditEvent(FrappeTestCase):
	def test_record_audit_event_writes_a_row(self):
		before = frappe.db.count("Audit Event")
		record_audit_event(
			source_doctype="Folio Line",
			source_name="FL-test",
			action="void",
			reason="Test",
			details={"line": "FL-test"},
		)
		after = frappe.db.count("Audit Event")
		self.assertEqual(after, before + 1)
