"""Direct Billing API for non-stay customers.

Direct bills are the non-resident path: no Stay and no Guest Folio are created.
The service creates a Direct Bill wrapper and posts a submitted Sales Invoice,
plus an optional Payment Entry, through the idempotent posting log.
"""

import json

import frappe
from frappe import _
from frappe.utils import flt

from the_reezort.billing.erpnext_posting import (
	build_and_submit_sales_invoice,
	create_payment_entry_for_invoice,
	default_sales_taxes_template,
)
from the_reezort.billing.posting import run_posting
from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import as_list as _as_list
from the_reezort.utils import envelope as _envelope

DIRECT_BILL = "Direct Bill"
FINANCE_OR_CASHIER_ROLES = {
	"Accounts User",
	"Accounts Manager",
	"Finance Manager",
	"System Manager",
	"Cashier",
	"Restaurant",
	"Resort Manager",
}


def _require_direct_bill_permission():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)

	roles = set(frappe.get_roles(frappe.session.user))
	if roles.intersection(FINANCE_OR_CASHIER_ROLES):
		return

	if frappe.has_permission("Sales Invoice", "create"):
		return

	frappe.throw(_("You do not have permission to create direct bills."), frappe.PermissionError)


def _company_for_property(resort_property):
	return (
		frappe.db.get_single_value("Global Defaults", "default_company")
		or frappe.db.get_value("Resort Property", resort_property, "company")
		or frappe.db.get_value("Company", {}, "name")
	)


def _currency_for_company(company, explicit_currency=None):
	return explicit_currency or frappe.db.get_value("Company", company, "default_currency") or "INR"


def _line_amount(line):
	return flt(line.get("qty") or 1) * flt(line.get("rate"))


def _normalize_lines(lines):
	normalized = []
	for line in _as_list(lines):
		item_code = line.get("item_code")
		if not item_code:
			frappe.throw(_("Each direct bill line requires an item_code."))
		qty = flt(line.get("qty") or 1)
		rate = flt(line.get("rate"))
		normalized.append(
			{
				"item_code": item_code,
				"description": line.get("description") or item_code,
				"qty": qty,
				"rate": rate,
				"tax_treatment": line.get("tax_treatment") or "Standard",
				"discount_amount": flt(line.get("discount_amount")),
				"cost_center": line.get("cost_center"),
			}
		)
	if not normalized:
		frappe.throw(_("At least one direct bill line is required."))
	return normalized


