"""Folio settlement → ERPNext Sales Invoice + Payment Entry (F4).

This is the ERPNext posting boundary for guest folios. It runs through the
idempotent `run_posting` wrapper (F3) so a retry with the same key never
creates a duplicate invoice/payment. It creates SUBMITTED financial documents,
so it is finance-gated and fully tested.
"""

import json

import frappe
from frappe import _
from frappe.utils import flt

from the_reezort.billing.erpnext_posting import (
	build_and_submit_sales_invoice,
	create_payment_entry_for_invoice,
)
from the_reezort.billing.posting import run_posting
from the_reezort.utils import as_list as _as_list
from the_reezort.utils import envelope as _envelope

CHARGEABLE_LINE_TYPES = {"Charge", "Adjustment"}
UNPOSTED_LINE_STATUSES = {"Draft", "Open", "Routed"}


def _require_finance_permission():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)
	if not frappe.has_permission("Sales Invoice", "create"):
		frappe.throw(_("You do not have permission to post invoices."), frappe.PermissionError)


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


def _folio_deposit_pes(guest_folio):
	"""The on-account Payment Entries from this folio's deposits, to net at settle."""
	return frappe.get_all(
		"Folio Line",
		filters={"guest_folio": guest_folio, "line_type": "Deposit Application", "erpnext_payment_entry": ["is", "set"]},
		pluck="erpnext_payment_entry",
	)


def _deposit_total(guest_folio):
	return flt(
		frappe.db.get_value(
			"Folio Line", {"guest_folio": guest_folio, "line_type": "Deposit Application"}, "sum(amount)"
		)
	)


def _create_sales_invoice(folio, charge_lines):
	return build_and_submit_sales_invoice(
		company=folio.company,
		customer=folio.customer,
		currency=folio.currency or "INR",
		lines=charge_lines,
		remarks=_("Folio {0}").format(folio.name),
		advance_pes=_folio_deposit_pes(folio.name),
	)


def _create_payment_entry(folio, sales_invoice, payment):
	return create_payment_entry_for_invoice(
		sales_invoice=sales_invoice,
		amount=payment.get("amount"),
		mode_of_payment=payment.get("mode_of_payment") or payment.get("payment_kind"),
		reference_no=payment.get("reference_no") or sales_invoice,
	)


def _mark_lines_posted(charge_lines, sales_invoice):
	for line in charge_lines:
		frappe.db.set_value(
			"Folio Line",
			line.name,
			{"line_status": "Posted", "erpnext_sales_invoice": sales_invoice},
			update_modified=False,
		)


def _finalize_folio(folio, sales_invoice, payments_total, grand_total, deposit_total=0, total_taxes=0):
	# Effective paid = settlement payments + the deposit advance already collected.
	effective_paid = flt(payments_total) + flt(deposit_total)
	fully_paid = effective_paid >= grand_total and grand_total > 0
	# Bake the invoice's tax into total_taxes_estimated so the folio's balance
	# equation closes at the front desk:
	#   total_charges + total_taxes_estimated − total_discounts − total_paid = outstanding_amount
	# Without this, the settlement rail shows Taxes = 0 while outstanding already
	# includes GST, and the visible sum reads as inconsistent to guests.
	frappe.db.set_value(
		"Guest Folio",
		folio.name,
		{
			"posting_status": "Posted",
			"folio_status": "Settled" if fully_paid else "Ready for Settlement",
			"balance_status": "Settled" if fully_paid else "Outstanding",
			"total_paid": effective_paid,
			"total_taxes_estimated": flt(total_taxes),
			"outstanding_amount": max(grand_total - effective_paid, 0),
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

	deposit_total = _deposit_total(guest_folio)

	def operation():
		sales_invoice = _create_sales_invoice(folio, charge_lines)
		payment_entries = [_create_payment_entry(folio, sales_invoice.name, p) for p in payments]
		payments_total = sum(flt(p.get("amount")) for p in payments)
		_mark_lines_posted(charge_lines, sales_invoice.name)
		_finalize_folio(
			folio,
			sales_invoice.name,
			payments_total,
			flt(sales_invoice.grand_total),
			deposit_total,
			total_taxes=flt(sales_invoice.total_taxes_and_charges),
		)
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
