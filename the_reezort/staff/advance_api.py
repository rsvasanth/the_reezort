"""Employee Advance queue — Self + Manager panes (spec 008, ui-ux-advance-queue).

Wraps ERPNext HR `Employee Advance`:

  · list_my_advances       — self pane + outstanding strip
  · list_pending_advances  — manager inbox (docstatus 0 waiting decision)
  · create_advance_request — insert Draft (docstatus 0)
  · cancel_advance_request — delete if Draft-and-mine
  · decide_advance         — submit (Approve) or delete (Reject)
  · mark_advance_paid      — post a Payment Entry (Pay) against it

Self-approve is blocked. Advances above the cap (default ₹50,000) are refused.
"""

import frappe
from frappe import _
from frappe.utils import flt, today

from the_reezort.staff.api import _envelope, STAFF_ADMIN_ROLES

ADVANCE_MANAGER_ROLES = STAFF_ADMIN_ROLES | {"HR Manager", "HR User", "Accounts Manager", "Accounts User"}
DEFAULT_CAP = 50000.0


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _self_employee_or_none():
	return frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")


def _self_employee():
	emp = _self_employee_or_none()
	if not emp:
		frappe.throw(_("Your login is not linked to an Employee."))
	return emp


def _is_manager():
	return bool(ADVANCE_MANAGER_ROLES & set(frappe.get_roles()))


def _advance_row(name):
	row = frappe.db.get_value(
		"Employee Advance",
		name,
		[
			"name", "employee", "employee_name", "posting_date",
			"advance_amount", "paid_amount", "claimed_amount", "return_amount",
			"purpose", "status", "docstatus", "owner", "company",
		],
		as_dict=True,
	)
	if row:
		row["posting_date"] = str(row.posting_date) if row.posting_date else None
	return row


def _outstanding(emp):
	rows = frappe.get_all(
		"Employee Advance",
		filters={"employee": emp, "docstatus": 1},
		fields=["advance_amount", "paid_amount", "claimed_amount", "return_amount"],
	)
	total = sum(
		flt(r["paid_amount"] or 0) - flt(r["claimed_amount"] or 0) - flt(r["return_amount"] or 0)
		for r in rows
	)
	return max(total, 0.0)


# ---------- Lists ----------


@frappe.whitelist()
def list_my_advances():
	_require_login()
	emp = _self_employee_or_none()
	if not emp:
		return _envelope(
			{"employee": None, "advances": [], "outstanding": 0.0, "cap": DEFAULT_CAP, "is_manager": _is_manager()}
		)

	rows = frappe.get_all(
		"Employee Advance",
		filters={"employee": emp},
		fields=[
			"name", "posting_date", "advance_amount", "paid_amount",
			"purpose", "status", "docstatus",
		],
		order_by="posting_date desc, creation desc",
	)
	for r in rows:
		r["posting_date"] = str(r["posting_date"]) if r["posting_date"] else None

	return _envelope(
		{
			"employee": emp,
			"advances": rows,
			"outstanding": _outstanding(emp),
			"cap": DEFAULT_CAP,
			"is_manager": _is_manager(),
		}
	)


@frappe.whitelist()
def list_pending_advances():
	_require_login()
	if not _is_manager():
		frappe.throw(_("Only a manager can see the advance inbox."), frappe.PermissionError)

	rows = frappe.get_all(
		"Employee Advance",
		filters={"docstatus": 0, "status": "Draft"},
		fields=[
			"name", "employee", "employee_name", "posting_date",
			"advance_amount", "purpose", "owner",
		],
		order_by="posting_date asc, creation asc",
	)
	for r in rows:
		r["posting_date"] = str(r["posting_date"]) if r["posting_date"] else None
	return _envelope({"advances": rows})


# ---------- Mutations ----------


@frappe.whitelist()
def create_advance_request(amount, purpose, posting_date=None):
	_require_login()
	emp = _self_employee()

	amt = flt(amount)
	if amt <= 0:
		frappe.throw(_("Amount must be greater than zero."))
	if amt > DEFAULT_CAP:
		frappe.throw(_("Advance capped at ₹{0}.").format(int(DEFAULT_CAP)))

	if not (purpose or "").strip():
		frappe.throw(_("Purpose is required."))

	company = frappe.db.get_value("Employee", emp, "company") or frappe.defaults.get_global_default("company")
	currency = frappe.db.get_value("Company", company, "default_currency") or "INR"

	doc = frappe.get_doc(
		{
			"doctype": "Employee Advance",
			"employee": emp,
			"posting_date": str(posting_date or today()),
			"company": company,
			"currency": currency,
			"exchange_rate": 1,
			"purpose": purpose,
			"advance_amount": amt,
		}
	)
	doc.insert(ignore_permissions=True)

	try:
		from the_reezort.staff.notify_api import notify_role

		notify_role(
			role=["Resort Manager", "HR Manager", "Accounts Manager"],
			subject=f"Advance requested: {frappe.db.get_value('Employee', emp, 'employee_name') or emp} · ₹{amt:,.0f}",
			body=f"Purpose: {purpose}",
			source_doctype="Employee Advance",
			source_name=doc.name,
			kind="Assignment",
			exclude_users={frappe.session.user},
		)
	except Exception:
		pass
	return _envelope({"advance": _advance_row(doc.name)})


