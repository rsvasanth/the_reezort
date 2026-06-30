import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from frappe.utils import flt

from the_reezort.billing.api import get_folio_detail, get_or_create_folio
from the_reezort.billing.deposits import record_deposit
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

	def _folio_with_room_charge(self):
		"""check_in now auto-posts the accommodation charge — use it, no manual duplicate."""
		reservation = self._make_confirmed_reservation()
		checked_in = check_in(reservation.name)
		folio = checked_in["folio"]
		net = flt(
			frappe.db.get_value(
				"Folio Line", {"guest_folio": folio, "line_type": "Charge", "source_module": "Room"}, "amount"
			)
		)
		return folio, checked_in["stay"], net

	def test_settle_creates_submitted_gst_invoice_and_marks_lines_posted(self):
		folio, _stay, net = self._folio_with_room_charge()

		result = settle_folio(folio)
		invoice_name = result["data"]["sales_invoices"][0]
		invoice = frappe.get_doc("Sales Invoice", invoice_name)

		self.assertEqual(invoice.docstatus, 1)  # submitted
		self.assertGreater(net, 0)  # the room charge was auto-posted at check-in
		self.assertEqual(invoice.net_total, net)
		self.assertAlmostEqual(invoice.total_taxes_and_charges, net * 0.18, delta=1)  # CGST 9% + SGST 9%
		self.assertEqual(invoice.grand_total, net + invoice.total_taxes_and_charges)
		self.assertEqual(frappe.db.get_value("Guest Folio", folio, "posting_status"), "Posted")
		line = frappe.get_all("Folio Line", filters={"guest_folio": folio, "line_type": "Charge"}, fields=["line_status", "erpnext_sales_invoice"])[0]
		self.assertEqual(line.line_status, "Posted")
		self.assertEqual(line.erpnext_sales_invoice, invoice_name)

	def test_settle_with_payment_books_payment_entry_and_checks_out(self):
		folio, stay, net = self._folio_with_room_charge()
		grand_total = net * 1.18

		result = settle_folio(folio, payments=[{"mode_of_payment": "Cash", "amount": grand_total}])

		self.assertTrue(result["data"]["payment_entries"])
		payment_entry = frappe.get_doc("Payment Entry", result["data"]["payment_entries"][0])
		self.assertEqual(payment_entry.docstatus, 1)
		self.assertAlmostEqual(payment_entry.paid_amount, grand_total, delta=1)
		self.assertEqual(frappe.db.get_value("Guest Folio", folio, "folio_status"), "Settled")
		self.assertEqual(frappe.db.get_value("Stay", stay, "stay_status"), "Checked Out")

	def test_settle_is_idempotent(self):
		folio, _stay, _net = self._folio_with_room_charge()

		first = settle_folio(folio)
		second = settle_folio(folio)

		self.assertEqual(first["data"]["sales_invoices"], second["data"]["sales_invoices"])
		self.assertTrue(second["data"]["reused"])
		self.assertEqual(frappe.db.count("Sales Invoice", {"remarks": ["like", f"%{folio}%"]}), 1)

	def test_folio_with_charges_offers_settlement_then_drops_it(self):
		folio, _stay, _net = self._folio_with_room_charge()
		before = get_folio_detail(folio)["next_actions"]
		self.assertIn("open_settlement", before)

		settle_folio(folio)
		after = get_folio_detail(folio)["next_actions"]
		self.assertNotIn("open_settlement", after)  # posted → no longer offered

	def test_deposit_is_allocated_and_folio_nets_to_zero(self):
		folio, _stay, net = self._folio_with_room_charge()
		grand_total = net * 1.18
		# Take a deposit, then settle paying the GST-inclusive remainder.
		record_deposit(folio, amount=10000, mode_of_payment="Cash")
		remainder = grand_total - 10000

		result = settle_folio(folio, payments=[{"mode_of_payment": "Cash", "amount": remainder}])

		invoice = frappe.get_doc("Sales Invoice", result["data"]["sales_invoices"][0])
		# The deposit advance is allocated onto the invoice.
		self.assertAlmostEqual(flt(invoice.total_advance), 10000, delta=1)
		# Folio fully settled: deposit + settlement payment cover the grand total.
		fol = frappe.db.get_value("Guest Folio", folio, ["folio_status", "outstanding_amount", "total_paid"], as_dict=True)
		self.assertEqual(fol.folio_status, "Settled")
		self.assertEqual(fol.outstanding_amount, 0)
		self.assertAlmostEqual(fol.total_paid, grand_total, delta=1)

	def test_settle_without_charges_is_blocked(self):
		# Open a folio directly (no check-in) so it carries no charges.
		reservation = self._make_confirmed_reservation()
		folio = get_or_create_folio(reservation=reservation.name)["data"]["folio"]["name"]

		with self.assertRaises(frappe.ValidationError):
			settle_folio(folio)
