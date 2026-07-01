"""Leave request queue — Self + Manager panes (spec 008, ui-ux-leave-queue).

Thin wrapper over ERPNext HRMS Leave Application:
  · list_my_leaves / list_pending_leaves
  · create_leave_request  → docstatus 0 (Open)
  · cancel_leave_request  → delete if Draft, cancel if Submitted-and-mine
  · decide_leave          → Approved / Rejected → submit → Leave Ledger

Self-approve is blocked at API and UI layers. Approver is the current user;
requester ≠ approver.
"""

import frappe
from frappe import _
from frappe.utils import date_diff, getdate

from the_reezort.staff.api import _envelope, STAFF_ADMIN_ROLES


LEAVE_MANAGER_ROLES = STAFF_ADMIN_ROLES | {"HR Manager", "HR User"}


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


def _is_leave_manager():
	return bool(LEAVE_MANAGER_ROLES & set(frappe.get_roles()))


def _leave_row(name):
	row = frappe.db.get_value(
		"Leave Application",
		name,
		[
			"name", "employee", "employee_name", "leave_type",
			"from_date", "to_date", "total_leave_days",
			"description", "status", "docstatus",
			"owner", "leave_approver",
		],
		as_dict=True,
	)
	if row:
		row["from_date"] = str(row.from_date) if row.from_date else None
		row["to_date"] = str(row.to_date) if row.to_date else None
	return row


def _balance_row(emp, leave_type):
	max_days = frappe.db.get_value("Leave Type", leave_type, "max_leaves_allowed") or 0
	used = (
		frappe.db.sql(
			"""
			SELECT COALESCE(SUM(total_leave_days), 0)
			FROM `tabLeave Application`
			WHERE employee = %s AND leave_type = %s
			  AND docstatus = 1 AND status = 'Approved'
			""",
			(emp, leave_type),
		)[0][0]
		or 0
	)
	return {
		"leave_type": leave_type,
		"max_days": float(max_days),
		"used_days": float(used),
		"remaining_days": max(float(max_days) - float(used), 0.0),
	}


# ---------- Lists ----------


@frappe.whitelist()
def list_my_leaves():
	_require_login()
	emp = _self_employee_or_none()
	if not emp:
		return _envelope({"employee": None, "leaves": [], "balances": [], "is_manager": _is_leave_manager()})

	rows = frappe.get_all(
		"Leave Application",
		filters={"employee": emp},
		fields=[
			"name", "leave_type", "from_date", "to_date", "total_leave_days",
			"description", "status", "docstatus",
		],
		order_by="from_date desc, creation desc",
	)
	for r in rows:
		r["from_date"] = str(r["from_date"]) if r["from_date"] else None
		r["to_date"] = str(r["to_date"]) if r["to_date"] else None

	leave_types = [lt.name for lt in frappe.get_all("Leave Type", fields=["name"])]
	balances = [_balance_row(emp, lt) for lt in leave_types]

	return _envelope(
		{
			"employee": emp,
			"leaves": rows,
			"balances": balances,
			"is_manager": _is_leave_manager(),
		}
	)


@frappe.whitelist()
def list_pending_leaves():
	_require_login()
	if not _is_leave_manager():
		frappe.throw(_("Only a manager can see the leave inbox."), frappe.PermissionError)

	rows = frappe.get_all(
		"Leave Application",
		filters={"status": "Open", "docstatus": 0},
		fields=[
			"name", "employee", "employee_name", "leave_type",
			"from_date", "to_date", "total_leave_days",
			"description", "owner",
		],
		order_by="from_date asc, creation asc",
	)
	for r in rows:
		r["from_date"] = str(r["from_date"]) if r["from_date"] else None
		r["to_date"] = str(r["to_date"]) if r["to_date"] else None
	return _envelope({"leaves": rows})


# ---------- Mutations ----------


@frappe.whitelist()
def create_leave_request(leave_type, from_date, to_date, reason=None):
	_require_login()
	emp = _self_employee()

	from_d = getdate(from_date)
	to_d = getdate(to_date)
	if to_d < from_d:
		frappe.throw(_("`to_date` must be on/after `from_date`."))

	if not frappe.db.exists("Leave Type", leave_type):
		frappe.throw(_("Unknown Leave Type: {0}").format(leave_type))

	days = date_diff(to_d, from_d) + 1

	doc = frappe.get_doc(
		{
			"doctype": "Leave Application",
			"employee": emp,
			"leave_type": leave_type,
			"from_date": str(from_d),
			"to_date": str(to_d),
			"total_leave_days": days,
			"description": reason or "",
			"status": "Open",
		}
	)
	doc.insert(ignore_permissions=True)

	# Nudge every manager who can decide this — the SPA bell picks it up in realtime.
	try:
		from the_reezort.staff.notify_api import notify_role

		notify_role(
			role=["Resort Manager", "HR Manager", "HR User"],
			subject=f"Leave requested: {doc.employee_name or emp} · {leave_type}",
			body=f"{from_d} → {to_d} ({days} day{'s' if days != 1 else ''}). {reason or ''}",
			source_doctype="Leave Application",
			source_name=doc.name,
			kind="Assignment",
			exclude_users={frappe.session.user},
		)
	except Exception:
		pass
	return _envelope({"leave": _leave_row(doc.name)})


@frappe.whitelist()
def cancel_leave_request(name):
	_require_login()
	row = _leave_row(name)
	if not row:
		frappe.throw(_("Leave request not found."))
	if row["owner"] != frappe.session.user:
		frappe.throw(_("You can only cancel your own request."), frappe.PermissionError)
	if row["status"] != "Open" or row["docstatus"] != 0:
		frappe.throw(_("Only Open (unapproved) requests can be cancelled."))
	frappe.delete_doc("Leave Application", name, ignore_permissions=True)
	return _envelope({"leave": name, "cancelled": True})


@frappe.whitelist()
def decide_leave(name, action, notes=None):
	_require_login()
	if not _is_leave_manager():
		frappe.throw(_("Only a manager can decide leave requests."), frappe.PermissionError)
	if action not in ("Approve", "Reject"):
		frappe.throw(_("action must be 'Approve' or 'Reject'."))

	row = _leave_row(name)
	if not row:
		frappe.throw(_("Leave request not found."))
	if row["owner"] == frappe.session.user:
		frappe.throw(_("You cannot decide your own request."), frappe.PermissionError)
	if row["status"] != "Open" or row["docstatus"] != 0:
		frappe.throw(_("Only Open requests can be decided."))

	doc = frappe.get_doc("Leave Application", name)
	doc.status = "Approved" if action == "Approve" else "Rejected"
	doc.leave_approver = frappe.session.user
	if notes:
		doc.description = (doc.description + "\n\n" if doc.description else "") + f"[Manager notes] {notes}"
	doc.save(ignore_permissions=True)
	doc.submit()

	try:
		from the_reezort.audit.api import record_audit_event

		record_audit_event(
			source_doctype="Leave Application",
			source_name=name,
			action=f"leave_{action.lower()}d",
			reason=notes or "",
			details={"employee": row["employee"], "days": row["total_leave_days"]},
		)
	except Exception:
		pass

	# Notify the requester of the decision.
	try:
		from the_reezort.staff.notify_api import notify_user

		notify_user(
			user=row["owner"],
			subject=f"Leave {doc.status.lower()}",
			body=f"{row['leave_type']} · {row['from_date']} → {row['to_date']}" + (f"\nNotes: {notes}" if notes else ""),
			source_doctype="Leave Application",
			source_name=name,
			kind="Alert",
		)
	except Exception:
		pass

	return _envelope({"leave": _leave_row(name)})
