"""Follow-up notifications — cron-driven nudges for stale work.

Registered in hooks.py under scheduler_events:

  hourly  → send_task_followups()
  daily   → send_approval_followups() + send_leave_advance_followups()

All follow-ups are idempotent per (record, day) — dedupe_key on notify_user
ensures we never spam the same person twice for the same doc in the same
day.
"""

from __future__ import annotations

import frappe
from frappe.utils import add_to_date, getdate, now_datetime, today

from the_reezort.staff.notify_api import notify_role, notify_user

HK_OPEN_STATUSES = ("Queued", "Assigned", "In Progress", "Paused")


def _day_key() -> str:
	return str(getdate(today()))


# ---------- housekeeping task follow-ups ----------


def send_task_followups() -> int:
	"""Overdue Housekeeping Tasks — nudge the assignee; escalate to
	Housekeeping Supervisor after 24h overdue."""
	now = now_datetime()
	rows = frappe.get_all(
		"Housekeeping Task",
		filters={
			"task_status": ["in", HK_OPEN_STATUSES],
			"due_at": ["<", now],
		},
		fields=["name", "assigned_user", "task_type", "priority", "room", "due_at"],
	)
	sent = 0
	for r in rows:
		# Assignee reminder — dedupe per day.
		if r["assigned_user"]:
			created = notify_user(
				user=r["assigned_user"],
				subject=f"Overdue: {r['task_type']} · Room {r['room'] or '—'}",
				body=f"Task {r['name']} was due at {r['due_at']}. Priority {r['priority'] or 'Normal'}.",
				source_doctype="Housekeeping Task",
				source_name=r["name"],
				kind="Alert",
				dedupe_key=f"followup:hk:{r['name']}:{_day_key()}",
			)
			if created:
				sent += 1

		# Escalate if > 24h overdue and still open.
		if r["due_at"] and (now - r["due_at"]).total_seconds() > 24 * 3600:
			notify_role(
				role=["Housekeeping Supervisor", "Resort Manager"],
				subject=f"Escalation: {r['task_type']} 24h overdue · Room {r['room'] or '—'}",
				body=f"{r['name']} is still {r.get('task_status') or 'open'}.",
				source_doctype="Housekeeping Task",
				source_name=r["name"],
				kind="Alert",
				dedupe_key=f"escalate:hk:{r['name']}:{_day_key()}",
				exclude_users={r["assigned_user"]} if r["assigned_user"] else None,
			)
	return sent


# ---------- approval request follow-ups ----------


def send_approval_followups() -> int:
	"""Approval Requests still Pending after 24h — nudge every user holding
	the approver_role on that policy."""
	one_day_ago = add_to_date(now_datetime(), hours=-24)
	rows = frappe.db.sql(
		"""
		SELECT ar.name, ar.action, ar.source_doctype, ar.source_name, ar.requester,
		       ap.approver_role, ar.creation
		FROM `tabApproval Request` ar
		LEFT JOIN `tabApproval Policy` ap ON ap.name = ar.policy
		WHERE ar.state = 'Pending' AND ar.creation < %s
		""",
		(one_day_ago,),
		as_dict=True,
	)
	sent = 0
	for r in rows:
		role = r["approver_role"] or "Resort Manager"
		emitted = notify_role(
			role=role,
			subject=f"Approval pending: {r['action']} · {r['source_doctype']} {r['source_name']}",
			body=f"Requested by {r['requester']} on {r['creation']}.",
			source_doctype="Approval Request",
			source_name=r["name"],
			kind="Alert",
			dedupe_key=f"followup:approval:{r['name']}:{_day_key()}",
			exclude_users={r["requester"]},
		)
		sent += len(emitted)
	return sent


# ---------- leave / advance follow-ups ----------


def send_leave_advance_followups() -> int:
	"""Leave Applications + Employee Advances still Open after 24h → nudge
	Resort Manager / HR."""
	one_day_ago = add_to_date(now_datetime(), hours=-24)
	sent = 0

	# Leaves — status Open, docstatus 0
	leaves = frappe.get_all(
		"Leave Application",
		filters={"status": "Open", "docstatus": 0, "creation": ["<", one_day_ago]},
		fields=["name", "employee_name", "leave_type", "from_date", "to_date", "owner"],
	)
	for r in leaves:
		emitted = notify_role(
			role=["Resort Manager", "HR Manager", "HR User"],
			subject=f"Leave pending: {r['employee_name']} · {r['leave_type']}",
			body=f"{r['from_date']} → {r['to_date']}. Awaiting decision.",
			source_doctype="Leave Application",
			source_name=r["name"],
			kind="Alert",
			dedupe_key=f"followup:leave:{r['name']}:{_day_key()}",
			exclude_users={r["owner"]},
		)
		sent += len(emitted)

	# Advances — Draft (docstatus 0)
	advances = frappe.get_all(
		"Employee Advance",
		filters={"docstatus": 0, "status": "Draft", "creation": ["<", one_day_ago]},
		fields=["name", "employee_name", "advance_amount", "purpose", "owner"],
	)
	for r in advances:
		emitted = notify_role(
			role=["Resort Manager", "HR Manager", "Accounts Manager"],
			subject=f"Advance pending: {r['employee_name']} · ₹{r['advance_amount']:.0f}",
			body=f"Purpose: {r['purpose'] or '—'}. Awaiting decision.",
			source_doctype="Employee Advance",
			source_name=r["name"],
			kind="Alert",
			dedupe_key=f"followup:advance:{r['name']}:{_day_key()}",
			exclude_users={r["owner"]},
		)
		sent += len(emitted)

	return sent