def _get_or_create_direct_bill(payload, company, currency, lines, payment, credit_allowed):
	idempotency_key = payload.get("idempotency_key")
	if not idempotency_key:
		frappe.throw(_("An idempotency_key is required for a direct bill."))

	existing = frappe.db.get_value(DIRECT_BILL, {"idempotency_key": idempotency_key}, "name")
	if existing:
		return frappe.get_doc(DIRECT_BILL, existing)

	total = sum(_line_amount(line) for line in lines)
	doc = frappe.get_doc(
		{
			"doctype": DIRECT_BILL,
			"resort_property": payload.get("resort_property") or payload.get("property"),
			"company": company,
			"source_department": payload.get("source_department"),
			"customer": payload.get("customer"),
			"direct_bill_status": "Submitted",
			"currency": currency,
			"total_amount": total,
			"payment_mode": payment.get("mode_of_payment") or payment.get("payment_mode"),
			"credit_allowed": 1 if credit_allowed else 0,
			"idempotency_key": idempotency_key,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def _direct_bill_payload(payload):
	payload = _as_dict(payload)
	if not payload.get("resort_property") and payload.get("property"):
		payload["resort_property"] = payload.get("property")
	if not payload.get("resort_property"):
		frappe.throw(_("resort_property is required for direct billing."))
	if not payload.get("customer"):
		frappe.throw(_("customer is required for direct billing."))
	return payload


def _posted_response(direct_bill, result, reused):
	direct_bill.reload()
	return _envelope(
		{
			"direct_bill": direct_bill.name,
			"sales_invoice": direct_bill.sales_invoice,
			"payment_entry": direct_bill.payment_entry,
			"posting_log": direct_bill.posting_log,
			"posting_status": result["posting_status"],
			"reused": reused,
		},
		next_actions=["print_receipt"],
	)


@frappe.whitelist()
def create_direct_bill(payload):
	"""Create and post a non-stay direct bill."""
	_require_direct_bill_permission()
	payload = _direct_bill_payload(payload)
	lines = _normalize_lines(payload.get("lines"))
	payment = _as_dict(payload.get("payment"))
	credit_allowed = bool(payload.get("credit_allowed"))

	if not payment and not credit_allowed:
		frappe.throw(_("Payment or approved credit is required for a direct bill."))
	if payment and not (payment.get("mode_of_payment") or payment.get("payment_mode")):
		frappe.throw(_("Payment mode is required when payment is provided."))

	company = payload.get("company") or _company_for_property(payload.get("resort_property"))
	if not company:
		frappe.throw(_("A company is required for direct billing."))
	currency = _currency_for_company(company, payload.get("currency"))

	direct_bill = _get_or_create_direct_bill(payload, company, currency, lines, payment, credit_allowed)

	def operation():
		if direct_bill.sales_invoice:
			return {
				"sales_invoices": [direct_bill.sales_invoice],
				"payment_entries": [direct_bill.payment_entry] if direct_bill.payment_entry else [],
			}

		sales_invoice = build_and_submit_sales_invoice(
			company=company,
			customer=payload.get("customer"),
			currency=currency,
			lines=lines,
			taxes_template=default_sales_taxes_template(company),
			remarks=_("Direct Bill {0}").format(direct_bill.name),
		)
		payment_entry = None
		if payment:
			payment_amount = payment.get("amount")
			if payment_amount is None:
				payment_amount = sales_invoice.grand_total
			payment_entry = create_payment_entry_for_invoice(
				sales_invoice=sales_invoice,
				amount=payment_amount,
				mode_of_payment=payment.get("mode_of_payment") or payment.get("payment_mode"),
				reference_no=payment.get("reference_no"),
			)

		paid_amount = flt(payment_amount) if payment else 0
		status = "Paid" if paid_amount >= flt(sales_invoice.grand_total) and sales_invoice.grand_total else "Outstanding"
		frappe.db.set_value(
			DIRECT_BILL,
			direct_bill.name,
			{
				"sales_invoice": sales_invoice.name,
				"payment_entry": payment_entry,
				"posting_log": frappe.db.get_value(
					"ERPNext Posting Log", {"idempotency_key": payload.get("idempotency_key")}, "name"
				),
				"direct_bill_status": status,
				"total_amount": flt(sales_invoice.grand_total),
			},
			update_modified=False,
		)
		return {
			"sales_invoices": [sales_invoice.name],
			"payment_entries": [payment_entry] if payment_entry else [],
		}

	try:
		result = run_posting("Direct Bill", DIRECT_BILL, direct_bill.name, payload.get("idempotency_key"), operation)
	except Exception:
		if direct_bill.direct_bill_status not in {"Paid", "Outstanding"}:
			direct_bill.db_set("direct_bill_status", "Failed", update_modified=False)
		raise

	if result["reused"] and not direct_bill.posting_log:
		direct_bill.db_set("posting_log", result["posting_log"], update_modified=False)
	if not direct_bill.sales_invoice and result["results"].get("sales_invoices"):
		direct_bill.db_set("sales_invoice", result["results"]["sales_invoices"][0], update_modified=False)
	if not direct_bill.payment_entry and result["results"].get("payment_entries"):
		direct_bill.db_set("payment_entry", result["results"]["payment_entries"][0], update_modified=False)

	return _posted_response(direct_bill, result, result["reused"])


@frappe.whitelist()
def list_direct_bills(resort_property=None, status=None, customer=None, limit=50):
	"""List direct bills for the SPA billing screen."""
	_require_direct_bill_permission()

	filters = {}
	if resort_property:
		filters["resort_property"] = resort_property
	if status:
		filters["direct_bill_status"] = status
	if customer:
		filters["customer"] = customer

	bills = frappe.get_all(
		DIRECT_BILL,
		filters=filters,
		fields=[
			"name", "resort_property", "customer", "source_department",
			"direct_bill_status", "currency", "total_amount",
			"payment_mode", "credit_allowed", "sales_invoice",
			"payment_entry", "creation",
		],
		order_by="creation desc",
		limit=int(limit),
	)

	for b in bills:
		b["creation"] = str(b["creation"]) if b["creation"] else None
		b["total_amount"] = flt(b["total_amount"])
		customer_name = frappe.db.get_value("Customer", b["customer"], "customer_name")
		b["customer_name"] = customer_name or b["customer"]

	return _envelope({"bills": bills})


@frappe.whitelist()
def get_direct_bill_detail(direct_bill):
	"""Return a direct bill with its linked invoice items for the SPA."""
	_require_direct_bill_permission()

	doc = frappe.get_doc(DIRECT_BILL, direct_bill)
	result = {
		"name": doc.name,
		"resort_property": doc.resort_property,
		"company": doc.company,
		"customer": doc.customer,
		"customer_name": frappe.db.get_value("Customer", doc.customer, "customer_name") or doc.customer,
		"source_department": doc.source_department,
		"direct_bill_status": doc.direct_bill_status,
		"currency": doc.currency,
		"total_amount": flt(doc.total_amount),
		"payment_mode": doc.payment_mode,
		"credit_allowed": bool(doc.credit_allowed),
		"sales_invoice": doc.sales_invoice,
		"payment_entry": doc.payment_entry,
		"creation": str(doc.creation) if doc.creation else None,
	}

	items = []
	if doc.sales_invoice:
		si_items = frappe.get_all(
			"Sales Invoice Item",
			filters={"parent": doc.sales_invoice},
			fields=["item_code", "item_name", "description", "qty", "rate", "amount"],
			order_by="idx asc",
		)
		for row in si_items:
			row["qty"] = flt(row["qty"])
			row["rate"] = flt(row["rate"])
			row["amount"] = flt(row["amount"])
		items = si_items

	result["items"] = items
	return _envelope(result)
