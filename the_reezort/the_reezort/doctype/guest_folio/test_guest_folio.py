import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import today

from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


def insert_doc(doctype: str, ignore_links=False, **values):
	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True, ignore_links=ignore_links)
	return doc


class TestGuestFolio(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		if not cls.company:
			frappe.throw("A Company is required before running Guest Folio tests.")

		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]
		cls.customer = frappe.db.get_value("Customer", {"customer_name": "Walk-in Guest"}, "name")
		cls.item_code = frappe.db.get_value("Item", {"item_code": "ROOM-DLX"}, "name")

	def make_folio(self, **overrides):
		values = {
			"resort_property": self.resort_property,
			"company": self.company,
			"customer": self.customer,
			"currency": self.currency,
		}
		values.update(overrides)
		return insert_doc("Guest Folio", ignore_links=True, **values)

	def make_line(self, folio, **overrides):
		values = {
			"guest_folio": folio.name,
			"line_type": "Charge",
			"source_module": "PMS",
			"source_doctype": "Test Charge",
			"source_name": frappe.generate_hash(length=10),
			"idempotency_key": frappe.generate_hash(length=20),
			"service_date": today(),
			"item_code": self.item_code,
			"description": "Deluxe room charge",
			"qty": 1,
			"rate": 1000,
			"amount": 1000,
			"tax_treatment": "Standard",
		}
		values.update(overrides)
		return insert_doc("Folio Line", **values)

	def test_guest_folio_starts_in_draft(self):
		folio = self.make_folio()

		self.assertEqual(folio.folio_status, "Draft")
		self.assertEqual(folio.resort_property, self.resort_property)
		self.assertEqual(folio.company, self.company)
		self.assertEqual(folio.customer, self.customer)
		self.assertEqual(folio.currency, self.currency)

	def test_add_charge_folio_line_with_source_identity(self):
		folio = self.make_folio()
		line = self.make_line(
			folio,
			item_code=self.item_code,
			qty=2,
			rate=1200,
			amount=2400,
			source_module="PMS",
			source_doctype="Reservation",
			source_name="TEST-RES-001",
			source_row_id="ROW-001",
			idempotency_key="TEST-CHARGE-001",
		)

		self.assertEqual(line.guest_folio, folio.name)
		self.assertEqual(line.line_type, "Charge")
		self.assertEqual(line.item_code, self.item_code)
		self.assertEqual(line.qty, 2)
		self.assertEqual(line.rate, 1200)
		self.assertEqual(line.amount, 2400)
		self.assertEqual(line.source_module, "PMS")
		self.assertEqual(line.idempotency_key, "TEST-CHARGE-001")

	def test_manual_line_can_be_created_without_source_document(self):
		folio = self.make_folio()
		line = self.make_line(
			folio,
			source_module="Manual",
			source_doctype=None,
			source_name=None,
			idempotency_key="MANUAL-LINE-WITHOUT-SOURCE-DOC",
		)

		self.assertEqual(line.source_module, "Manual")
		self.assertIsNone(line.source_doctype)
		self.assertIsNone(line.source_name)

	def test_duplicate_idempotency_is_rejected(self):
		folio = self.make_folio()
		self.make_line(folio, idempotency_key="DUPLICATE-FOLIO-LINE")

		with self.assertRaises(frappe.ValidationError):
			self.make_line(folio, idempotency_key="DUPLICATE-FOLIO-LINE")

	def test_closed_folio_rejects_new_charge_line(self):
		folio = self.make_folio(folio_status="Closed")

		with self.assertRaises(frappe.ValidationError):
			self.make_line(folio)

	def test_editing_posted_line_is_blocked(self):
		folio = self.make_folio()
		line = self.make_line(folio)
		line.line_status = "Posted"
		line.save(ignore_permissions=True)

		line.description = "Edited after posting"
		with self.assertRaises(frappe.ValidationError):
			line.save(ignore_permissions=True)

	def test_one_primary_folio_per_stay_is_enforced(self):
		self.make_folio(stay="TEST-STAY-001", primary_folio=1)

		with self.assertRaises(frappe.ValidationError):
			self.make_folio(stay="TEST-STAY-001", primary_folio=1)

	def test_folio_totals_roll_up_from_lines(self):
		folio = self.make_folio()
		self.make_line(folio, amount=1000, discount_amount=100)

		folio.reload()
		self.assertEqual(folio.total_charges, 1000)
		self.assertEqual(folio.total_discounts, 100)
		self.assertEqual(folio.outstanding_amount, 900)
		self.assertEqual(folio.balance_status, "Outstanding")
