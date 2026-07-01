"""Tests for folio corrections — void, transfer, credit note, refund."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.billing.api import get_or_create_folio
from the_reezort.billing.corrections import (
	post_credit_note,
	post_refund,
	transfer_folio_line,
	void_folio_line,
)
from the_reezort.billing.deposits import record_deposit
from the_reezort.billing.settlement import settle_folio
from the_reezort.pms.api import check_in
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestFolioCorrections(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]
		cls.room_type = frappe.db.get_value(
			"Room",
			{"resort_property": cls.resort_property, "sellable_status": "Sellable", "occupancy_status": "Vacant", "is_active": 1},
			"room_type",
		)

	def setUp(self):
		super().setUp()
		frappe.db.set_value("Room", {"resort_property": self.resort_property}, "occupancy_status", "Vacant")
		# Clear any Approval Policies (spec 015 wires an approval gate onto
		# post_refund; correction tests here don't need policies in play).
		for name in frappe.get_all("Approval Policy", pluck="name"):
			frappe.delete_doc("Approval Policy", name, force=True, ignore_permissions=True)

	def _fresh_folio_with_charge(self, extra_charge=False):
		"""Set up a reservation → check-in → folio with the auto room charge."""
		profile = frappe.get_doc(
			{"doctype": "Guest Profile", "guest_full_name": "Correction Guest", "email": frappe.generate_hash(length=8) + "@example.com"}
		).insert(ignore_permissions=True)
		res = frappe.get_doc(
			{
				"doctype": "Reservation",
				"resort_property": self.resort_property,
				"status": "Confirmed",
				"booking_source": "Direct",
				"arrival_date": today(),
				"departure_date": add_days(today(), 2),
				"currency": self.currency,
				"staying_guest_profile": profile.name,
				"guests": [{"guest_profile": profile.name, "guest_name": "Correction Guest", "guest_type": "Adult", "is_primary_guest": 1}],
				"rooms": [{"room_type": self.room_type, "adults": 2, "children": 0, "status": "Confirmed"}],
			}
		).insert(ignore_permissions=True)
		ci = check_in(res.name)
		return ci["folio"], ci["stay"]

	# ----- VOID -----

	def test_void_open_line_flips_status_and_zeros_amount(self):
		folio, _stay = self._fresh_folio_with_charge()
		# Grab the auto-posted room charge (defaults to Draft — pre-invoice).
		line_name = frappe.get_all(
			"Folio Line",
			filters={"guest_folio": folio, "line_type": "Charge"},
			pluck="name",
		)[0]

		result = void_folio_line(line_name, reason="Test cancellation")

		self.assertEqual(result["data"]["line_status"], "Voided")
		self.assertEqual(frappe.db.get_value("Folio Line", line_name, "amount"), 0)

	def test_void_requires_a_reason(self):
		folio, _stay = self._fresh_folio_with_charge()
		line_name = frappe.get_all("Folio Line", {"guest_folio": folio}, pluck="name")[0]
		with self.assertRaises(frappe.ValidationError):
			void_folio_line(line_name, reason="")

	def test_void_of_posted_line_is_refused(self):
		folio, _stay = self._fresh_folio_with_charge()
		# Force the line to Posted state as if settled.
		line_name = frappe.get_all("Folio Line", {"guest_folio": folio, "line_type": "Charge"}, pluck="name")[0]
		frappe.db.set_value("Folio Line", line_name, "line_status", "Posted")

		with self.assertRaises(frappe.ValidationError):
			void_folio_line(line_name, reason="Try to void a posted line")

	# ----- TRANSFER -----

	def test_transfer_moves_line_to_target_and_flips_source(self):
		src_folio, _stay = self._fresh_folio_with_charge()
		# Create a second, empty folio.
		other_res = frappe.copy_doc(frappe.get_doc("Reservation", frappe.db.get_value("Guest Folio", src_folio, "reservation")))
		other_res.name = None
		other_res.status = "Confirmed"
		other_res.staying_guest_profile = frappe.get_doc(
			{"doctype": "Guest Profile", "guest_full_name": "Other Guest", "email": frappe.generate_hash(length=8) + "@example.com"}
		).insert(ignore_permissions=True).name
		for row in other_res.rooms:
			row.name = None
		for row in other_res.guests:
			row.name = None
			row.guest_profile = other_res.staying_guest_profile
			row.guest_name = "Other Guest"
		other_res.insert(ignore_permissions=True)
		target_folio = get_or_create_folio(reservation=other_res.name)["data"]["folio"]["name"]

		line_name = frappe.get_all("Folio Line", {"guest_folio": src_folio, "line_type": "Charge"}, pluck="name")[0]

		result = transfer_folio_line(line_name, target_folio=target_folio, reason="Corporate split")

		self.assertEqual(frappe.db.get_value("Folio Line", line_name, "line_status"), "Transferred")
		self.assertEqual(
			frappe.db.get_value("Folio Line", result["data"]["target_line"], "guest_folio"),
			target_folio,
		)

	# ----- CREDIT NOTE -----

	def test_credit_note_creates_return_sales_invoice(self):
		folio, _stay = self._fresh_folio_with_charge()
		# Settle (no payment — just invoice the charge → line moves to Posted).
		settle_folio(folio, payments=[])
		charge = frappe.get_all(
			"Folio Line",
			filters={"guest_folio": folio, "line_type": "Charge", "line_status": "Posted"},
			fields=["name", "erpnext_sales_invoice"],
		)[0]

		result = post_credit_note(charge.name, reason="Compensation")

		cn = frappe.get_doc("Sales Invoice", result["data"]["credit_note"])
		self.assertEqual(cn.is_return, 1)
		self.assertEqual(cn.return_against, charge.erpnext_sales_invoice)
		self.assertEqual(cn.docstatus, 1)
		self.assertEqual(frappe.db.get_value("Folio Line", charge.name, "line_status"), "Credited")

	def test_credit_note_refuses_non_posted_line(self):
		folio, _stay = self._fresh_folio_with_charge()
		line_name = frappe.get_all("Folio Line", {"guest_folio": folio, "line_type": "Charge"}, pluck="name")[0]
		with self.assertRaises(frappe.ValidationError):
			post_credit_note(line_name, reason="Not posted yet")

	# ----- REFUND -----

	def test_refund_of_deposit_creates_pay_type_payment_entry(self):
		folio, _stay = self._fresh_folio_with_charge()
		record_deposit(folio, amount=10000, mode_of_payment="Cash")
		deposit_line = frappe.get_all(
			"Folio Line",
			filters={"guest_folio": folio, "line_type": "Deposit Application"},
			fields=["name", "erpnext_payment_entry"],
		)[0]

		result = post_refund(deposit_line.name, amount=10000, reason="Guest cancelled")

		refund_pe = frappe.get_doc("Payment Entry", result["data"]["refund_payment_entry"])
		self.assertEqual(refund_pe.payment_type, "Pay")
		self.assertEqual(refund_pe.paid_amount, 10000)
		self.assertEqual(frappe.db.get_value("Folio Line", deposit_line.name, "line_status"), "Refunded")

	def test_refund_amount_bounded_by_line_amount(self):
		folio, _stay = self._fresh_folio_with_charge()
		record_deposit(folio, amount=5000, mode_of_payment="Cash")
		deposit_line = frappe.get_all("Folio Line", {"guest_folio": folio, "line_type": "Deposit Application"}, pluck="name")[0]

		with self.assertRaises(frappe.ValidationError):
			post_refund(deposit_line, amount=99999, reason="Try to over-refund")

	# ----- APPROVAL GATES on void / transfer / credit_note -----

	def _policy(self, action, threshold=0, source_doctype=None):
		return frappe.get_doc({
			"doctype": "Approval Policy",
			"policy_name": f"{action} > {threshold}",
			"action": action,
			"approver_role": "System Manager",
			"threshold_amount": threshold,
			"source_doctype": source_doctype,
			"is_active": 1,
		}).insert(ignore_permissions=True)

	def test_void_over_threshold_requires_approval(self):
		from the_reezort.approvals.api import ApprovalRequired

		self._policy("void", threshold=1)
		folio, _stay = self._fresh_folio_with_charge()
		line_name = frappe.get_all(
			"Folio Line", {"guest_folio": folio, "line_type": "Charge"}, pluck="name"
		)[0]
		with self.assertRaises(ApprovalRequired):
			void_folio_line(line_name, reason="Guest goodwill — high amount")
		# Line stays untouched.
		self.assertNotEqual(
			frappe.db.get_value("Folio Line", line_name, "line_status"), "Voided"
		)
		# An Approval Request has been recorded.
		self.assertTrue(
			frappe.db.exists("Approval Request", {"source_name": line_name, "action": "void"})
		)

	def test_credit_note_over_threshold_requires_approval(self):
		from the_reezort.approvals.api import ApprovalRequired

		self._policy("credit_note", threshold=1)
		folio, _stay = self._fresh_folio_with_charge()
		settle_folio(folio, payments=[])
		posted_line = frappe.get_all(
			"Folio Line",
			filters={"guest_folio": folio, "line_type": "Charge", "line_status": "Posted"},
			pluck="name",
		)[0]
		with self.assertRaises(ApprovalRequired):
			post_credit_note(posted_line, reason="Test blocked by gate")
		self.assertTrue(
			frappe.db.exists("Approval Request", {"source_name": posted_line, "action": "credit_note"})
		)

	def test_transfer_over_threshold_requires_approval(self):
		from the_reezort.approvals.api import ApprovalRequired

		self._policy("transfer", threshold=1)
		src_folio, _stay = self._fresh_folio_with_charge()
		line_name = frappe.get_all(
			"Folio Line", {"guest_folio": src_folio, "line_type": "Charge"}, pluck="name"
		)[0]
		# Any target folio works; the gate fires before the actual transfer.
		other_res = frappe.copy_doc(
			frappe.get_doc("Reservation", frappe.db.get_value("Guest Folio", src_folio, "reservation"))
		)
		other_res.name = None
		other_res.status = "Confirmed"
		other_res.staying_guest_profile = frappe.get_doc(
			{"doctype": "Guest Profile", "guest_full_name": "Transfer Target", "email": frappe.generate_hash(length=8) + "@example.com"}
		).insert(ignore_permissions=True).name
		for row in other_res.rooms:
			row.name = None
		for row in other_res.guests:
			row.name = None
			row.guest_profile = other_res.staying_guest_profile
			row.guest_name = "Transfer Target"
		other_res.insert(ignore_permissions=True)
		target_folio = get_or_create_folio(reservation=other_res.name)["data"]["folio"]["name"]

		with self.assertRaises(ApprovalRequired):
			transfer_folio_line(line_name, target_folio=target_folio, reason="Split billing")
		self.assertTrue(
			frappe.db.exists("Approval Request", {"source_name": line_name, "action": "transfer"})
		)
