"""Shared ERPNext Sales Invoice / Payment Entry posting helpers.

These helpers are used by the billing posting boundary only. They create and
submit ERPNext financial documents from trusted billing service methods.
"""

import frappe
from frappe import _
from frappe.utils import flt, today


def default_sales_taxes_template(company):
	return frappe.db.get_value(
		"Sales Taxes and Charges Template", {"company": company, "is_default": 1}, "name"
	)


def default_sales_tax_rate(company):
	"""Total % from the company's default sales-taxes template — for folio GST estimates."""
	template = default_sales_taxes_template(company)
	if not template:
		return 0
	rates = frappe.get_all(
		"Sales Taxes and Charges",
		filters={"parent": template, "parenttype": "Sales Taxes and Charges Template"},
		pluck="rate",
	)
	return sum(flt(r) for r in rates)


def _allocate_advances(si, advance_pe_names):
	"""Allocate specific on-account Payment Entries (deposits) to this invoice.

	Scoped to the given PEs (e.g. the folio's own deposits) and capped at the
	invoice total, so the SI nets the advance instead of leaving it floating.
	"""
	si.set_advances()  # populate from the customer's unallocated advances
	grand_total = flt(si.rounded_total or si.grand_total)
	wanted = set(advance_pe_names or [])
	kept, allocated = [], 0.0
	for adv in si.get("advances") or []:
		if adv.reference_name in wanted and allocated < grand_total:
			cap = min(flt(adv.advance_amount), grand_total - allocated)
			if cap <= 0:
				continue
			adv.allocated_amount = cap
			allocated += cap
			kept.append(adv)
	si.set("advances", kept)
	return allocated


def build_and_submit_sales_invoice(company, customer, currency, lines, taxes_template=None, remarks=None, advance_pes=None):
	"""Build and submit a Sales Invoice for already-validated billing lines."""
	from erpnext.controllers.accounts_controller import get_taxes_and_charges

	si = frappe.new_doc("Sales Invoice")
	si.company = company
	si.customer = customer
	si.currency = currency or "INR"
	si.conversion_rate = 1
	si.posting_date = today()
	si.due_date = today()
	if remarks:
		si.remarks = remarks

	for line in lines:
		si.append(
			"items",
			{
				"item_code": _line_value(line, "item_code"),
				"description": _line_value(line, "description"),
				"qty": flt(_line_value(line, "qty")) or 1,
				"rate": flt(_line_value(line, "rate")),
				"cost_center": _line_value(line, "cost_center"),
				"discount_amount": flt(_line_value(line, "discount_amount")),
			},
		)

	template = taxes_template if taxes_template is not None else default_sales_taxes_template(company)
	if template:
		si.taxes_and_charges = template
		for tax in get_taxes_and_charges("Sales Taxes and Charges Template", template):
			si.append("taxes", tax)

	si.insert(ignore_permissions=True)
	if advance_pes:
		if _allocate_advances(si, advance_pes):
			si.save(ignore_permissions=True)
	si.submit()
	return si


def create_payment_entry_for_invoice(sales_invoice, amount, mode_of_payment, reference_no=None):
	"""Create and submit a Payment Entry allocated to a submitted Sales Invoice."""
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	invoice_name = sales_invoice.name if hasattr(sales_invoice, "name") else sales_invoice
	amount = flt(amount)
	pe = get_payment_entry("Sales Invoice", invoice_name)
	pe.mode_of_payment = mode_of_payment
	pe.reference_no = reference_no or invoice_name
	pe.reference_date = today()
	if amount:
		pe.paid_amount = amount
		pe.received_amount = amount
		for reference in pe.references:
			reference.allocated_amount = amount
	pe.insert(ignore_permissions=True)
	pe.submit()
	return pe.name


def _line_value(line, fieldname):
	if isinstance(line, dict):
		return line.get(fieldname)
	return getattr(line, fieldname, None)