@frappe.whitelist()
def cancel_advance_request(name):
	_require_login()
	row = _advance_row(name)
	if not row:
		frappe.throw(_("Advance request not found."))
	if row["owner"] != frappe.session.user:
		frappe.throw(_("You can only cancel your own request."), frappe.PermissionError)
	if row["docstatus"] != 0:
		frappe.throw(_("Only Draft (unapproved) requests can be cancelled."))
	frappe.delete_doc("Employee Advance", name, ignore_permissions=True)
	return _envelope({"advance": name, "cancelled": True})


@frappe.whitelist()
def decide_advance(name, action, notes=None):
	_require_login()
	if not _is_manager():
		frappe.throw(_("Only a manager can decide advance requests."), frappe.PermissionError)
	if action not in ("Approve", "Reject"):
		frappe.throw(_("action must be 'Approve' or 'Reject'."))

	row = _advance_row(name)
	if not row:
		frappe.throw(_("Advance request not found."))
	# Block self-approval on BOTH axes: the user who created the request, and the
	# employee the advance is FOR. The owner check alone is bypassable when the
	# request was created on the employee's behalf by someone else.
	if row["owner"] == frappe.session.user:
		frappe.throw(_("You cannot decide your own request."), frappe.PermissionError)
	if row.get("employee") and row["employee"] == _self_employee_or_none():
		frappe.throw(_("You cannot decide an advance for your own employee record."), frappe.PermissionError)
	if row["docstatus"] != 0:
		frappe.throw(_("Only Draft requests can be decided."))

	doc = frappe.get_doc("Employee Advance", name)

	if action == "Reject":
		# Reject = drop the request. Log via audit before delete.
		try:
			from the_reezort.audit.api import record_audit_event

			record_audit_event(
				source_doctype="Employee Advance",
				source_name=name,
				action="advance_rejected",
				reason=notes or "",
				details={"employee": row["employee"], "amount": float(row["advance_amount"] or 0)},
			)
		except Exception:
			pass
		# Notify requester of rejection before deleting.
		try:
			from the_reezort.staff.notify_api import notify_user

			notify_user(
				user=row["owner"],
				subject=f"Advance rejected · ₹{row['advance_amount']:,.0f}",
				body=(notes or "No notes provided."),
				source_doctype="Employee Advance",
				source_name=name,
				kind="Alert",
			)
		except Exception:
			pass
		frappe.delete_doc("Employee Advance", name, ignore_permissions=True)
		return _envelope({"advance": name, "action": "Rejected"})

	# Approve → submit; status will be "Unpaid" until a Payment Entry is booked.
	doc.flags.ignore_permissions = True
	doc.submit()

	try:
		from the_reezort.audit.api import record_audit_event

		record_audit_event(
			source_doctype="Employee Advance",
			source_name=name,
			action="advance_approved",
			reason=notes or "",
			details={"employee": row["employee"], "amount": float(row["advance_amount"] or 0)},
		)
	except Exception:
		pass

	try:
		from the_reezort.staff.notify_api import notify_user

		notify_user(
			user=row["owner"],
			subject=f"Advance approved · ₹{row['advance_amount']:,.0f}",
			body="Accounts will disburse via Payment Entry.",
			source_doctype="Employee Advance",
			source_name=name,
			kind="Alert",
		)
	except Exception:
		pass

	return _envelope({"advance": _advance_row(name), "action": "Approved"})


@frappe.whitelist()
def mark_advance_paid(name, mode_of_payment, reference_no=None, reference_date=None):
	"""Book a Payment Entry (type=Pay) against the approved advance."""
	_require_login()
	if not _is_manager():
		frappe.throw(_("Only a manager can mark advances paid."), frappe.PermissionError)

	row = _advance_row(name)
	if not row:
		frappe.throw(_("Advance not found."))
	if row["docstatus"] != 1:
		frappe.throw(_("Advance must be approved (submitted) before payment."))
	if row["status"] not in ("Unpaid",):
		frappe.throw(_("Advance is already {0}.").format(row["status"]))

	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	pe = get_payment_entry("Employee Advance", name)
	pe.mode_of_payment = mode_of_payment
	if reference_no:
		pe.reference_no = reference_no
		pe.reference_date = str(reference_date or today())
	pe.insert(ignore_permissions=True)
	pe.submit()

	try:
		from the_reezort.audit.api import record_audit_event

		record_audit_event(
			source_doctype="Employee Advance",
			source_name=name,
			action="advance_paid",
			reason=f"Payment Entry {pe.name}",
			details={"payment_entry": pe.name, "amount": float(row["advance_amount"] or 0)},
		)
	except Exception:
		pass

	return _envelope({"advance": _advance_row(name), "payment_entry": pe.name})
