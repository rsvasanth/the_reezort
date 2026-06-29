import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.billing.direct_bill import DIRECT_BILL, create_direct_bill
from the_reezort.setup.demo_seed import (
	ensure_reezort_company,
	seed_base_masters,
	seed_gst_tax,
	set_as_default_company,
)


class TestDirectBill(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		company = ensure_reezort_company()
		set_as_default_company(company)
		seed_base_masters()
		seed_gst_tax()
		cls.company = company
		cls.currency = frappe.db.get_value("Company", company, "default_currency") or "INR"
		cls.resort_property = frappe.db.get_value("Resort Property", {}, "name")
		cls.customer = frappe.db.get_value("Customer", {"customer_name": "Walk-in Guest"}, "name")
		cls.key_prefix = frappe.generate_hash(length=10)

	@classmethod
	def tearDownClass(cls):
		if frappe.db.exists("DocType", DIRECT_BILL):
			frappe.db.delete(DIRECT_BILL, {"idempotency_key": ("like", f"{cls.key_prefix}%")})
		frappe.db.delete("ERPNext Posting Log", {"idempotency_key": ("like", f"{cls.key_prefix}%")})
		frappe.db.commit()
		super().tearDownClass()

	def _key(self, suffix):
		return f"{self.key_prefix}-{suffix}"

	def _payload(self, suffix, **overrides):
		payload = {
			"resort_property": self.resort_property,
			"company": self.company,
			"customer": self.customer,
			"currency": self.currency,
			"lines": [
				{
					"item_code": "FNB-ADD-BUFFET",
					"description": "Walk-in buffet",
					"qty": 1,
					"rate": 2200,
					"tax_treatment": "Standard",
				}
			],
			"idempotency_key": self._key(suffix),
		}
		payload.update(overrides)
		return payload

	def test_walk_in_fnb_direct_bill_posts_invoice_payment_without_folio_or_stay(self):
		initial_folios = frappe.db.count("Guest Folio")
		initial_stays = frappe.db.count("Stay")

		result = create_direct_bill(self._payload("PAID", payment={"mode_of_payment": "Cash"}))

		self.assertTrue(result["ok"])
		self.assertFalse(result["data"]["reused"])
		direct_bill = frappe.get_doc(DIRECT_BILL, result["data"]["direct_bill"])
		invoice = frappe.get_doc("Sales Invoice", result["data"]["sales_invoice"])
		payment_entry = frappe.get_doc("Payment Entry", result["data"]["payment_entry"])

		self.assertEqual(direct_bill.direct_bill_status, "Paid")
		self.assertEqual(invoice.docstatus, 1)
		self.assertEqual(invoice.items[0].item_code, "FNB-ADD-BUFFET")
		self.assertGreater(invoice.total_taxes_and_charges, 0)
		self.assertEqual(payment_entry.docstatus, 1)
		self.assertEqual(payment_entry.paid_amount, invoice.grand_total)
		self.assertEqual(frappe.db.count("Guest Folio"), initial_folios)
		self.assertEqual(frappe.db.count("Stay"), initial_stays)

	def test_direct_bill_is_idempotent_by_key(self):
		payload = self._payload("IDEM", payment={"mode_of_payment": "Cash"})

		first = create_direct_bill(payload)
		second = create_direct_bill(payload)

		self.assertEqual(first["data"]["sales_invoice"], second["data"]["sales_invoice"])
		self.assertEqual(first["data"]["payment_entry"], second["data"]["payment_entry"])
		self.assertTrue(second["data"]["reused"])
		self.assertEqual(frappe.db.count(DIRECT_BILL, {"idempotency_key": self._key("IDEM")}), 1)
		self.assertEqual(
			frappe.db.count("Sales Invoice", {"remarks": ["like", f"%{first['data']['direct_bill']}%"]}),
			1,
		)

	def test_credit_allowed_without_payment_leaves_invoice_outstanding(self):
		result = create_direct_bill(self._payload("CREDIT", credit_allowed=True))
		direct_bill = frappe.get_doc(DIRECT_BILL, result["data"]["direct_bill"])
		invoice = frappe.get_doc("Sales Invoice", result["data"]["sales_invoice"])

		self.assertEqual(direct_bill.direct_bill_status, "Outstanding")
		self.assertEqual(invoice.docstatus, 1)
		self.assertIsNone(result["data"]["payment_entry"])
		self.assertEqual(frappe.db.count("Payment Entry", {"name": result["data"]["payment_entry"]}), 0)

	def test_no_payment_without_credit_is_blocked(self):
		with self.assertRaises(frappe.ValidationError):
			create_direct_bill(self._payload("BLOCKED", credit_allowed=False))
