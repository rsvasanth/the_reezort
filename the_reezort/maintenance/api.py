"""Maintenance ticketing — spec 009 first slice.

Endpoints:
  · list_tickets(filters)                     — inbox grid (role-aware default filter)
  · create_ticket(payload)                    — Report Issue sheet submission
  · assign_ticket(name, user)                 — assign (or reassign) to a Maintenance user
  · transition_ticket(name, next_state, notes)— state machine step
  · list_recent_for_room(room, limit)         — deep-link helper for Room Workspace / Front Desk
  · get_ticket(name)                          — full detail

State machine:
  Reported → Assigned → In Progress → Resolved → Closed
     └───────────────────────────────────────────→ Duplicate (from Reported only)
     └─────── Any of {Reported, Assigned, In Progress} → cancellable by manager?

Notifications:
  · create   → notify_role("Maintenance")
  · assign   → notify_user(assigned_to)
  · resolve  → notify_user(raised_by)

Approval gates (hooks wired, policy deferred):
  · maintenance_writeoff — resolve where notes indicate labour_cost > threshold

Audit: every write path calls record_audit_event on Maintenance Ticket + name.

Dedupe rule for create_ticket:
  Same (resort_property, room, category) with a non-terminal state opened in the
  last 2 hours → the response includes a `similar_open` warning with the existing
  ticket name so the UI can offer "Link or create new?" instead of a silent duplicate.
  The client can force-create by passing `allow_duplicate=True` in the payload.
"""

from __future__ import annotations

import hashlib
import json

import frappe
from frappe import _
from frappe.utils import add_to_date, flt, get_datetime, now_datetime

from the_reezort.maintenance.sla_targets import sla_minutes
from the_reezort.staff.api import _envelope
from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import require_permission as _require_permission_generic

# State machine — forward transitions only.
# Reported→Duplicate is a lateral escape when the reporter learns the issue
# is already being tracked. Once Resolved, only the reporter (or a manager)
# closes; Closed is terminal.
STATE_TRANSITIONS: dict[str, set[str]] = {
	"Reported": {"Assigned", "In Progress", "Duplicate"},
	"Assigned": {"In Progress", "On Hold", "Resolved"},
	"In Progress": {"Resolved", "On Hold", "Waiting for Parts"},
	"Waiting for Parts": {"In Progress", "On Hold"},
	"On Hold": {"In Progress"},
	"Resolved": {"Closed", "Verification Required"},
	"Verification Required": {"Released"},
	"Released": {"Closed"},
	"Closed": set(),
	"Duplicate": set(),
}

OPEN_STATES = {"Reported", "Assigned", "In Progress", "Waiting for Parts", "On Hold", "Verification Required"}
TERMINAL_STATES = {"Released", "Closed", "Duplicate"}

CATEGORIES = ["HVAC", "Plumbing", "Electrical", "Structural", "IT", "Housekeeping Equipment", "Landscape", "Other"]
# Must stay in sync with maintenance_ticket.json's priority Select options —
# the doctype was extended with the impact-based priorities but this validation
# constant was not, so tickets with them 400'd (parity guard only checks the TS
# union vs the doctype, not this Python constant).
PRIORITIES = ["Low", "Normal", "High", "Urgent", "Guest Impacting", "Safety Critical", "Revenue Blocking"]

DEDUPE_WINDOW_HOURS = 2


# ---------- helpers ----------


def _require_permission(perm: str = "read"):
	_require_permission_generic("Maintenance Ticket", perm)


def _idempotency_key(resort_property: str, room: str | None, subject: str, raised_by: str) -> str:
	digest = hashlib.md5()
	digest.update(resort_property.encode())
	digest.update(str(room or "").encode())
	digest.update(subject.strip().lower().encode())
	digest.update(raised_by.encode())
	# Bucket to 60s so a double-tap inside a minute dedupes but tomorrow's
	# same-subject report does not.
	digest.update(now_datetime().strftime("%Y%m%d%H%M").encode())
	return f"mnt:{digest.hexdigest()[:16]}"


def _record_audit(action: str, ticket_name: str, payload: dict | None = None) -> None:
	try:
		from the_reezort.compliance.audit import record_audit_event

		record_audit_event(
			source_doctype="Maintenance Ticket",
			source_name=ticket_name,
			action=action,
			payload=payload or {},
		)
	except Exception:
		# Audit is best-effort. A logging failure must never block the actor.
		pass


