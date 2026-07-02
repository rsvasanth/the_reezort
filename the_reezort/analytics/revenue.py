"""Revenue analytics — spec 014 first slice.

One dashboard, five signals:
  1. Occupancy %  (occupied_rooms / sellable_rooms, weighted by day)
  2. ADR          (room_revenue / occupied_rooms)
  3. RevPAR       (room_revenue / sellable_rooms)
  4. Total room revenue
  5. Channel mix  (Direct / OTA / Corporate / Walk-in)

Plus a daily trend series: 30 rows of {date, room_revenue, occupancy_pct}
for the chart.

Architecture:
  · Nightly cron writes a Revenue Snapshot row per (property, date), so the
    dashboard reads O(days) rows instead of live-summing PaymentEntries.
  · rebuild_snapshots(from, to, resort_property) idempotently recomputes a
    range — same numbers as the live-sum path, ±1 rounding unit — used to
    backfill history and heal drift after data corrections.
  · Read endpoints (get_summary / get_daily_trend / get_channel_mix) query
    snapshots only. If a range has holes, callers see the truth: fewer
    rows than expected days. The UI raises "N days missing — Rebuild"
    when that gap is detected.

Booking channel bucketing (reservation.booking_source → channel):
  Direct    ← Direct + Staff
  OTA       ← OTA + Travel Agent
  Corporate ← Corporate + Event
  Walk-in   ← Walk In
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import add_days, flt, getdate, now_datetime, today

from the_reezort.staff.api import _envelope

CHANNEL_MAP: dict[str, str] = {
	"Direct": "Direct",
	"Staff": "Direct",
	"OTA": "OTA",
	"Travel Agent": "OTA",
	"Corporate": "Corporate",
	"Event": "Corporate",
	"Walk In": "Walk-in",
}
CHANNELS = ["Direct", "OTA", "Corporate", "Walk-in"]


# ---------- permissions ----------


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _require_analytics_role():
	_require_login()
	roles = set(frappe.get_roles(frappe.session.user))
	if not roles & {"System Manager", "Resort Manager", "Accounts Manager"}:
		frappe.throw(
			_("Analytics is limited to Resort Manager, Accounts Manager, and System Manager."),
			frappe.PermissionError,
		)


def _require_system_manager():
	_require_login()
	if "System Manager" not in frappe.get_roles(frappe.session.user):
		frappe.throw(_("Only System Manager can rebuild snapshots."), frappe.PermissionError)


def _default_property() -> str | None:
	return frappe.db.get_value("Resort Property", {"is_active": 1}, "name") or frappe.db.get_value(
		"Resort Property", {}, "name"
	)


# ---------- snapshot builder ----------


def _sellable_rooms_on(resort_property: str, day) -> int:
	"""Rooms flagged Sellable + is_active on the property. Static across the
	window in this slice — future work adds room-lifecycle to make this
	date-aware (out-of-order maintenance windows)."""
	return frappe.db.count(
		"Room",
		{
			"resort_property": resort_property,
			"is_active": 1,
			"sellable_status": "Sellable",
		},
	)


def _occupied_rooms_on(resort_property: str, day) -> int:
	"""Rooms with an in-house Stay whose window covers `day`.

	A Stay covers `day` when arrival_date <= day <= departure_date-1
	(check-out day itself is not occupied — the room is being cleaned).
	Includes Stays that later checked out; excludes cancelled bookings.
	"""
	rows = frappe.db.sql(
		"""
		SELECT COUNT(DISTINCT current_room) AS n
		FROM `tabStay`
		WHERE resort_property = %s
		  AND current_room IS NOT NULL
		  AND stay_status IN ('In House', 'Due Out', 'Checked Out')
		  AND arrival_date <= %s
		  AND (departure_date IS NULL OR departure_date > %s)
		""",
		(resort_property, str(day), str(day)),
	)
	return int(rows[0][0] if rows else 0)


def _folio_lines_on(resort_property: str, day) -> list[dict]:
	"""All non-voided folio lines whose service_date = `day` for stays on this property."""
	return frappe.db.sql(
		"""
		SELECT fl.name, fl.line_type, fl.source_module, fl.amount,
			   fl.guest_folio, gf.stay, s.reservation
		FROM `tabFolio Line` fl
		LEFT JOIN `tabGuest Folio` gf ON gf.name = fl.guest_folio
		LEFT JOIN `tabStay` s ON s.name = gf.stay
		WHERE fl.service_date = %s
		  AND fl.line_status != 'Voided'
		  AND gf.resort_property = %s
		""",
		(str(day), resort_property),
		as_dict=True,
	)


def _reservations_opened_on(resort_property: str, day) -> list[dict]:
	"""Reservations whose confirmed_at (or creation date fallback) falls on `day`."""
	return frappe.db.sql(
		"""
		SELECT name, booking_source, total_estimated_amount
		FROM `tabReservation`
		WHERE resort_property = %s
		  AND status IN ('Confirmed', 'Checked In', 'Checked Out')
		  AND DATE(COALESCE(confirmed_at, creation)) = %s
		""",
		(resort_property, str(day)),
		as_dict=True,
	)


def _compute_snapshot(resort_property: str, day) -> dict:
	"""Pure function: gather counts + revenue for one (property, date). Called
	both from the daily cron and from rebuild_snapshots — identical output
	guarantees rebuild convergence."""
	lines = _folio_lines_on(resort_property, day)
	room_revenue = sum(flt(r["amount"]) for r in lines if r["source_module"] == "Room" and r["line_type"] == "Charge")
	other_revenue = sum(
		flt(r["amount"])
		for r in lines
		if r["source_module"] != "Room" and r["line_type"] == "Charge"
	)

	reservations = _reservations_opened_on(resort_property, day)
	channel_bookings: dict[str, int] = {c: 0 for c in CHANNELS}
	channel_revenue: dict[str, float] = {c: 0.0 for c in CHANNELS}
	# Sum room-revenue per reservation by channel — walk lines and bucket by
	# the reservation's booking source. Non-Room lines don't count toward
	# channel-revenue (channel = booking channel = room-based).
	res_by_name = {r["name"]: r for r in reservations}
	for line in lines:
		if line["line_type"] != "Charge" or line["source_module"] != "Room":
			continue
		if not line.get("reservation") or line["reservation"] not in res_by_name:
			continue
		source = res_by_name[line["reservation"]]["booking_source"]
		channel = CHANNEL_MAP.get(source, "Direct")
		channel_revenue[channel] += flt(line["amount"])
	# Bookings per channel = count of new reservations on `day` in each bucket.
	for r in reservations:
		channel = CHANNEL_MAP.get(r["booking_source"], "Direct")
		channel_bookings[channel] += 1

	return {
		"resort_property": resort_property,
		"snapshot_date": str(day),
		"sellable_rooms": _sellable_rooms_on(resort_property, day),
		"occupied_rooms": _occupied_rooms_on(resort_property, day),
		"room_revenue": room_revenue,
		"other_revenue": other_revenue,
		"direct_bookings": channel_bookings["Direct"],
		"direct_revenue": channel_revenue["Direct"],
		"ota_bookings": channel_bookings["OTA"],
		"ota_revenue": channel_revenue["OTA"],
		"corporate_bookings": channel_bookings["Corporate"],
		"corporate_revenue": channel_revenue["Corporate"],
		"walk_in_bookings": channel_bookings["Walk-in"],
		"walk_in_revenue": channel_revenue["Walk-in"],
		"currency": frappe.db.get_value("Resort Property", resort_property, "default_currency") or "INR",
		"computed_at": now_datetime(),
	}


def _upsert_snapshot(payload: dict) -> str:
	"""Idempotent upsert on (resort_property, snapshot_date) — same date twice
	overwrites in place."""
	name = f"{payload['resort_property']}-{payload['snapshot_date']}"
	if frappe.db.exists("Revenue Snapshot", name):
		doc = frappe.get_doc("Revenue Snapshot", name)
		for field, value in payload.items():
			doc.set(field, value)
	else:
		doc = frappe.get_doc({"doctype": "Revenue Snapshot", **payload})
	doc.flags.ignore_permissions = True
	doc.save()
	return doc.name


# ---------- public entry points ----------


@frappe.whitelist()
def rebuild_snapshots(
	from_date: str,
	to_date: str,
	resort_property: str | None = None,
) -> dict:
	"""Recompute + upsert snapshots across a date range. Idempotent per date.

	System Manager only — this is a data-correction lever, not a UI hot-path.
	The dashboard reads snapshots; if it shows drift after an invoice fix,
	rebuild the affected window and refetch.
	"""
	_require_system_manager()
	resort_property = resort_property or _default_property()
	if not resort_property:
		frappe.throw(_("No Resort Property configured."))
	start, end = getdate(from_date), getdate(to_date)
	if start > end:
		frappe.throw(_("from_date must be <= to_date."))

	names = []
	day = start
	while day <= end:
		payload = _compute_snapshot(resort_property, day)
		names.append(_upsert_snapshot(payload))
		day = add_days(day, 1)
	frappe.db.commit()
	return _envelope({"resort_property": resort_property, "days": len(names), "snapshots": names})


def snapshot_yesterday() -> int:
	"""Daily cron entry. Snapshots yesterday for every active property.
	Returns the number of snapshots written."""
	yesterday = add_days(getdate(today()), -1)
	properties = frappe.get_all(
		"Resort Property",
		filters={"is_active": 1},
		pluck="name",
	) or frappe.get_all("Resort Property", pluck="name")
	written = 0
	for prop in properties:
		payload = _compute_snapshot(prop, yesterday)
		_upsert_snapshot(payload)
		written += 1
	frappe.db.commit()
	return written


# ---------- read APIs ----------


def _sum_snapshots(resort_property: str, start, end) -> dict:
	rows = frappe.get_all(
		"Revenue Snapshot",
		filters={
			"resort_property": resort_property,
			"snapshot_date": ["between", [str(start), str(end)]],
		},
		fields=[
			"snapshot_date", "sellable_rooms", "occupied_rooms",
			"room_revenue", "other_revenue", "total_revenue",
			"direct_bookings", "direct_revenue",
			"ota_bookings", "ota_revenue",
			"corporate_bookings", "corporate_revenue",
			"walk_in_bookings", "walk_in_revenue",
		],
		order_by="snapshot_date asc",
	)
	sellable = sum(int(r.sellable_rooms or 0) for r in rows)
	occupied = sum(int(r.occupied_rooms or 0) for r in rows)
	room_revenue = sum(flt(r.room_revenue) for r in rows)
	other_revenue = sum(flt(r.other_revenue) for r in rows)
	return {
		"rows": rows,
		"days_covered": len(rows),
		"sellable_room_nights": sellable,
		"occupied_room_nights": occupied,
		"room_revenue": room_revenue,
		"other_revenue": other_revenue,
		"total_revenue": room_revenue + other_revenue,
		"occupancy_pct": round((occupied / sellable) * 100, 1) if sellable else 0,
		"adr": round(room_revenue / occupied, 0) if occupied else 0,
		"revpar": round(room_revenue / sellable, 0) if sellable else 0,
	}


@frappe.whitelist()
def get_summary(
	from_date: str | None = None,
	to_date: str | None = None,
	resort_property: str | None = None,
) -> dict:
	"""Headline KPIs for a date range + delta vs the same-length prior period.

	Default range = last 30 days ending yesterday.
	"""
	_require_analytics_role()
	resort_property = resort_property or _default_property()
	if not resort_property:
		frappe.throw(_("No Resort Property configured."))

	end = getdate(to_date) if to_date else add_days(getdate(today()), -1)
	start = getdate(from_date) if from_date else add_days(end, -29)
	length = (end - start).days + 1
	prev_end = add_days(start, -1)
	prev_start = add_days(prev_end, -(length - 1))

	current = _sum_snapshots(resort_property, start, end)
	previous = _sum_snapshots(resort_property, prev_start, prev_end)

	def _delta(now, before):
		if not before:
			return None
		return round(((now - before) / before) * 100, 1)

	summary = {
		"resort_property": resort_property,
		"from_date": str(start),
		"to_date": str(end),
		"days": length,
		"days_covered": current["days_covered"],
		"days_missing": max(0, length - current["days_covered"]),
		"currency": frappe.db.get_value("Resort Property", resort_property, "default_currency") or "INR",
		"occupancy_pct": current["occupancy_pct"],
		"adr": current["adr"],
		"revpar": current["revpar"],
		"room_revenue": current["room_revenue"],
		"other_revenue": current["other_revenue"],
		"total_revenue": current["total_revenue"],
		"deltas": {
			"occupancy_pct": round(current["occupancy_pct"] - previous["occupancy_pct"], 1),
			"adr": round(current["adr"] - previous["adr"], 0),
			"revpar": round(current["revpar"] - previous["revpar"], 0),
			"room_revenue_pct": _delta(current["room_revenue"], previous["room_revenue"]),
		},
	}
	return _envelope(summary)


@frappe.whitelist()
def get_daily_trend(
	days: int = 30,
	resort_property: str | None = None,
) -> dict:
	"""Day-by-day series for the trend chart. Ends yesterday, spans `days`.

	Every day in the range appears in the series — missing snapshots come
	back as zeros so the chart scale doesn't collapse on empty days.
	"""
	_require_analytics_role()
	resort_property = resort_property or _default_property()
	if not resort_property:
		frappe.throw(_("No Resort Property configured."))

	days = min(int(days), 365)
	end = add_days(getdate(today()), -1)
	start = add_days(end, -(days - 1))
	rows = frappe.get_all(
		"Revenue Snapshot",
		filters={
			"resort_property": resort_property,
			"snapshot_date": ["between", [str(start), str(end)]],
		},
		fields=["snapshot_date", "room_revenue", "occupied_rooms", "sellable_rooms", "total_revenue"],
	)
	by_date = {str(r.snapshot_date): r for r in rows}

	series = []
	day = start
	while day <= end:
		key = str(day)
		row = by_date.get(key)
		if row:
			occ_pct = (
				round((int(row.occupied_rooms or 0) / int(row.sellable_rooms or 1)) * 100, 1)
				if row.sellable_rooms
				else 0
			)
			series.append(
				{
					"date": key,
					"room_revenue": flt(row.room_revenue),
					"total_revenue": flt(row.total_revenue),
					"occupancy_pct": occ_pct,
					"present": True,
				}
			)
		else:
			series.append(
				{
					"date": key,
					"room_revenue": 0.0,
					"total_revenue": 0.0,
					"occupancy_pct": 0.0,
					"present": False,
				}
			)
		day = add_days(day, 1)

	return _envelope({"resort_property": resort_property, "days": days, "series": series})


@frappe.whitelist()
def get_channel_mix(
	from_date: str | None = None,
	to_date: str | None = None,
	resort_property: str | None = None,
) -> dict:
	"""Booking channel share of room revenue over a window.

	Returns 4 channels: Direct / OTA / Corporate / Walk-in. Percentages
	always add to 100% (unless total revenue is 0, then 0/0/0/0).
	"""
	_require_analytics_role()
	resort_property = resort_property or _default_property()
	if not resort_property:
		frappe.throw(_("No Resort Property configured."))

	end = getdate(to_date) if to_date else add_days(getdate(today()), -1)
	start = getdate(from_date) if from_date else add_days(end, -29)

	rows = frappe.get_all(
		"Revenue Snapshot",
		filters={
			"resort_property": resort_property,
			"snapshot_date": ["between", [str(start), str(end)]],
		},
		fields=[
			"direct_bookings", "direct_revenue",
			"ota_bookings", "ota_revenue",
			"corporate_bookings", "corporate_revenue",
			"walk_in_bookings", "walk_in_revenue",
		],
	)
	totals = {
		"Direct": {"bookings": 0, "revenue": 0.0},
		"OTA": {"bookings": 0, "revenue": 0.0},
		"Corporate": {"bookings": 0, "revenue": 0.0},
		"Walk-in": {"bookings": 0, "revenue": 0.0},
	}
	for r in rows:
		totals["Direct"]["bookings"] += int(r.direct_bookings or 0)
		totals["Direct"]["revenue"] += flt(r.direct_revenue)
		totals["OTA"]["bookings"] += int(r.ota_bookings or 0)
		totals["OTA"]["revenue"] += flt(r.ota_revenue)
		totals["Corporate"]["bookings"] += int(r.corporate_bookings or 0)
		totals["Corporate"]["revenue"] += flt(r.corporate_revenue)
		totals["Walk-in"]["bookings"] += int(r.walk_in_bookings or 0)
		totals["Walk-in"]["revenue"] += flt(r.walk_in_revenue)

	total_revenue = sum(t["revenue"] for t in totals.values())
	channels = []
	for name in CHANNELS:
		bucket = totals[name]
		channels.append(
			{
				"channel": name,
				"bookings": bucket["bookings"],
				"revenue": bucket["revenue"],
				"pct": round((bucket["revenue"] / total_revenue) * 100, 1) if total_revenue else 0,
			}
		)

	return _envelope(
		{
			"resort_property": resort_property,
			"from_date": str(start),
			"to_date": str(end),
			"total_revenue": total_revenue,
			"channels": channels,
		}
	)
