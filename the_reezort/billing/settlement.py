"""Folio settlement → ERPNext Sales Invoice + Payment Entry (F4).

This is the ERPNext posting boundary for guest folios. It runs through the
idempotent `run_posting` wrapper (F3) so a retry with the same key never
creates a duplicate invoice/payment. It creates SUBMITTED financial documents,
so it is finance-gated and fully tested.
"""

import json

import frappe
from frappe import _
from frappe.utils import flt, today

from the_reezort.billing.posting import run_posting

CHARGEABLE_LINE_TYPES = {"Charge", "Adjustment"}
UNPOSTED_LINE_STATUSES = {"Draft", "Open", "Routed"}


def _as_list(value):
	if isinstance(value, str):
		return json.loads(value) if value else []
	return value or []


def _require_finance_permission():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)
	if not frappe.has_permission("Sales Invoice", "create"):
		frappe.throw(_("You do not have permission to post invoices."), frappe.PermissionError)


def _envelope(data, warnings=None, blockers=None, next_actions=None):
	return {
		"ok": True,
		"data": data,
		"warnings": warnings or [],
		"blockers": blockers or [],
		"next_actions": next_actions or [],
	}


def _billable_charge_lines(guest_folio):
	rows = frappe.get_all(
		"Folio Line",
		filters={
			"guest_folio": guest_folio,
			"line_type": ["in", list(CHARGEABLE_LINE_TYPES)],
			"line_status": ["in", list(UNPOSTED_LINE_STATUSES)],
		},
		fields=["name", "item_code", "description", "qty", "rate", "amount", "cost_center", "discount_amount"],
		order_by="service_date asc, creation asc",
	)
	return [row for row in rows if row.item_code]


def _default_sales_taxes_template(company):
	return frappe.db.get_value(
		"Sales Taxes and Charges Template", {"company": company, "is_default": 1}, "name"
	)


def _create_sales_invoice(folio, charge_lines):
	from erpnext.controllers.accounts_controller import get_taxes_and_charges

	si = frappe.new_doc("Sales Invoice")
	si.company = folio.company
	si.customer = folio.customer
	si.currency = folio.currency or "INR"
	si.conversion_rate = 1
	si.posting_date = today()
	si.due_date = today()
	si.remarks = _("Folio {0}").format(folio.name)

	for line in charge_lines:
		si.append(
			"items",
			{
				"item_code": line.item_code,
				"description": line.description,
				"qty": flt(line.qty) or 1,
				"rate": flt(line.rate),
				"cost_center": line.cost_center,
				"discount_amount": flt(line.discount_amount),
			},
		)

	template = _default_sales_taxes_template(folio.company)
	if template:
		si.taxes_and_charges = template
		for tax in get_taxes_and_charges("Sales Taxes and Charges Template", template):
			si.append("taxes", tax)

	si.insert(ignore_permissions=True)
	si.submit()
	return si


def _create_payment_entry(folio, sales_invoice, payment):
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	amount = flt(payment.get("amount"))
	pe = get_payment_entry("Sales Invoice", sales_invoice)
	pe.mode_of_payment = payment.get("mode_of_payment") or payment.get("payment_kind")
	pe.reference_no = payment.get("reference_no") or sales_invoice
	pe.reference_date = today()
	if amount:
		pe.paid_amount = amount
		pe.received_amount = amount
		for reference in pe.references:
			reference.allocated_amount = amount
	pe.insert(ignore_permissions=True)
	pe.submit()
	return pe.name


def _mark_lines_posted(charge_lines, sales_invoice):
	for line in charge_lines:
		frappe.db.set_value(
			"Folio Line",
			line.name,
			{"line_status": "Posted", "erpnext_sales_invoice": sales_invoice},
			update_modified=False,
		)


def _finalize_folio(folio, sales_invoice, payments_total, grand_total):
	fully_paid = payments_total >= grand_total and grand_total > 0
	frappe.db.set_value(
		"Guest Folio",
		folio.name,
		{
			"posting_status": "Posted",
			"folio_status": "Settled" if fully_paid else "Ready for Settlement",
			"balance_status": "Settled" if fully_paid else "Outstanding",
			"total_paid": payments_total,
			"outstanding_amount": max(grand_total - payments_total, 0),
		},
		update_modified=False,
	)
	if folio.stay and frappe.db.get_value("Stay", folio.stay, "stay_status") == "In House":
		frappe.db.set_value("Stay", folio.stay, {"stay_status": "Checked Out", "folio_status": "Settled"})
		room = frappe.db.get_value("Stay", folio.stay, "current_room")
		if room:
			frappe.db.set_value("Room", room, "occupancy_status", "Checked Out")


@frappe.whitelist()
def settle_folio(guest_folio, payments=None, idempotency_key=None):
	"""Settle a folio: post its charges to a Sales Invoice and capture payments."""
	_require_finance_permission()

	folio = frappe.get_doc("Guest Folio", guest_folio)
	payments = _as_list(payments)
	idempotency_key = idempotency_key or f"settle:{guest_folio}"

	# Idempotent short-circuit: if this folio was already settled under this key,
	# return the prior result instead of re-checking charges (which are now Posted).
	existing_status = frappe.db.get_value(
		"ERPNext Posting Log", {"idempotency_key": idempotency_key}, "posting_status"
	)
	if existing_status == "Posted":
		log = frappe.get_doc("ERPNext Posting Log", {"idempotency_key": idempotency_key})
		return _envelope(
			{
				"guest_folio": guest_folio,
				"posting_status": "Posted",
				"reused": True,
				"sales_invoices": frappe.parse_json(log.sales_invoices_json or "[]"),
				"payment_entries": frappe.parse_json(log.payment_entries_json or "[]"),
			}
		)

	if folio.folio_status in {"Settled", "Cancelled", "Closed"}:
		frappe.throw(_("Folio {0} is already {1}.").format(folio.name, folio.folio_status))

	charge_lines = _billable_charge_lines(guest_folio)
	if not charge_lines:
		frappe.throw(_("Folio {0} has no billable charges to settle.").format(folio.name))

	def operation():
		sales_invoice = _create_sales_invoice(folio, charge_lines)
		payment_entries = [_create_payment_entry(folio, sales_invoice.name, p) for p in payments]
		payments_total = sum(flt(p.get("amount")) for p in payments)
		_mark_lines_posted(charge_lines, sales_invoice.name)
		_finalize_folio(folio, sales_invoice.name, payments_total, flt(sales_invoice.grand_total))
		return {
			"sales_invoices": [sales_invoice.name],
			"payment_entries": payment_entries,
			"grand_total": flt(sales_invoice.grand_total),
			"total_taxes": flt(sales_invoice.total_taxes_and_charges),
		}

	result = run_posting("Folio Settlement", "Guest Folio", guest_folio, idempotency_key, operation)

	return _envelope(
		{
			"guest_folio": guest_folio,
			"posting_status": result["posting_status"],
			"reused": result["reused"],
			"sales_invoices": result["results"]["sales_invoices"],
			"payment_entries": result["results"]["payment_entries"],
		}
	)
