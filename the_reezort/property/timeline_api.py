"""Engagement timeline — cross-doctype activity feed for a Room, Building,
Floor, or the whole Property.

Aggregates every hospitality event tied to the target into a single
time-ordered list of TimelineEvents. The frontend renders it with a
framer-motion vertical timeline; each event carries a deep link to the
source doc so a click routes to that record's workspace.

Envelope contract matches the rest of the app (`_envelope`).
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import getdate

from the_reezort.staff.api import _envelope


# ---------- helpers ----------


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _iso(dt) -> str | None:
	return str(dt) if dt else None


def _event(
	kind: str,
	when,
	title: str,
	source_doctype: str,
	source_name: str,
	*,
	subtitle: str | None = None,
	actor: str | None = None,
	amount: float | None = None,
	room: str | None = None,
	status: str | None = None,
) -> dict:
	"""Uniform event shape. `when` may be a date or datetime — the frontend
	sorts by ISO strings, so we always render as ISO."""
	return {
		"kind": kind,  # reservation / stay / folio / payment / housekeeping / condition / move / ticket
		"when": _iso(when),
		"title": title,
		"subtitle": subtitle,
		"source_doctype": source_doctype,
		"source_name": source_name,
		"actor": actor,
		"amount": amount,
		"room": room,
		"status": status,
	}


# ---------- per-doctype fetchers ----------


def _reservations_for_room(room: str) -> list[dict]:
	"""Reservations that had this room in a Reservation Room child row."""
	rows = frappe.db.sql(
		"""
		SELECT r.name, r.status, r.arrival_date, r.departure_date, r.creation,
		       r.resort_property, rr.room
		FROM `tabReservation Room` rr
		JOIN `tabReservation` r ON r.name = rr.parent
		WHERE rr.room = %s
		""",
		(room,),
		as_dict=True,
	)
	events = []
	for r in rows:
		events.append(
			_event(
				"reservation",
				r["arrival_date"] or r["creation"],
				f"Reservation {r['name']}",
				"Reservation",
				r["name"],
				subtitle=f"Arr {r['arrival_date']} → Dep {r['departure_date']}",
				status=r["status"],
				room=r["room"],
			)
		)
	return events


def _stays_for_room(room: str) -> list[dict]:
	rows = frappe.get_all(
		"Stay",
		filters={"current_room": room},
		fields=["name", "stay_status", "arrival_date", "departure_date", "reservation", "creation"],
	)
	out = []
	for s in rows:
		out.append(
			_event(
				"stay",
				s["arrival_date"] or s["creation"],
				f"Stay {s['name']}",
				"Stay",
				s["name"],
				subtitle=f"Arr {s['arrival_date']} → Dep {s['departure_date']}",
				status=s["stay_status"],
				room=room,
			)
		)
	return out


def _folios_for_stays(stay_names: list[str]) -> list[dict]:
	if not stay_names:
		return []
	rows = frappe.get_all(
		"Guest Folio",
		filters={"stay": ["in", stay_names]},
		fields=["name", "folio_status", "stay", "creation"],
	)
	return [
		_event(
			"folio",
			r["creation"],
			f"Folio {r['name']}",
			"Guest Folio",
			r["name"],
			subtitle=f"Stay {r['stay']}",
			status=r["folio_status"],
		)
		for r in rows
	]


def _payments_against_folios(folio_names: list[str]) -> list[dict]:
	"""Payment Entries referencing any of the folios (via Payment Entry
	Reference against the Sales Invoices spawned from the folio, or against
	the folio itself if wired)."""
	if not folio_names:
		return []
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT pe.name, pe.payment_type, pe.posting_date,
		       pe.paid_amount, pe.received_amount, pe.mode_of_payment,
		       pe.docstatus
		FROM `tabPayment Entry` pe
		LEFT JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
		LEFT JOIN `tabSales Invoice` si ON si.name = per.reference_name
		LEFT JOIN `tabFolio Line` fl ON fl.erpnext_sales_invoice = si.name
		WHERE (fl.guest_folio IN %(folios)s
		       OR pe.name IN (SELECT erpnext_payment_entry FROM `tabFolio Line`
		                      WHERE guest_folio IN %(folios)s
		                        AND erpnext_payment_entry IS NOT NULL))
		  AND pe.docstatus != 2
		""",
		{"folios": tuple(folio_names)},
		as_dict=True,
	)
	events = []
	for r in rows:
		amt = float(r["paid_amount"] or r["received_amount"] or 0)
		events.append(
			_event(
				"payment",
				r["posting_date"],
				f"{r['payment_type']} · {r['mode_of_payment'] or 'Unknown mode'}",
				"Payment Entry",
				r["name"],
				subtitle=f"₹{amt:,.0f}",
				amount=amt,
				status="Submitted" if r["docstatus"] == 1 else "Draft",
			)
		)
	return events


