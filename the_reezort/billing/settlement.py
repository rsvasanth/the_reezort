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


def _record_settlement_lines(folio, sales_invoice, payments, payment_entries, idempotency_key, total_taxes):
	"""Record the settlement payment(s) and invoice tax as real Folio Lines.

	Guest Folio.recalculate_totals() derives total_paid/total_taxes_estimated/
	outstanding_amount from Folio Line rows alone, and it re-runs on every
	future line insert — so if a settlement payment only ever lived as a
	direct field write (the old behavior), the very next charge posted to
	this folio would silently erase it, reopening a "paid" balance. Payment
	Reference and Tax Preview lines are exactly the line types
	recalculate_totals already knows how to fold in; recording the real
	payment/tax as lines makes them survive any future recompute instead of
	being a one-off snapshot that gets overwritten.
	"""
	for index, (payment, payment_entry) in enumerate(zip(payments, payment_entries)):
		amount = flt(payment.get("amount"))
		if amount <= 0:
			continue
		frappe.get_doc(
			{
				"doctype": "Folio Line",
				"guest_folio": folio.name,
				"line_type": "Payment Reference",
				"source_module": "PMS",
				"source_doctype": "Sales Invoice",
				"source_name": sales_invoice,
				"idempotency_key": f"{idempotency_key}:payment:{index}",
				"service_date": today(),
				"qty": 1,
				"rate": amount,
				"amount": amount,
				"tax_treatment": "Standard",
				"description": " · ".join(
					filter(None, [f"Settlement · {payment.get('mode_of_payment') or payment.get('payment_kind')}", payment.get("reference_no")])
				),
				"erpnext_sales_invoice": sales_invoice,
				"erpnext_payment_entry": payment_entry,
			}
		).insert(ignore_permissions=True)

	total_taxes = flt(total_taxes)
	if total_taxes > 0:
		# Room check-in (pms.api._post_tax_estimate) already posts a pre-settlement
		# GST *estimate* as its own Tax Preview line. Void any such estimates now
		# that the real invoice tax is known, so recalculate_totals doesn't sum
		# the estimate and the authoritative figure together.
		frappe.db.set_value(
			"Folio Line",
			{"guest_folio": folio.name, "line_type": "Tax Preview", "line_status": ["!=", "Voided"]},
			"line_status",
			"Voided",
		)
		frappe.get_doc(
			{
				"doctype": "Folio Line",
				"guest_folio": folio.name,
				"line_type": "Tax Preview",
				"source_module": "PMS",
				"source_doctype": "Sales Invoice",
				"source_name": sales_invoice,
				"idempotency_key": f"{idempotency_key}:tax",
				"service_date": today(),
				"qty": 1,
				"rate": total_taxes,
				"amount": total_taxes,
				"tax_treatment": "Standard",
				"description": f"Tax · {sales_invoice}",
				"erpnext_sales_invoice": sales_invoice,
			}
		).insert(ignore_permissions=True)


def _finalize_folio(folio, sales_invoice, payments_total, grand_total, deposit_total=0, total_taxes=0):
	# Effective paid = settlement payments + the deposit advance already collected.
	effective_paid = flt(payments_total) + flt(deposit_total)
	fully_paid = effective_paid >= grand_total and grand_total > 0
	# total_paid / total_taxes_estimated / outstanding_amount are NOT written
	# here — they're derived by Guest Folio.recalculate_totals() from the
	# Payment Reference / Tax Preview lines _record_settlement_lines() just
	# inserted (each insert's after_insert hook already recomputed and saved
	# them). Only the status fields, which recalculate_totals doesn't touch,
	# are set directly.
	frappe.db.set_value(
		"Guest Folio",
		folio.name,
		{
			"posting_status": "Posted",
			"folio_status": "Settled" if fully_paid else "Ready for Settlement",
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
		_record_settlement_lines(
			folio, sales_invoice.name, payments, payment_entries, idempotency_key,
			total_taxes=flt(sales_invoice.total_taxes_and_charges),
		)
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