def _sla_view(state: str, sla_due) -> tuple[int | None, bool]:
	if not sla_due:
		return None, False
	from frappe.utils import time_diff_in_seconds

	secs = time_diff_in_seconds(sla_due, now_datetime())
	remaining = int(secs // 60)
	return remaining, (state in OPEN_STATES and secs < 0)


def _ticket_dict(doc) -> dict:
	remaining, overdue = _sla_view(doc.state, doc.sla_due)
	return {
		"name": doc.name,
		"resort_property": doc.resort_property,
		"subject": doc.subject,
		"description": doc.description,
		"state": doc.state,
		"category": doc.category,
		"priority": doc.priority,
		"severity": doc.get("severity"),
		"location_type": doc.get("location_type"),
		"room": doc.room,
		"building": doc.get("building"),
		"floor": doc.get("floor"),
		"area": doc.get("area"),
		"stay": doc.stay,
		"guest": doc.guest,
		"raised_by": doc.raised_by,
		"assigned_to": doc.assigned_to,
		"assigned_employee": doc.get("assigned_employee"),
		"source_doctype": doc.source_doctype,
		"source_name": doc.source_name,
		"erpnext_asset": doc.get("erpnext_asset"),
		"guest_impact": bool(doc.get("guest_impact")),
		"safety_impact": bool(doc.get("safety_impact")),
		"revenue_blocking": bool(doc.get("revenue_blocking")),
		"downtime": doc.get("downtime"),
		"reported_at": str(doc.reported_at) if doc.reported_at else None,
		"sla_due": str(doc.sla_due) if doc.sla_due else None,
		"assigned_at": str(doc.assigned_at) if doc.assigned_at else None,
		"started_at": str(doc.started_at) if doc.started_at else None,
		"expected_completion_at": str(doc.get("expected_completion_at")) if doc.get("expected_completion_at") else None,
		"completed_at": str(doc.get("completed_at")) if doc.get("completed_at") else None,
		"resolved_at": str(doc.resolved_at) if doc.resolved_at else None,
		"released_at": str(doc.get("released_at")) if doc.get("released_at") else None,
		"closed_at": str(doc.closed_at) if doc.closed_at else None,
		"resolution_notes": doc.resolution_notes,
		"technical_notes": doc.get("technical_notes"),
		"guest_safe_note": doc.get("guest_safe_note"),
		"escalated": bool(doc.escalated),
		"duplicate_of": doc.duplicate_of,
		"minutes_remaining": remaining,
		"is_overdue": overdue,
		"photos": [
			{"image": p.image, "caption": p.caption}
			for p in (doc.photos or [])
		],
	}


def _find_similar_open(resort_property: str, room: str | None, category: str) -> str | None:
	"""Same room + category with an open state in the DEDUPE_WINDOW."""
	if not room:
		return None
	since = add_to_date(now_datetime(), hours=-DEDUPE_WINDOW_HOURS)
	return frappe.db.get_value(
		"Maintenance Ticket",
		{
			"resort_property": resort_property,
			"room": room,
			"category": category,
			"state": ["in", list(OPEN_STATES)],
			"reported_at": [">=", since],
		},
		"name",
		order_by="reported_at desc",
	)


# ---------- reads ----------


@frappe.whitelist()
def list_tickets(
	resort_property: str | None = None,
	state: str | list[str] | None = None,
	priority: str | None = None,
	room: str | None = None,
	assigned_to: str | None = None,
	search: str | None = None,
	limit: int = 100,
) -> dict:
	"""Inbox listing. Role-aware defaults:
	  · Maintenance         → default filter = mine + unassigned + Open states
	  · Resort Manager / SM → no default filter (see everything)
	  · Others              → only tickets on rooms/stays they have context on
	  (server-side permission on the doctype already narrows down for others).
	"""
	_require_permission("read")
	filters: dict = {}
	if resort_property:
		filters["resort_property"] = resort_property
	if state:
		if isinstance(state, str):
			state = json.loads(state) if state.startswith("[") else [state]
		filters["state"] = ["in", state]
	if priority:
		filters["priority"] = priority
	if room:
		filters["room"] = room
	if assigned_to:
		filters["assigned_to"] = assigned_to

	rows = frappe.get_all(
		"Maintenance Ticket",
		filters=filters,
		fields=["name"],
		order_by="escalated desc, field(priority,'Urgent','High','Normal','Low'), reported_at asc",
		limit_page_length=limit,
	)
	tickets = [_ticket_dict(frappe.get_doc("Maintenance Ticket", r.name)) for r in rows]
	if search:
		needle = search.strip().lower()
		tickets = [
			t for t in tickets
			if needle in (t["subject"] or "").lower()
			or needle in (t["description"] or "").lower()
			or needle in (t["name"] or "").lower()
		]

	# Counts + overdue summary for KPI strip.
	overdue = sum(1 for t in tickets if t["is_overdue"])
	counts = {
		"Reported": 0,
		"Assigned": 0,
		"In Progress": 0,
		"Waiting for Parts": 0,
		"On Hold": 0,
		"Resolved": 0,
		"Verification Required": 0,
		"Released": 0,
		"Closed": 0,
		"Duplicate": 0,
	}
	for t in tickets:
		counts[t["state"]] = counts.get(t["state"], 0) + 1

	return _envelope(
		{
			"tickets": tickets,
			"counts": counts,
			"overdue": overdue,
			"categories": CATEGORIES,
			"priorities": PRIORITIES,
		}
	)


@frappe.whitelist()
def get_ticket(name: str) -> dict:
	_require_permission("read")
	if not frappe.db.exists("Maintenance Ticket", name):
		frappe.throw(_("Unknown ticket: {0}").format(name))
	return _envelope({"ticket": _ticket_dict(frappe.get_doc("Maintenance Ticket", name))})


@frappe.whitelist()
def list_recent_for_room(room: str, limit: int = 5) -> dict:
	"""Deep-link helper for the Room Workspace: last N tickets on this room,
	newest first. Handy on the room detail page + inside Report Issue for
	the 'similar open' banner."""
	_require_permission("read")
	if not frappe.db.exists("Room", room):
		frappe.throw(_("Unknown room: {0}").format(room))
	rows = frappe.get_all(
		"Maintenance Ticket",
		filters={"room": room},
		fields=["name"],
		order_by="reported_at desc",
		limit_page_length=int(limit),
	)
	return _envelope(
		{"room": room, "tickets": [_ticket_dict(frappe.get_doc("Maintenance Ticket", r.name)) for r in rows]}
	)


# ---------- writes ----------


@frappe.whitelist()
def create_ticket(payload: dict | str) -> dict:
	"""Create a Maintenance Ticket from the Report Issue sheet.

	Idempotent within a per-minute bucket keyed on (property, room, subject,
	raised_by) — double-taps don't create two rows. Reports a `similar_open`
	warning if the same room+category has an open ticket in the last 2h
	unless the caller passes `allow_duplicate=True`.
	"""
	_require_permission("create")
	payload = _as_dict(payload)

	subject = (payload.get("subject") or "").strip()
	if not subject:
		frappe.throw(_("Subject is required."))
	resort_property = payload.get("resort_property")
	if not resort_property or not frappe.db.exists("Resort Property", resort_property):
		frappe.throw(_("A valid resort_property is required."))
	category = payload.get("category") or "HVAC"
	if category not in CATEGORIES:
		frappe.throw(_("Invalid category: {0}").format(category))
	priority = payload.get("priority") or "Normal"
	if priority not in PRIORITIES:
		frappe.throw(_("Invalid priority: {0}").format(priority))

	# Idempotency.
	key = payload.get("idempotency_key") or _idempotency_key(
		resort_property, payload.get("room"), subject, frappe.session.user
	)
	existing_name = frappe.db.get_value("Maintenance Ticket", {"idempotency_key": key}, "name")
	if existing_name:
		return _envelope(
			{"ticket": _ticket_dict(frappe.get_doc("Maintenance Ticket", existing_name)), "reused": True}
		)

	# Similar-open check (warn, don't block, unless client waives).
	warnings: list[dict] = []
	similar = None
	if not payload.get("allow_duplicate"):
		similar = _find_similar_open(resort_property, payload.get("room"), category)
		if similar:
			warnings.append(
				{
					"code": "similar_open",
					"message": _("Similar open ticket exists on this room."),
					"detail": {"existing": similar},
				}
			)

	# SLA due.
	reported_at = now_datetime()
	sla_due = add_to_date(reported_at, minutes=sla_minutes(priority, category))

	doc = frappe.get_doc(
		{
			"doctype": "Maintenance Ticket",
			"resort_property": resort_property,
			"subject": subject,
			"description": payload.get("description"),
			"category": category,
			"priority": priority,
			"state": "Reported",
			"room": payload.get("room"),
			"stay": payload.get("stay"),
			"guest": payload.get("guest"),
			"raised_by": frappe.session.user,
			"source_doctype": payload.get("source_doctype"),
			"source_name": payload.get("source_name"),
			"reported_at": reported_at,
			"sla_due": sla_due,
			"idempotency_key": key,
			"photos": [
				{"image": p.get("image"), "caption": p.get("caption")}
				for p in (payload.get("photos") or [])
			],
		}
	)
	doc.insert(ignore_permissions=True)

	_record_audit("create", doc.name, {"priority": priority, "category": category, "similar_open": similar})

	# Fan out to Maintenance role.
	try:
		from the_reezort.staff.notify_api import notify_role

		notify_role(
			role="Maintenance",
			subject=_("Ticket · {0} · {1}").format(doc.priority, doc.subject),
			body=_("Room {0} — {1}").format(doc.room or "n/a", doc.category),
			link=f"#/maintenance?ticket={doc.name}",
			dedupe_key=f"mnt-create:{doc.name}",
		)
	except Exception:
		pass

	return _envelope(
		{"ticket": _ticket_dict(doc), "reused": False},
		warnings=warnings,
		next_actions=["assign_ticket"] if not doc.assigned_to else [],
	)


@frappe.whitelist()
def assign_ticket(name: str, user: str) -> dict:
	"""Assign or reassign. Transitions Reported → Assigned automatically."""
	_require_permission("write")
	if not frappe.db.exists("Maintenance Ticket", name):
		frappe.throw(_("Unknown ticket: {0}").format(name))
	if user and not frappe.db.exists("User", user):
		frappe.throw(_("Unknown user: {0}").format(user))

	doc = frappe.get_doc("Maintenance Ticket", name)
	if doc.state in TERMINAL_STATES:
		frappe.throw(_("Cannot assign a {0} ticket.").format(doc.state))

	previous = doc.assigned_to
	doc.assigned_to = user or None
	doc.assigned_at = now_datetime() if user else None
	if user and doc.state == "Reported":
		doc.state = "Assigned"
	doc.save(ignore_permissions=True)

	_record_audit("assign", doc.name, {"from": previous, "to": user})

	# Notify the new assignee.
	if user and user != previous:
		try:
			from the_reezort.staff.notify_api import notify_user

			notify_user(
				user=user,
				subject=_("Assigned · {0}").format(doc.subject),
				body=_("Priority {0} · Room {1}").format(doc.priority, doc.room or "n/a"),
				link=f"#/maintenance?ticket={doc.name}",
				dedupe_key=f"mnt-assign:{doc.name}:{user}",
			)
		except Exception:
			pass

	return _envelope({"ticket": _ticket_dict(doc)})


@frappe.whitelist()
def transition_ticket(name: str, next_state: str, notes: str | None = None) -> dict:
	"""State machine step. Notes attach to resolution_notes when resolving/closing."""
	_require_permission("write")
	if not frappe.db.exists("Maintenance Ticket", name):
		frappe.throw(_("Unknown ticket: {0}").format(name))

	doc = frappe.get_doc("Maintenance Ticket", name)
	allowed = STATE_TRANSITIONS.get(doc.state, set())
	if next_state not in allowed:
		frappe.throw(
			_("Cannot transition Maintenance Ticket {0} from {1} to {2}.").format(
				doc.name, doc.state, next_state
			)
		)

	now = now_datetime()
	previous_state = doc.state
	doc.state = next_state

	# Timestamp per state.
	if next_state == "In Progress" and not doc.started_at:
		doc.started_at = now
		# If jumping straight to In Progress without an assignee, self-assign
		# the actor — they are the one working it.
		if not doc.assigned_to:
			doc.assigned_to = frappe.session.user
			doc.assigned_at = now
	elif next_state == "Resolved":
		doc.resolved_at = now
		doc.completed_at = doc.get("completed_at") or now
		if notes:
			doc.resolution_notes = (doc.resolution_notes or "") + (
				"\n" if doc.resolution_notes else ""
			) + notes
	elif next_state == "Verification Required":
		pass  # Downtime API sets released_at when verification passes.
	elif next_state == "Released":
		doc.released_at = now
	elif next_state == "Closed":
		doc.closed_at = now
	elif next_state == "Duplicate":
		# Client can supply the master ticket via notes = "duplicate_of:<name>"
		if notes and notes.startswith("duplicate_of:"):
			doc.duplicate_of = notes.split(":", 1)[1].strip()

	doc.save(ignore_permissions=True)

	_record_audit(
		f"transition:{previous_state}->{next_state}",
		doc.name,
		{"from": previous_state, "to": next_state, "notes": notes},
	)

	# On resolve, notify the reporter.
	if next_state == "Resolved" and doc.raised_by and doc.raised_by != frappe.session.user:
		try:
			from the_reezort.staff.notify_api import notify_user

			notify_user(
				user=doc.raised_by,
				subject=_("Resolved · {0}").format(doc.subject),
				body=doc.resolution_notes or _("Marked resolved by {0}").format(frappe.session.user),
				link=f"#/maintenance?ticket={doc.name}",
				dedupe_key=f"mnt-resolved:{doc.name}",
			)
		except Exception:
			pass

	return _envelope({"ticket": _ticket_dict(doc)})


@frappe.whitelist()
def add_ticket_note(ticket: str, note: str, visibility: str = "Internal") -> dict:
	"""Append a timestamped note to technical_notes without changing the ticket state.

	visibility: "Internal" (default) — appended to technical_notes.
	            "Guest Safe"         — appended to guest_safe_note instead.
	"""
	_require_permission("write")
	if not frappe.db.exists("Maintenance Ticket", ticket):
		frappe.throw(_("Unknown ticket: {0}").format(ticket))
	note = (note or "").strip()
	if not note:
		frappe.throw(_("Note cannot be empty."))

	doc = frappe.get_doc("Maintenance Ticket", ticket)
	now = now_datetime()
	stamp = f"[{now.strftime('%Y-%m-%d %H:%M')} {frappe.session.user}] "
	entry = stamp + note

	if visibility == "Guest Safe":
		existing = (doc.get("guest_safe_note") or "").strip()
		doc.guest_safe_note = (existing + "\n" + entry).strip()
	else:
		existing = (doc.get("technical_notes") or "").strip()
		doc.technical_notes = (existing + "\n" + entry).strip()

	doc.save(ignore_permissions=True)
	_record_audit("note", doc.name, {"visibility": visibility, "length": len(note)})
	return _envelope({"ticket": _ticket_dict(doc)})


# ---------- scheduler (hourly) ----------


def escalate_overdue_tickets() -> int:
	"""Mark still-open tickets past their sla_due as escalated. Wired to the
	hourly scheduler via hooks.py. Returns the count of newly-flagged rows."""
	now = now_datetime()
	rows = frappe.get_all(
		"Maintenance Ticket",
		filters={
			"state": ["in", list(OPEN_STATES)],
			"escalated": 0,
			"sla_due": ["<", now],
		},
		fields=["name", "assigned_to", "subject", "priority", "room"],
	)
	for row in rows:
		frappe.db.set_value(
			"Maintenance Ticket",
			row.name,
			{"escalated": 1, "escalated_at": now},
			update_modified=False,
		)
		# Ping the assignee (or the whole role if unassigned).
		try:
			from the_reezort.staff.notify_api import notify_role, notify_user

			if row.assigned_to:
				notify_user(
					user=row.assigned_to,
					subject=_("Overdue · {0}").format(row.subject),
					body=_("SLA breached · priority {0} · room {1}").format(row.priority, row.room or "n/a"),
					link=f"#/maintenance?ticket={row.name}",
					dedupe_key=f"mnt-overdue:{row.name}",
				)
			else:
				notify_role(
					role="Maintenance",
					subject=_("Overdue unassigned · {0}").format(row.subject),
					body=_("SLA breached · priority {0}").format(row.priority),
					link=f"#/maintenance?ticket={row.name}",
					dedupe_key=f"mnt-overdue:{row.name}",
				)
		except Exception:
			pass
	return len(rows)
