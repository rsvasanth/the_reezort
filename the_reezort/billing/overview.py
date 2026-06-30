"""Billing overview — surface ERPNext Sales Invoices + Payment Entries in the SPA.

Read-only ledger over the financial truth that folio settlement posts, so finance
and management see billing without the ERPNext desk. Gated to finance/management roles.
"""

import frappe
from frappe import _

from the_reezort.billing.api import _envelope

FINANCE_ROLES = {"System Manager", "Accounts Manager", "Accounts User", "Resort Manager"}


def _require_finance():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)
	if not (FINANCE_ROLES & set(frappe.get_roles())):
		frappe.throw(_("Only finance or management can view billing."), frappe.PermissionError)


@frappe.whitelist()
def get_billing_overview(company=None, limit=50):
	_require_finance()
	limit = int(limit or 50)
	company = company or frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")
	currency = frappe.db.get_value("Company", company, "default_currency")

	invoices = frappe.get_all(
		"Sales Invoice",
		filters={"company": company, "docstatus": 1},
		fields=[
			"name", "customer", "customer_name", "posting_date",
			"grand_total", "outstanding_amount", "status", "currency",
		],
		order_by="posting_date desc, creation desc",
		limit=limit,
	)
	payments = frappe.get_all(
		"Payment Entry",
		filters={"company": company, "docstatus": 1, "payment_type": "Receive"},
		fields=[
			"name", "party", "party_name", "posting_date",
			"paid_amount", "mode_of_payment", "reference_no",
		],
		order_by="posting_date desc, creation desc",
		limit=limit,
	)

	# Summary across all submitted invoices (not just the page).
	totals = frappe.db.get_value(
		"Sales Invoice",
		{"company": company, "docstatus": 1},
		["sum(grand_total) as invoiced", "sum(outstanding_amount) as outstanding", "count(name) as cnt"],
		as_dict=True,
	) or {}
	invoiced = float(totals.get("invoiced") or 0)
	outstanding = float(totals.get("outstanding") or 0)

	return _envelope(
		{
			"company": company,
			"currency": currency,
			"summary": {
				"invoiced": invoiced,
				"collected": invoiced - outstanding,
				"outstanding": outstanding,
				"invoice_count": int(totals.get("cnt") or 0),
			},
			"invoices": [
				{
					"name": i.name,
					"customer": i.customer_name or i.customer,
					"posting_date": str(i.posting_date) if i.posting_date else None,
					"grand_total": i.grand_total,
					"outstanding_amount": i.outstanding_amount,
					"status": i.status,
					"currency": i.currency or currency,
				}
				for i in invoices
			],
			"payments": [
				{
					"name": p.name,
					"party": p.party_name or p.party,
					"posting_date": str(p.posting_date) if p.posting_date else None,
					"paid_amount": p.paid_amount,
					"mode_of_payment": p.mode_of_payment,
					"reference_no": p.reference_no,
				}
				for p in payments
			],
		}
	)
