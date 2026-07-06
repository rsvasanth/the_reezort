"""Seed a small maintenance ticket inbox — spec 009 first slice.

Idempotent — every row keys on (resort_property, subject) so a re-run
won't create duplicates. Ships 5 tickets across a mix of states + SLA
priorities so the inbox demo renders every UI branch:

  · 2 Reported  (unassigned, one HVAC High-priority, one Plumbing Normal)
  · 1 In Progress (assigned to a maintenance user, Electrical Urgent)
  · 1 Resolved
  · 1 Closed

All rows attached to real rooms + property auto-resolved from
`Resort Property` — no hardcoded local names.
"""

from __future__ import annotations

import frappe
from the_reezort.permissions import system_manager_only
from frappe.utils import add_to_date, now_datetime

from the_reezort.maintenance.sla_targets import sla_minutes


# (subject, category, priority, description, room_offset, state, assigned_role)
DEMO_TICKETS = [
	(
		"AC not cooling in villa",
		"HVAC",
		"High",
		"Guest reports 25°C set to 18°C; room still ~24°C after 30 minutes. Compressor may be short-cycling.",
		0,
		"Reported",
		None,
	),
	(
		"Bathroom tap dripping",
		"Plumbing",
		"Normal",
		"Slow drip from the cold-water tap in the master bathroom. Guest wants it looked at when convenient.",
		1,
		"Reported",
		None,
	),
	(
		"Reading lamp not working",
		"Electrical",
		"Urgent",
		"Guest can't read at bedside — the whole side-table circuit is dead. Fuse or lamp module.",
		2,
		"In Progress",
		"Maintenance",
	),
	(
		"Balcony sliding door jammed",
		"Structural",
		"Normal",
		"Sliding door catches at the track. Cleaned and greased; sliding smoothly now.",
		3,
		"Resolved",
		"Maintenance",
	),
	(
		"WiFi weak on top floor",
		"IT",
		"Low",
		"Signal drops on the top-floor suites. Added a mesh node; verified full bars.",
		4,
		"Closed",
		"Maintenance",
	),
]


@frappe.whitelist()
@system_manager_only
def seed_maintenance_tickets(resort_property: str | None = None) -> dict:
	"""Idempotent — matches on (resort_property, subject)."""
	resort_property = resort_property or frappe.db.get_value(
		"Resort Property", {"is_active": 1}, "name"
	) or frappe.db.get_value("Resort Property", {}, "name")
	if not resort_property:
		return {"ok": False, "reason": "No Resort Property configured"}

	# Grab up to 5 real Rooms on this property for the tickets to attach to.
	rooms = frappe.get_all(
		"Room",
		filters={"resort_property": resort_property, "is_active": 1},
		pluck="name",
		limit_page_length=5,
	) or [None] * len(DEMO_TICKETS)

	# One maintenance user we can assign the mid-flow tickets to.
	maint_user = frappe.db.sql(
		"SELECT parent FROM `tabHas Role` WHERE role='Maintenance' LIMIT 1"
	)
	maint_user = maint_user[0][0] if maint_user else None

	created: list[str] = []
	existed: list[str] = []
	for subject, category, priority, description, offset, state, assigned_role in DEMO_TICKETS:
		if frappe.db.exists("Maintenance Ticket", {"resort_property": resort_property, "subject": subject}):
			existed.append(subject)
			continue

		room = rooms[offset % len(rooms)] if rooms else None
		reported_at = add_to_date(now_datetime(), hours=-((5 - offset) * 3))
		sla_due = add_to_date(reported_at, minutes=sla_minutes(priority, category))
		payload = {
			"doctype": "Maintenance Ticket",
			"resort_property": resort_property,
			"subject": subject,
			"category": category,
			"priority": priority,
			"description": description,
			"room": room,
			"reported_at": reported_at,
			"sla_due": sla_due,
			"state": "Reported",
			"raised_by": "Administrator",
			"source_doctype": "Room",
			"source_name": room,
		}
		if state in {"In Progress", "Resolved", "Closed"} and assigned_role and maint_user:
			payload["assigned_to"] = maint_user
			payload["assigned_at"] = add_to_date(reported_at, minutes=15)
		if state in {"In Progress", "Resolved", "Closed"}:
			payload["started_at"] = add_to_date(reported_at, minutes=30)
		if state in {"Resolved", "Closed"}:
			payload["resolved_at"] = add_to_date(reported_at, hours=2)
			payload["resolution_notes"] = "Fixed on first visit. Guest confirmed."
		if state == "Closed":
			payload["closed_at"] = add_to_date(reported_at, hours=3)
		payload["state"] = state

		doc = frappe.get_doc(payload)
		doc.flags.ignore_permissions = True
		doc.flags.ignore_mandatory = True
		doc.insert()
		created.append(doc.name)

	frappe.db.commit()
	return {
		"ok": True,
		"resort_property": resort_property,
		"created": created,
		"existed": existed,
		"maintenance_user": maint_user,
	}
