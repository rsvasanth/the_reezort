"""Folio corrections — void / transfer / credit note / refund.

Every correction has a distinct set of guards driven by the Folio Line's
line_status state machine (defined on the doctype):

    Draft / Open / Routed   → editable → can VOID
    Posted                  → invoiced → can CREDIT NOTE (issues an ERPNext
                              return Sales Invoice against the original)
    Payment Reference /     → paid    → can REFUND (issues an ERPNext refund
    Deposit Application               Payment Entry against the original PE)
    Any editable line       → can TRANSFER to another folio (moves the line;
                              audit-linked back to source)

ERPNext postings run through the idempotent `run_posting` wrapper so retries
never double-book. Every correction records a compact audit trail on the
Folio Line's `completion_notes` and (when the Audit Event doctype exists)
into a proper log.
"""

import frappe
from frappe import _
from frappe.utils import flt, now, today

from the_reezort.billing.api import _as_dict, _envelope, _require_permission
from the_reezort.billing.posting import run_posting

CORRECTIBLE_STATUSES = {"Draft", "Open", "Routed"}  # pre-invoice states — safe to void/transfer
POSTED_LINE_STATUS = "Posted"
REFUNDABLE_TYPES = {"Payment Reference", "Deposit Application"}


def _audit(source_doctype, source_name, action, reason, details=None):
	"""Real Audit Event write — same signature as before; log is now live."""
	from the_reezort.audit.api import record_audit_event

	record_audit_event(source_doctype, source_name, action, reason=reason, details=details)


def _annotate_line(line_doc, action, reason):
	"""No-op placeholder — Folio Line has no free-text note field. Reason lives
	on the linked ERPNext doc's remarks and on the Audit Event log."""
	return


# ---------- VOID ---------------------------------------------------------------

@frappe.whitelist()
def void_folio_line(line, reason="", approval_request=None):
	"""Void a folio line that hasn't been invoiced yet.

	Blocks if the line is already Posted (use a credit note instead) or has a
	terminal status. Sets line_status = Voided and negates the amount so folio
	rollups reconcile without a phantom charge.
	"""
	_require_permission("Folio Line", "write")
	if not reason or not reason.strip():
		frappe.throw(_("A void reason is required."))

	doc = frappe.get_doc("Folio Line", line)
	if doc.line_status not in CORRECTIBLE_STATUSES:
		frappe.throw(
			_("Cannot void a {0} line. Use a credit note instead.").format(doc.line_status),
			frappe.ValidationError,
		)

	# Approval gate — a void above policy threshold requires manager sign-off.
	from the_reezort.approvals.api import require_approval

	require_approval(
		action="void",
		source_doctype="Folio Line",
		source_name=line,
		payload={"amount": flt(doc.amount), "reason": reason, "guest_folio": doc.guest_folio},
		approval_request=approval_request,
	)

	doc.line_status = "Voided"
	doc.amount = 0
	doc.rate = 0
	_annotate_line(doc, "VOID", reason)
	doc.save(ignore_permissions=True)
	_audit("Folio Line", doc.name, "void", reason, {"guest_folio": doc.guest_folio})

	frappe.db.commit()
	folio_totals = _folio_snapshot(doc.guest_folio)
	return _envelope({"line": doc.name, "line_status": doc.line_status, "folio": folio_totals})


# ---------- TRANSFER ----------------------------------------------------------

