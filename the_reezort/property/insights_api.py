"""Room / Property insights — business-useful signals for the workspace.

Fills the "useless form" gap on the Room Overview tab. Emits:
  · hero image + gallery (Room.image, Room Type.image, Condition-Capture photos)
  · current guest + stay window if in-house
  · upcoming reservations (next 3)
  · KPIs: revenue last 30d, occupancy% last 30d, open task count,
    last cleaning, days-since-last-stay, equipment condition counts

Everything is read-only; the front-end paints it as a dashboard.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, flt, get_datetime, getdate, today

from the_reezort.staff.api import _envelope


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


# ---------- gallery ----------


def _room_gallery(room: str, room_type: str | None) -> list[dict]:
	"""Return a de-duped, ordered gallery for the room.

	Order:
	  1. Room.image (hero, if set)
	  2. Every image File attached to the Room (marketing seed lands here)
	  3. Newest Room Condition Photos (via Room Condition Capture)
	  4. Room Type.image (marketing fallback)
	"""
	seen: set[str] = set()
	gallery: list[dict] = []

	def push(image: str | None, caption: str, source: str, source_name: str):
		if not image or image in seen:
			return
		seen.add(image)
		gallery.append({"image": image, "caption": caption, "source": source, "source_name": source_name})

	room_image = frappe.db.get_value("Room", room, "image")
	push(room_image, "Signature Arch Villa", "Room", room)

	# Files attached to the Room (marketing renders + any other image uploads).
	attached = frappe.get_all(
		"File",
		filters={
			"attached_to_doctype": "Room",
			"attached_to_name": room,
			"file_url": ["like", "%"],
		},
		fields=["name", "file_url", "file_name"],
		order_by="creation asc",
	)
	for f in attached:
		url = f.get("file_url") or ""
		if not url:
			continue
		if not any(url.lower().endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif")):
			continue
		caption = (f.get("file_name") or "").rsplit(".", 1)[0].replace("_", " ").replace("-", " ").title() or "Villa"
		push(url, caption, "File", f["name"])

	captures = frappe.get_all(
		"Room Condition Capture",
		filters={"room": room},
		fields=["name", "capture_stage", "captured_at", "creation"],
		order_by="creation desc",
	)
	for cap in captures:
		photos = frappe.get_all(
			"Room Condition Photo",
			filters={"parent": cap.name},
			fields=["image", "caption", "area"],
			order_by="idx asc",
		)
		when = str(cap.captured_at or cap.creation)
		for ph in photos:
			label = ph.caption or f"{cap.capture_stage or 'Capture'} · {when[:10]}"
			push(ph.image, label, "Room Condition Capture", cap.name)

	if room_type:
		rt_image = frappe.db.get_value("Room Type", room_type, "image")
		push(rt_image, "Room type", "Room Type", room_type)

	return gallery


# ---------- occupancy / revenue ----------


def _revenue_and_occupancy(room: str) -> dict:
	"""Revenue in the last 30 days and occupied-night count.

	Revenue = sum of paid_amount on Payment Entries linked (via PE Reference
	→ Sales Invoice → Folio Line) to any folio for a Stay in this room whose
	posting_date falls in the last 30d. Rough but honest.
	"""
	end = getdate(today())
	start = add_days(end, -29)

	stays = frappe.db.sql(
		"""
		SELECT name, arrival_date, departure_date, stay_status
		FROM `tabStay`
		WHERE current_room = %s
		  AND arrival_date <= %s
		  AND (departure_date IS NULL OR departure_date >= %s)
		""",
		(room, str(end), str(start)),
		as_dict=True,
	)
	occupied_nights = 0
	for s in stays:
		arr = getdate(s.arrival_date) if s.arrival_date else start
		dep = getdate(s.departure_date) if s.departure_date else end
		# clip to window
		if arr < start:
			arr = start
		if dep > end:
			dep = end
		if dep > arr:
			occupied_nights += (dep - arr).days
	occupancy_pct = round(min(occupied_nights / 30.0, 1.0) * 100, 1)

	revenue = 0.0
	stay_names = [s.name for s in stays]
	if stay_names:
		folios = frappe.get_all(
			"Guest Folio",
			filters={"stay": ["in", stay_names]},
			pluck="name",
		)
		if folios:
			rows = frappe.db.sql(
				"""
				SELECT COALESCE(SUM(pe.paid_amount), 0) AS total
				FROM `tabPayment Entry` pe
				LEFT JOIN `tabPayment Entry Reference` per ON per.parent = pe.name
				LEFT JOIN `tabSales Invoice` si ON si.name = per.reference_name
				LEFT JOIN `tabFolio Line` fl ON fl.erpnext_sales_invoice = si.name
				WHERE fl.guest_folio IN %(folios)s
				  AND pe.docstatus = 1
				  AND pe.posting_date BETWEEN %(start)s AND %(end)s
				""",
				{"folios": tuple(folios), "start": str(start), "end": str(end)},
			)
			revenue = flt(rows[0][0] if rows else 0)

	return {"occupancy_pct_30d": occupancy_pct, "occupied_nights_30d": occupied_nights, "revenue_30d": revenue}


# ---------- current + upcoming ----------


def _current_guest(room: str) -> dict | None:
	stay = frappe.db.get_value(
		"Stay",
		{"current_room": room, "stay_status": "In House"},
		["name", "arrival_date", "departure_date", "reservation"],
		as_dict=True,
	)
	if not stay:
		return None
	res = (
		frappe.db.get_value(
			"Reservation",
			stay.reservation,
			["staying_guest_profile"],
			as_dict=True,
		)
		if stay.reservation
		else None
	)
	guest_name = None
	guest_image = None
	if res and res.staying_guest_profile:
		gp = frappe.db.get_value(
			"Guest Profile",
			res.staying_guest_profile,
			["guest_full_name", "image"],
			as_dict=True,
		)
		if gp:
			guest_name = gp.guest_full_name
			guest_image = gp.image
	nights_remaining = None
	if stay.departure_date:
		nights_remaining = max(0, (getdate(stay.departure_date) - getdate(today())).days)
	return {
		"stay": stay.name,
		"guest_name": guest_name,
		"guest_image": guest_image,
		"arrival_date": str(stay.arrival_date) if stay.arrival_date else None,
		"departure_date": str(stay.departure_date) if stay.departure_date else None,
		"nights_remaining": nights_remaining,
	}


def _upcoming_reservations(room: str, limit: int = 3) -> list[dict]:
	rows = frappe.db.sql(
		"""
		SELECT r.name, r.status, r.arrival_date, r.departure_date, r.staying_guest_profile
		FROM `tabReservation Room` rr
		JOIN `tabReservation` r ON r.name = rr.parent
		WHERE rr.room = %s
		  AND r.arrival_date > %s
		  AND r.status IN ('Confirmed', 'Hold', 'Deposit Pending')
		ORDER BY r.arrival_date ASC
		LIMIT %s
		""",
		(room, str(today()), int(limit)),
		as_dict=True,
	)
	for r in rows:
		r["arrival_date"] = str(r["arrival_date"]) if r["arrival_date"] else None
		r["departure_date"] = str(r["departure_date"]) if r["departure_date"] else None
		if r.get("staying_guest_profile"):
			r["guest_name"] = frappe.db.get_value(
				"Guest Profile", r["staying_guest_profile"], "guest_full_name"
			)
		else:
			r["guest_name"] = None
	return rows


# ---------- housekeeping + equipment ----------


def _tasks_summary(room: str) -> dict:
	open_states = ("Queued", "Assigned", "In Progress", "Paused")
	open_count = frappe.db.count(
		"Housekeeping Task", {"room": room, "task_status": ["in", open_states]}
	)
	high_open = frappe.db.count(
		"Housekeeping Task",
		{"room": room, "task_status": ["in", open_states], "priority": "High"},
	)
	last_cleaned = frappe.db.sql(
		"""
		SELECT completed_at, task_type
		FROM `tabHousekeeping Task`
		WHERE room = %s AND task_status = 'Completed'
		  AND task_type IN ('Departure Cleaning', 'Stayover Cleaning', 'Deep Cleaning', 'Turndown')
		ORDER BY completed_at DESC LIMIT 1
		""",
		(room,),
		as_dict=True,
	)
	last = last_cleaned[0] if last_cleaned else None
	return {
		"open_count": int(open_count or 0),
		"high_priority_open": int(high_open or 0),
		"last_cleaned_at": str(last["completed_at"]) if last and last["completed_at"] else None,
		"last_clean_type": last["task_type"] if last else None,
	}


def _equipment_summary(room: str) -> dict:
	rows = frappe.get_all(
		"Room Equipment",
		filters={"parent": room, "parenttype": "Room"},
		fields=["condition"],
	)
	counts: dict[str, int] = {}
	for r in rows:
		c = r.get("condition") or "Unknown"
		counts[c] = counts.get(c, 0) + 1
	return {"total": len(rows), "by_condition": counts}


def _days_since_last_stay(room: str) -> int | None:
	last = frappe.db.get_value(
		"Stay",
		{"current_room": room, "stay_status": ["!=", "In House"]},
		"departure_date",
		order_by="departure_date desc",
	)
	if not last:
		return None
	return max(0, (getdate(today()) - getdate(last)).days)


# ---------- public entrypoint ----------


@frappe.whitelist()
def get_room_insights(room: str) -> dict:
	_require_login()
	if not frappe.db.exists("Room", room):
		frappe.throw(_("Room not found."))
	rt = frappe.db.get_value("Room", room, "room_type")

	insights = {
		"room": room,
		"hero_image": frappe.db.get_value("Room", room, "image")
			or (frappe.db.get_value("Room Type", rt, "image") if rt else None),
		"gallery": _room_gallery(room, rt),
		"current": _current_guest(room),
		"upcoming": _upcoming_reservations(room),
		"tasks": _tasks_summary(room),
		"equipment": _equipment_summary(room),
		"days_since_last_stay": _days_since_last_stay(room),
	}
	insights.update(_revenue_and_occupancy(room))
	return _envelope(insights)
