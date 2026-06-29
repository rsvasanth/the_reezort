import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.billing.api import add_folio_line
from the_reezort.billing.settlement import settle_folio
from the_reezort.pms.api import check_in
from the_reezort.setup.demo_seed import (
	ensure_reezort_company,
	seed_base_masters,
	seed_gst_tax,
	set_as_default_company,
)


class TestFolioSettlement(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		company = ensure_reezort_company()
		set_as_default_company(company)
		seed_base_masters()
		seed_gst_tax()
		cls.company = company
		cls.currency = frappe.db.get_value("Company", company, "default_currency")
		cls.resort_property = frappe.db.get_value("Resort Property", {}, "name")
		cls.room_type = frappe.db.get_value(
			"Room",
			{
				"resort_property": cls.resort_property,
				"sellable_status": "Sellable",
				"occupancy_status": "Vacant",
				"is_active": 1,
			},
			"room_type",
		)

	def setUp(self):
		super().setUp()
		frappe.db.set_value("Room", {"resort_property": self.resort_property}, "occupancy_status", "Vacant")

	def _make_confirmed_reservation(self):
		profile = frappe.get_doc(
			{
				"doctype": "Guest Profile",
				"guest_full_name": "Settlement Guest",
				"email": frappe.generate_hash(length=8) + "@example.com",
			}
		).insert(ignore_permissions=True)
		return frappe.get_doc(
			{
				"doctype": "Reservation",
				"resort_property": self.resort_property,
				"status": "Confirmed",
				"booking_source": "Direct",
				"arrival_date": add_days(today(), 1),
				"departure_date": add_days(today(), 3),
				"currency": self.currency,
				"staying_guest_profile": profile.name,
				"guests": [
					{"guest_profile": profile.name, "guest_name": "Settlement Guest", "guest_type": "Adult", "is_primary_guest": 1}
				],
				"rooms": [{"room_type": self.room_type, "adults": 2, "children": 0, "status": "Confirmed"}],
			}
		).insert(ignore_permissions=True)

	def _folio_with_room_charge(self, rate=14500):
		reservation = self._make_confirmed_reservation()
		checked_in = check_in(reservation.name)
		folio = checked_in["folio"]
		add_folio_line(
			folio,
			{
				"line_type": "Charge",
				"item_code": "ROOM-DLX",
				"qty": 1,
				"rate": rate,
				"source_module": "Room",
				"source_doctype": "Stay",
				"source_name": checked_in["stay"],
				"description": "Deluxe room tariff",
			},
		)
		return folio, checked_in["stay"]

	def test_settle_creates_submitted_gst_invoice_and_marks_lines_posted(self):
		folio, _stay = self._folio_with_room_charge(rate=14500)

		result = settle_folio(folio)
		invoice_name = result["data"]["sales_invoices"][0]
		invoice = frappe.get_doc("Sales Invoice", invoice_name)

		self.assertEqual(invoice.docstatus, 1)  # submitted
		self.assertEqual(invoice.net_total, 14500)
		self.assertEqual(invoice.total_taxes_and_charges, 2610)  # CGST 9% + SGST 9%
		self.assertEqual(invoice.grand_total, 17110)
		self.assertEqual(frappe.db.get_value("Guest Folio", folio, "posting_status"), "Posted")
		line = frappe.get_all("Folio Line", filters={"guest_folio": folio, "line_type": "Charge"}, fields=["line_status", "erpnext_sales_invoice"])[0]
		self.assertEqual(line.line_status, "Posted")
		self.assertEqual(line.erpnext_sales_invoice, invoice_name)

	def test_settle_with_payment_books_payment_entry_and_checks_out(self):
		folio, stay = self._folio_with_room_charge(rate=14500)

		result = settle_folio(folio, payments=[{"mode_of_payment": "Cash", "amount": 17110}])

		self.assertTrue(result["data"]["payment_entries"])
		payment_entry = frappe.get_doc("Payment Entry", result["data"]["payment_entries"][0])
		self.assertEqual(payment_entry.docstatus, 1)
		self.assertEqual(payment_entry.paid_amount, 17110)
		self.assertEqual(frappe.db.get_value("Guest Folio", folio, "folio_status"), "Settled")
		self.assertEqual(frappe.db.get_value("Stay", stay, "stay_status"), "Checked Out")

	def test_settle_is_idempotent(self):
		folio, _stay = self._folio_with_room_charge(rate=14500)

		first = settle_folio(folio)
		second = settle_folio(folio)

		self.assertEqual(first["data"]["sales_invoices"], second["data"]["sales_invoices"])
		self.assertTrue(second["data"]["reused"])
		self.assertEqual(frappe.db.count("Sales Invoice", {"remarks": ["like", f"%{folio}%"]}), 1)

	def test_settle_without_charges_is_blocked(self):
		reservation = self._make_confirmed_reservation()
		checked_in = check_in(reservation.name)

		with self.assertRaises(frappe.ValidationError):
			settle_folio(checked_in["folio"])