def _housekeeping_for_room(room: str) -> list[dict]:
	rows = frappe.get_all(
		"Housekeeping Task",
		filters={"room": room},
		fields=[
			"name", "task_status", "task_type", "priority",
			"assigned_user", "creation", "resort_property", "stay",
		],
		order_by="creation desc",
	)
	return [
		_event(
			"housekeeping",
			r["creation"],
			f"{r['task_type'] or 'Task'} · {r['priority'] or 'Normal'}",
			"Housekeeping Task",
			r["name"],
			actor=r["assigned_user"],
			status=r["task_status"],
			room=room,
		)
		for r in rows
	]


def _condition_captures_for_room(room: str) -> list[dict]:
	# Room Condition Capture (per stay, structured)
	caps = frappe.get_all(
		"Room Condition Capture",
		filters={"room": room},
		fields=["name", "capture_stage", "captured_by", "creation", "stay"],
	)
	events = [
		_event(
			"condition",
			r["creation"],
			f"Condition · {r['capture_stage'] or 'Capture'}",
			"Room Condition Capture",
			r["name"],
			actor=r["captured_by"],
			subtitle=f"Stay {r['stay']}" if r["stay"] else None,
			room=room,
		)
		for r in caps
	]

	# Room Condition Log (ad-hoc, no stay)
	if frappe.db.exists("DocType", "Room Condition Log"):
		logs = frappe.get_all(
			"Room Condition Log",
			filters={"room": room},
			fields=["name", "creation", "changed_by", "condition_type"],
		)
		for r in logs:
			events.append(
				_event(
					"condition",
					r["creation"],
					f"Condition · {r.get('condition_type') or 'Log'}",
					"Room Condition Log",
					r["name"],
					actor=r.get("changed_by"),
					room=room,
				)
			)
	return events


def _room_moves(room: str) -> list[dict]:
	rows = frappe.get_all(
		"Room Move",
		filters=[["from_room", "=", room]],
		or_filters=[["to_room", "=", room]],
		fields=["name", "from_room", "to_room", "reason", "creation", "stay", "moved_by"],
	)
	events = []
	for r in rows:
		direction = "out to " + r["to_room"] if r["from_room"] == room else "in from " + (r["from_room"] or "—")
		events.append(
			_event(
				"move",
				r["creation"],
				f"Room move {direction}",
				"Room Move",
				r["name"],
				subtitle=r["reason"],
				actor=r["moved_by"],
				room=room,
			)
		)
	return events


def _service_tickets_for_room(room: str) -> list[dict]:
	if not frappe.db.exists("DocType", "Service Ticket"):
		return []
	rows = frappe.get_all(
		"Service Ticket",
		filters={"room": room},
		fields=["name", "subject", "status", "priority", "creation", "assigned_to"],
	)
	return [
		_event(
			"ticket",
			r["creation"],
			r["subject"] or "Service ticket",
			"Service Ticket",
			r["name"],
			subtitle=f"Priority {r['priority'] or 'Normal'}",
			actor=r.get("assigned_to"),
			status=r["status"],
			room=room,
		)
		for r in rows
	]


# ---------- public entrypoints ----------


def _sort_events(events: list[dict]) -> list[dict]:
	# Sort newest first. Events without a timestamp go to the bottom.
	return sorted(events, key=lambda e: (e["when"] or ""), reverse=True)