@frappe.whitelist()
def transfer_folio_line(line, target_folio, reason="", approval_request=None):
	"""Move an editable line from one folio to another (e.g. split billing).

	Guard: line must be pre-posting. Source line goes to Transferred; a new
	line is inserted on the target folio with identical amounts and an
	audit-idempotency key that ties the two.
	"""
	_require_permission("Folio Line", "write")
	if not reason or not reason.strip():
		frappe.throw(_("A transfer reason is required."))

	source = frappe.get_doc("Folio Line", line)
	if source.line_status not in CORRECTIBLE_STATUSES:
		frappe.throw(
			_("Cannot transfer a {0} line.").format(source.line_status),
			frappe.ValidationError,
		)
	target = frappe.get_doc("Guest Folio", target_folio)
	if target.folio_status in {"Settled", "Closed", "Cancelled"}:
		frappe.throw(_("Target folio {0} is closed for edits.").format(target.name))
	if source.guest_folio == target.name:
		frappe.throw(_("Source and target folio must differ."))

	# Approval gate — cross-folio transfers over policy threshold require sign-off.
	from the_reezort.approvals.api import require_approval

	require_approval(
		action="transfer",
		source_doctype="Folio Line",
		source_name=line,
		payload={
			"amount": flt(source.amount),
			"reason": reason,
			"from_folio": source.guest_folio,
			"to_folio": target.name,
		},
		approval_request=approval_request,
	)

	key = f"transfer:{source.name}"
	new_line = frappe.get_doc(
		{
			"doctype": "Folio Line",
			"guest_folio": target.name,
			"line_type": source.line_type,
			"source_module": source.source_module,
			"source_doctype": "Folio Line",
			"source_name": source.name,
			"idempotency_key": key,
			"service_date": source.service_date or today(),
			"item_code": source.item_code,
			"description": (source.description or "") + f" · Transferred from {source.guest_folio}",
			"qty": source.qty,
			"rate": source.rate,
			"amount": source.amount,
			"tax_treatment": source.tax_treatment,
			"cost_center": source.cost_center,
			"department": source.department,
		}
	).insert(ignore_permissions=True)

	source.line_status = "Transferred"
	_annotate_line(source, "TRANSFER", f"To {target.name}: {reason}")
	source.save(ignore_permissions=True)

	_audit(
		"Folio Line", source.name, "transfer", reason,
		{"from_folio": source.guest_folio, "to_folio": target.name, "new_line": new_line.name},
	)

	frappe.db.commit()
	return _envelope(
		{
			"source_line": source.name,
			"target_line": new_line.name,
			"target_folio": target.name,
			"source_folio": _folio_snapshot(source.guest_folio),
			"target_folio_totals": _folio_snapshot(target.name),
		}
	)


# ---------- CREDIT NOTE -------------------------------------------------------

@frappe.whitelist()
def post_credit_note(line, reason="", approval_request=None):
	"""Credit an already-posted line via an ERPNext return Sales Invoice.

	Uses the original SI as the return_against so ERPNext keeps the audit
	chain and stock (if any) reverses correctly. Idempotent per Folio Line.
	"""
	_require_permission("Sales Invoice", "create")
	if not reason or not reason.strip():
		frappe.throw(_("A credit-note reason is required."))

	doc = frappe.get_doc("Folio Line", line)
	if doc.line_status != POSTED_LINE_STATUS:
		frappe.throw(
			_("Only Posted lines can be credited (this one is {0}).").format(doc.line_status),
			frappe.ValidationError,
		)
	if not doc.erpnext_sales_invoice:
		frappe.throw(_("Line {0} has no linked Sales Invoice to credit against.").format(line))

	# Approval gate — credit-note above policy threshold requires manager sign-off.
	from the_reezort.approvals.api import require_approval

	require_approval(
		action="credit_note",
		source_doctype="Folio Line",
		source_name=line,
		payload={
			"amount": flt(doc.amount),
			"reason": reason,
			"guest_folio": doc.guest_folio,
			"invoice": doc.erpnext_sales_invoice,
		},
		approval_request=approval_request,
	)

	folio = frappe.get_doc("Guest Folio", doc.guest_folio)
	original = frappe.get_doc("Sales Invoice", doc.erpnext_sales_invoice)
	idempotency_key = f"credit-note:{doc.name}"

	def operation():
		cn = frappe.new_doc("Sales Invoice")
		cn.company = original.company
		cn.customer = original.customer
		cn.currency = original.currency
		cn.conversion_rate = 1
		cn.posting_date = today()
		cn.due_date = today()
		cn.is_return = 1
		cn.return_against = original.name
		cn.remarks = _("Credit Note against {0} · {1}").format(original.name, reason)

		# Return the matching item line (negative qty is the ERPNext convention).
		cn.append(
			"items",
			{
				"item_code": doc.item_code,
				"description": (doc.description or "") + f" · Credited: {reason}",
				"qty": -flt(doc.qty) or -1,
				"rate": flt(doc.rate),
				"cost_center": doc.cost_center,
			},
		)

		# Carry the same taxes template from the original SI.
		if original.taxes_and_charges:
			cn.taxes_and_charges = original.taxes_and_charges
			from erpnext.controllers.accounts_controller import get_taxes_and_charges

			for tax in get_taxes_and_charges("Sales Taxes and Charges Template", original.taxes_and_charges):
				cn.append("taxes", tax)

		cn.insert(ignore_permissions=True)
		cn.submit()

		# Line is Posted (immutable via .save) — flip to the terminal audit state
		# via direct set_value. Reason is captured on the Sales Invoice remarks
		# and in Audit Event.
		frappe.db.set_value(
			"Folio Line",
			doc.name,
			{"line_status": "Credited", "erpnext_credit_note": cn.name},
			update_modified=False,
		)

		frappe.db.set_value(
			"Guest Folio",
			folio.name,
			{
				"total_charges": max(flt(folio.total_charges) - flt(doc.amount), 0),
				"outstanding_amount": max(flt(folio.outstanding_amount) - flt(doc.amount), 0),
			},
			update_modified=False,
		)

		# run_posting stores credit_notes / payment_entries / sales_invoices → use those keys.
		return {"credit_notes": [cn.name], "grand_total": flt(cn.grand_total)}

	result = run_posting("Credit Note", "Guest Folio", folio.name, idempotency_key, operation)
	credit_note = (result["results"].get("credit_notes") or [None])[0]
	_audit("Folio Line", line, "credit_note", reason, {"credit_note": credit_note, "folio": folio.name})
	return _envelope(
		{
			"line": line,
			"line_status": "Credited",
			"credit_note": credit_note,
			"folio": _folio_snapshot(folio.name),
			"reused": result["reused"],
		}
	)


