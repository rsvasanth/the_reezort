"""Deposit / part-payment (R2) — take an advance against a guest folio.

A deposit is a real on-account **Payment Entry** (real money, visible in Billing)
plus a **Deposit Application** folio line that reduces the folio's outstanding.
Idempotent on the deposit line's key. Full advance-to-invoice allocation at
settlement is a documented finance follow-up; the customer's net ledger is correct
(advance credit offsets the invoice).
"""

import frappe
from frappe import _
from frappe.utils import flt, today

from the_reezort.billing.api import _as_dict, _company_for_property, _envelope
from the_reezort.utils import require_permission as _require_permission_generic

# Terminal folio statuses — a deposit can't be taken once the folio is done.
# (Named CLOSED, not OPEN: billing/api.py separately defines an
# OPEN_FOLIO_STATUSES with the opposite meaning — the two modules used to
# share this name with contradictory contents, a landmine for whoever edited
# the wrong one next. See the 2026-07-10 audit.)
CLOSED_FOLIO_STATUSES = ("Settled", "Closed", "Cancelled")


def _require_permission(permission_type="write"):
	_require_permission_generic("Guest Folio", permission_type)


def _cash_account(company, mode_of_payment):
	"""Resolve the deposit's receiving account (mode-of-payment account, else default cash)."""
	if mode_of_payment and frappe.db.exists("Mode of Payment", mode_of_payment):
		acc = frappe.db.get_value(
			"Mode of Payment Account", {"parent": mode_of_payment, "company": company}, "default_account"
		)
		if acc:
			return acc
	return frappe.db.get_value("Company", company, "default_cash_account") or frappe.db.get_value(
		"Account", {"company": company, "account_type": "Cash", "is_group": 0}, "name"
	)


def _create_advance_payment_entry(customer, company, amount, mode_of_payment, reference_no):
	from erpnext.accounts.party import get_party_account

	party_account = get_party_account("Customer", customer, company)
	pe = frappe.new_doc("Payment Entry")
	pe.payment_type = "Receive"
	pe.party_type = "Customer"
	pe.party = customer
	pe.company = company
	pe.posting_date = today()
	pe.mode_of_payment = mode_of_payment
	pe.party_account = party_account
	pe.paid_from = party_account
	pe.paid_to = _cash_account(company, mode_of_payment)
	pe.paid_amount = flt(amount)
	pe.received_amount = flt(amount)
	pe.reference_no = reference_no or "Folio Deposit"
	pe.reference_date = today()
	pe.set_missing_values()
	pe.insert(ignore_permissions=True)
	pe.submit()
	return pe.name


@frappe.whitelist()
def record_deposit(guest_folio, amount, mode_of_payment="Cash", reference_no=None, idempotency_key=None):
	"""Record an advance/deposit against an open folio."""
	_require_permission("write")
	folio = frappe.get_doc("Guest Folio", guest_folio)
	if folio.folio_status in CLOSED_FOLIO_STATUSES:
		frappe.throw(_("Folio {0} is {1}; cannot add a deposit.").format(folio.name, folio.folio_status))

	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Deposit amount must be positive."))
	if not folio.customer:
		frappe.throw(_("Folio has no customer to receive the deposit."))

	# Add a random nonce to the auto-generated key so it can't be guessed and
	# replayed against another folio.
	key = (idempotency_key or f"deposit:{guest_folio}:{amount}:{mode_of_payment}:{frappe.generate_hash(length=10)}") + ":line"
	existing = frappe.db.get_value(
		"Folio Line", {"idempotency_key": key},
		["name", "erpnext_payment_entry", "guest_folio"], as_dict=True,
	)
	if existing:
		# An idempotency key is scoped to one folio. A cache hit for a different
		# folio means someone replayed another folio's key — refuse it.
		if existing.guest_folio != guest_folio:
			frappe.throw(_("Idempotency key already used for a different folio."))
		folio.reload()
		return _envelope(
			{
				"guest_folio": guest_folio,
				"folio_line": existing.name,
				"payment_entry": existing.erpnext_payment_entry,
				"outstanding": folio.outstanding_amount,
				"total_paid": folio.total_paid,
				"reused": True,
			}
		)

	company = _company_for_property(folio.resort_property)
	pe = _create_advance_payment_entry(folio.customer, company, amount, mode_of_payment, reference_no)

	line = frappe.get_doc(
		{
			"doctype": "Folio Line",
			"guest_folio": guest_folio,
			"line_type": "Deposit Application",
			"source_module": "PMS",
			"source_doctype": "Guest Folio",
			"source_name": guest_folio,
			"idempotency_key": key,
			"service_date": today(),
			"qty": 1,
			"rate": amount,
			"amount": amount,
			"tax_treatment": "Standard",
			"description": " · ".join(filter(None, [f"Deposit · {mode_of_payment}", reference_no])),
			"erpnext_payment_entry": pe,
		}
	)
	line.insert(ignore_permissions=True)

	folio.reload()
	return _envelope(
		{
			"guest_folio": guest_folio,
			"folio_line": line.name,
			"payment_entry": pe,
			"outstanding": folio.outstanding_amount,
			"total_paid": folio.total_paid,
			"reused": False,
		},
		next_actions=["settle_folio"],
	)