@frappe.whitelist()
def get_room_timeline(room: str, limit: int | None = None) -> dict:
	_require_login()
	if not frappe.db.exists("Room", room):
		frappe.throw(_("Room not found."))

	stays = frappe.get_all("Stay", filters={"current_room": room}, pluck="name")
	folios = (
		frappe.get_all("Guest Folio", filters={"stay": ["in", stays]}, pluck="name") if stays else []
	)

	events: list[dict] = []
	events.extend(_reservations_for_room(room))
	events.extend(_stays_for_room(room))
	events.extend(_folios_for_stays(stays))
	events.extend(_payments_against_folios(folios))
	events.extend(_housekeeping_for_room(room))
	events.extend(_condition_captures_for_room(room))
	events.extend(_room_moves(room))
	events.extend(_service_tickets_for_room(room))

	events = _sort_events(events)
	if limit:
		events = events[: int(limit)]
	return _envelope({"target": {"doctype": "Room", "name": room}, "events": events})


@frappe.whitelist()
def get_property_timeline(resort_property: str, limit: int | None = None) -> dict:
	"""All engagements across the property. Rooms are gathered from every
	tabRoom under the property, and each fetcher runs once per room; we then
	sort + optionally cap."""
	_require_login()
	if not frappe.db.exists("Resort Property", resort_property):
		frappe.throw(_("Property not found."))

	rooms = frappe.get_all("Room", filters={"resort_property": resort_property}, pluck="name")
	events: list[dict] = []
	for r in rooms:
		events.extend(_reservations_for_room(r))
		events.extend(_stays_for_room(r))
		events.extend(_housekeeping_for_room(r))
		events.extend(_condition_captures_for_room(r))
		events.extend(_room_moves(r))
		events.extend(_service_tickets_for_room(r))

	# Property-scoped folios + payments (not room-scoped).
	folios = frappe.get_all(
		"Guest Folio",
		filters={"resort_property": resort_property},
		fields=["name", "folio_status", "stay", "creation"],
	)
	for f in folios:
		events.append(
			_event(
				"folio",
				f["creation"],
				f"Folio {f['name']}",
				"Guest Folio",
				f["name"],
				subtitle=f"Stay {f['stay']}" if f["stay"] else None,
				status=f["folio_status"],
			)
		)
	events.extend(_payments_against_folios([f["name"] for f in folios]))

	events = _sort_events(events)
	if limit:
		events = events[: int(limit)]
	return _envelope(
		{"target": {"doctype": "Resort Property", "name": resort_property}, "events": events}
	)


@frappe.whitelist()
def get_building_timeline(resort_building: str, limit: int | None = None) -> dict:
	_require_login()
	if not frappe.db.exists("Resort Building", resort_building):
		frappe.throw(_("Building not found."))
	rooms = frappe.get_all("Room", filters={"resort_building": resort_building}, pluck="name")
	return _timeline_from_rooms(
		rooms, {"doctype": "Resort Building", "name": resort_building}, limit
	)


@frappe.whitelist()
def get_floor_timeline(resort_floor: str, limit: int | None = None) -> dict:
	_require_login()
	if not frappe.db.exists("Resort Floor", resort_floor):
		frappe.throw(_("Floor not found."))
	rooms = frappe.get_all("Room", filters={"resort_floor": resort_floor}, pluck="name")
	return _timeline_from_rooms(rooms, {"doctype": "Resort Floor", "name": resort_floor}, limit)


def _timeline_from_rooms(rooms: list[str], target: dict, limit: int | None) -> dict:
	events: list[dict] = []
	stays: list[str] = []
	for r in rooms:
		events.extend(_reservations_for_room(r))
		events.extend(_stays_for_room(r))
		events.extend(_housekeeping_for_room(r))
		events.extend(_condition_captures_for_room(r))
		events.extend(_room_moves(r))
		events.extend(_service_tickets_for_room(r))
		stays.extend(frappe.get_all("Stay", filters={"current_room": r}, pluck="name"))
	folios = (
		frappe.get_all("Guest Folio", filters={"stay": ["in", stays]}, pluck="name") if stays else []
	)
	if folios:
		for r in frappe.get_all(
			"Guest Folio", filters={"name": ["in", folios]}, fields=["name", "folio_status", "stay", "creation"]
		):
			events.append(
				_event(
					"folio",
					r["creation"],
					f"Folio {r['name']}",
					"Guest Folio",
					r["name"],
					subtitle=f"Stay {r['stay']}" if r["stay"] else None,
					status=r["folio_status"],
				)
			)
		events.extend(_payments_against_folios(folios))

	events = _sort_events(events)
	if limit:
		events = events[: int(limit)]
	return _envelope({"target": target, "events": events})