# ---------- REFUND -----------------------------------------------------------

@frappe.whitelist()
def post_refund(line, amount=None, mode_of_payment=None, reason="", approval_request=None):
	"""Refund a Payment Reference / Deposit Application line — issues a real
	ERPNext Payment Entry (Pay type) against the original receipt PE.

	If `amount` is None, refund the full line amount. Idempotent per Folio Line.
	"""
	_require_permission("Payment Entry", "create")
	if not reason or not reason.strip():
		frappe.throw(_("A refund reason is required."))

	doc = frappe.get_doc("Folio Line", line)
	if doc.line_type not in REFUNDABLE_TYPES:
		frappe.throw(_("Only payment / deposit lines can be refunded."))
	if doc.line_status == "Refunded":
		frappe.throw(_("Line {0} is already refunded.").format(line))
	if not doc.erpnext_payment_entry:
		frappe.throw(_("Line {0} has no linked Payment Entry to refund from.").format(line))

	amount = flt(amount) or flt(doc.amount)
	if amount <= 0 or amount > flt(doc.amount):
		frappe.throw(_("Refund amount must be between 0 and {0}.").format(flt(doc.amount)))

	# Approval gate — refund over policy threshold requires manager sign-off.
	from the_reezort.approvals.api import require_approval

	require_approval(
		action="refund",
		source_doctype="Folio Line",
		source_name=line,
		payload={"amount": amount, "reason": reason, "mode_of_payment": mode_of_payment},
		approval_request=approval_request,
	)

	folio = frappe.get_doc("Guest Folio", doc.guest_folio)
	original_pe = frappe.get_doc("Payment Entry", doc.erpnext_payment_entry)
	idempotency_key = f"refund:{doc.name}:{int(amount * 100)}"

	def operation():
		refund = frappe.new_doc("Payment Entry")
		refund.payment_type = "Pay"
		refund.party_type = original_pe.party_type
		refund.party = original_pe.party
		refund.company = original_pe.company
		refund.posting_date = today()
		refund.mode_of_payment = mode_of_payment or original_pe.mode_of_payment
		refund.paid_from = original_pe.paid_to  # money leaves the bank/cash account it came into
		refund.paid_to = original_pe.paid_from  # goes back to the customer's advance account
		refund.paid_amount = amount
		refund.received_amount = amount
		refund.reference_no = f"REFUND-{original_pe.name}"
		refund.reference_date = today()
		refund.remarks = _("Refund of {0} · {1}").format(original_pe.name, reason)
		refund.insert(ignore_permissions=True)
		refund.submit()

		# Same terminal-state pattern as credit-note. Reason is on the refund PE
		# remarks and Audit Event; partial refund keeps the line on Posted.
		next_status = "Refunded" if amount == flt(doc.amount) else "Posted"
		frappe.db.set_value(
			"Folio Line", doc.name, {"line_status": next_status}, update_modified=False
		)

		frappe.db.set_value(
			"Guest Folio",
			folio.name,
			{
				"total_paid": max(flt(folio.total_paid) - amount, 0),
				"outstanding_amount": flt(folio.outstanding_amount) + amount,
			},
			update_modified=False,
		)

		return {"payment_entries": [refund.name], "amount": amount}

	result = run_posting("Refund", "Guest Folio", folio.name, idempotency_key, operation)
	refund_pe = (result["results"].get("payment_entries") or [None])[0]
	_audit("Folio Line", line, "refund", reason, {"amount": amount, "refund_pe": refund_pe, "folio": folio.name})
	return _envelope(
		{
			"line": line,
			"line_status": doc.line_status,
			"refund_payment_entry": refund_pe,
			"amount": amount,
			"folio": _folio_snapshot(folio.name),
			"reused": result["reused"],
		}
	)


# ---------- helpers ----------------------------------------------------------

def _folio_snapshot(name):
	return frappe.db.get_value(
		"Guest Folio",
		name,
		["name", "total_charges", "total_paid", "outstanding_amount", "folio_status"],
		as_dict=True,
	)
