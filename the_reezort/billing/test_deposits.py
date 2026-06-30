"""Tests for deposit / part-payment (R2)."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from the_reezort.billing import deposits


class TestDeposits(FrappeTestCase):
	def setUp(self):
		company = frappe.db.get_value("Company", {}, "name")
		self.customer = frappe.db.get_value("Customer", {}, "name") or frappe.get_doc(
			{"doctype": "Customer", "customer_name": "ZZ Dep Guest"}
		).insert(ignore_permissions=True).name
		prop = frappe.db.get_value("Resort Property", {}, "name")
		self.folio = frappe.get_doc(
			{"doctype": "Guest Folio", "resort_property": prop, "customer": self.customer, "folio_status": "Open"}
		).insert(ignore_permissions=True).name
		# A charge so there is something to offset.
		frappe.get_doc(
			{
				"doctype": "Folio Line", "guest_folio": self.folio, "line_type": "Charge",
				"source_module": "Room", "source_doctype": "Guest Folio", "source_name": self.folio,
				"idempotency_key": f"charge-{self.folio}", "service_date": frappe.utils.today(),
				"qty": 1, "rate": 10000, "amount": 10000, "tax_treatment": "Standard", "description": "Room",
			}
		).insert(ignore_permissions=True)

	def test_deposit_creates_pe_and_reduces_outstanding(self):
		out = deposits.record_deposit(self.folio, 3000, mode_of_payment="Cash")["data"]
		self.assertFalse(out["reused"])
		self.assertTrue(out["payment_entry"])
		# Real, submitted Payment Entry for 3000.
		pe = frappe.get_doc("Payment Entry", out["payment_entry"])
		self.assertEqual(pe.docstatus, 1)
		self.assertEqual(flt(pe.paid_amount), 3000)
		# Folio: paid up by 3000, outstanding down to 7000.
		self.assertEqual(flt(out["total_paid"]), 3000)
		self.assertEqual(flt(out["outstanding"]), 7000)

	def test_deposit_idempotent(self):
		a = deposits.record_deposit(self.folio, 2000, idempotency_key="dep-x")["data"]
		b = deposits.record_deposit(self.folio, 2000, idempotency_key="dep-x")["data"]
		self.assertTrue(b["reused"])
		self.assertEqual(a["folio_line"], b["folio_line"])

	def test_reject_nonpositive(self):
		with self.assertRaises(frappe.ValidationError):
			deposits.record_deposit(self.folio, 0)
