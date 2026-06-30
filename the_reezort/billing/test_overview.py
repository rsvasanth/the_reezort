"""Tests for the billing overview (structure + permission gate)."""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.billing import overview


class TestBillingOverview(FrappeTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_overview_structure(self):
		out = overview.get_billing_overview()["data"]
		self.assertIn("summary", out)
		for key in ("invoiced", "collected", "outstanding", "invoice_count"):
			self.assertIn(key, out["summary"])
		self.assertIsInstance(out["invoices"], list)
		self.assertIsInstance(out["payments"], list)
		# collected = invoiced - outstanding by construction.
		s = out["summary"]
		self.assertAlmostEqual(s["collected"], s["invoiced"] - s["outstanding"], places=2)

	def test_non_finance_blocked(self):
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			overview.get_billing_overview()
