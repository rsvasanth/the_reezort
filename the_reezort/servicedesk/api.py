"""Service Desk — unified guest + maintenance/IT ticketing with SLA + escalation.

One queue for guest requests, complaints, housekeeping, maintenance, and IT.
Each ticket gets an SLA due time from its priority; overdue open tickets are
flagged live in the board and escalated by a scheduled job.
"""

import json

import frappe
from frappe import _
from frappe.utils import add_to_date, now_datetime, time_diff_in_seconds

from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission_generic

# SQL cannot express this ordering here: Frappe's order_by validator splits on
# commas and rejects the FIELD() expression this used to rely on, which threw
# for every caller and meant the board never loaded. Rank in Python instead.
_SD_PRIORITY_RANK = {"Urgent": 0, "High": 1, "Normal": 2, "Low": 3}

# Resolution SLA in minutes by priority.
SLA_MINUTES = {"Low": 1440, "Normal": 480, "High": 120, "Urgent": 30}

STATUSES = ["Open", "In Progress", "On Hold", "Resolved", "Closed", "Cancelled"]
OPEN_STATUSES = {"Open", "In Progress", "On Hold"}
CATEGORIES = ["Guest Request", "Housekeeping", "Maintenance", "IT", "Concierge", "Complaint", "Other"]


def _require_permission(permission_type="read"):
	_require_permission_generic("Service Ticket", permission_type)


def _sla_view(status, sla_due):
	"""Return (minutes_remaining, is_overdue). Negative remaining = past due."""
	if not sla_due:
		return None, False
	secs = time_diff_in_seconds(sla_due, now_datetime())  # due - now
	remaining = int(secs // 60)
	return remaining, (status in OPEN_STATUSES and secs < 0)


def _ticket_data(doc):
	remaining, overdue = _sla_view(doc.status, doc.sla_due)
	return {
		"name": doc.name,
		"resort_property": doc.resort_property,
		"subject": doc.subject,
		"category": doc.category,
		"priority": doc.priority,
		"status": doc.status,
		"description": doc.description,
		"room": doc.room,
		"guest": doc.guest,
		"stay": doc.stay,
		"source": doc.source,
		"assigned_to": doc.assigned_to,
		"opened_at": str(doc.opened_at) if doc.opened_at else None,
		"sla_due": str(doc.sla_due) if doc.sla_due else None,
		"resolved_at": str(doc.resolved_at) if doc.resolved_at else None,
		"escalated": doc.escalated,
		"minutes_remaining": remaining,
		"is_overdue": overdue,
	}


# ---------- reads ----------

@frappe.whitelist()
def get_service_board(resort_property=None, status=None):
	_require_permission("read")
	filters = {}
	if resort_property:
		filters["resort_property"] = resort_property
	if status:
		filters["status"] = status
	rows = frappe.get_all(
		"Service Ticket",
		filters=filters,
		fields=["name"],
		order_by="escalated desc, opened_at asc",
		limit_page_length=0,
	)
	tickets = [_ticket_data(frappe.get_doc("Service Ticket", r.name)) for r in rows]
	tickets.sort(key=lambda t: (
		0 if t.get("escalated") else 1,
		_SD_PRIORITY_RANK.get(t.get("priority"), len(_SD_PRIORITY_RANK)),
	))
	counts = {s: 0 for s in STATUSES}
	overdue = 0
	for t in tickets:
		counts[t["status"]] = counts.get(t["status"], 0) + 1
		if t["is_overdue"]:
			overdue += 1
	return _envelope(
		{
			"tickets": tickets,
			"counts": counts,
			"overdue": overdue,
			"categories": CATEGORIES,
			"statuses": STATUSES,
			"priorities": list(SLA_MINUTES.keys()),
		}
	)


@frappe.whitelist()
def get_ticket(ticket):
	_require_permission("read")
	return _envelope({"ticket": _ticket_data(frappe.get_doc("Service Ticket", ticket))})


# ---------- writes ----------

@frappe.whitelist()
def create_ticket(payload):
	_require_permission("create")
	payload = _as_dict(payload)

	key = payload.get("idempotency_key")
	if not key:
		frappe.throw(_("idempotency_key is required."))
	existing = frappe.db.get_value("Service Ticket", {"idempotency_key": key}, "name")
	if existing:
		return _envelope({"ticket": _ticket_data(frappe.get_doc("Service Ticket", existing)), "reused": True})

	subject = (payload.get("subject") or "").strip()
	if not subject:
		frappe.throw(_("Subject is required."))
	category = payload.get("category") or "Guest Request"
	if category not in CATEGORIES:
		frappe.throw(_("Invalid category."))
	priority = payload.get("priority") or "Normal"
	if priority not in SLA_MINUTES:
		frappe.throw(_("Invalid priority."))
	resort_property = payload.get("resort_property")
	if not resort_property or not frappe.db.exists("Resort Property", resort_property):
		frappe.throw(_("A valid resort property is required."))

	opened = now_datetime()
	sla_due = add_to_date(opened, minutes=SLA_MINUTES[priority])
	doc = frappe.get_doc(
		{
			"doctype": "Service Ticket",
			"resort_property": resort_property,
			"subject": subject,
			"category": category,
			"priority": priority,
			"status": "Open",
			"description": payload.get("description"),
			"raised_by_type": payload.get("raised_by_type") or "Staff",
			"guest": payload.get("guest"),
			"room": payload.get("room"),
			"stay": payload.get("stay"),
			"source": payload.get("source") or "Front Desk",
			"opened_at": opened,
			"sla_due": sla_due,
			"idempotency_key": key,
		}
	)
	doc.insert(ignore_permissions=True)
	return _envelope({"ticket": _ticket_data(doc), "reused": False}, next_actions=["assign_ticket"])


@frappe.whitelist()
def assign_ticket(ticket, assigned_to=None):
	_require_permission("write")
	doc = frappe.get_doc("Service Ticket", ticket)
	doc.assigned_to = assigned_to
	if doc.status == "Open":
		doc.status = "In Progress"
	if not doc.responded_at:
		doc.responded_at = now_datetime()
	doc.save(ignore_permissions=True)
	return _envelope({"ticket": _ticket_data(doc)})


@frappe.whitelist()
def update_status(ticket, status, note=None):
	_require_permission("write")
	if status not in STATUSES:
		frappe.throw(_("Invalid status."))
	doc = frappe.get_doc("Service Ticket", ticket)
	doc.status = status
	if status in ("Resolved", "Closed") and not doc.resolved_at:
		doc.resolved_at = now_datetime()
	doc.save(ignore_permissions=True)
	return _envelope({"ticket": _ticket_data(doc)})


# ---------- scheduled escalation ----------

def escalate_overdue_tickets():
	"""Flag open tickets past their SLA as escalated. Wired to the hourly scheduler."""
	now = now_datetime()
	overdue = frappe.get_all(
		"Service Ticket",
		filters={"status": ["in", list(OPEN_STATUSES)], "escalated": 0, "sla_due": ["<", now]},
		fields=["name"],
	)
	for row in overdue:
		frappe.db.set_value(
			"Service Ticket", row.name, {"escalated": 1, "escalated_at": now}, update_modified=False
		)
	# No explicit commit: the scheduler (and any request invocation) commits on success.
	return len(overdue)
