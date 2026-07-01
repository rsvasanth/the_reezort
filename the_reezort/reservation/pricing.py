"""Plan-aware rate resolution.

Layers, in order:

1. If a **Package** matches the room type + window, the caller can present
   it as a bundle alternative (returned separately; the base rate below
   is still computed for the raw plan).
2. Pick the applicable **Rate Plan** for the room type (property-scoped,
   room-type match preferred over property-wide fallback).
3. Base per-night rate = `rate_plan.base_rate_override` if set, else the
   Item Price for the room type's ERPNext item, else 0.
4. For each night in the window, apply the highest-priority active
   **Season** whose window covers the date:
     - if `absolute_rate` set, that night's rate = absolute_rate
     - else nightly rate *= (1 + modifier_pct/100)
5. Apply `weekend_uplift_pct` on Fri/Sat nights *after* the season stack
   (weekend is a plan-level rule, not a season).

Backward compatible: if no Rate Plan exists for the property, we return
the legacy `_room_rate` result unchanged.
"""

import frappe
from frappe.utils import add_days, flt, getdate

from the_reezort.reservation.api import ROOM_ITEM_BY_CODE


def _item_price(item_code):
	if not item_code:
		return 0
	price_list = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
	if not price_list:
		return 0
	return (
		frappe.db.get_value(
			"Item Price",
			{"item_code": item_code, "price_list": price_list, "selling": 1},
			"price_list_rate",
		)
		or 0
	)


def _resort_property_of_room_type(room_type):
	return frappe.db.get_value("Room Type", room_type, "resort_property")


def _rate_plan_for(room_type, resort_property, explicit_code=None):
	"""Pick a Rate Plan. Prefer room-type-scoped, then property-wide.

	If `explicit_code` given (e.g. via availability search), prefer it.
	"""
	filters = {"resort_property": resort_property, "is_active": 1}
	if explicit_code:
		match = frappe.db.get_value("Rate Plan", {**filters, "code": explicit_code}, "name")
		if match:
			return frappe.get_doc("Rate Plan", match)

	# Room-type-scoped plan wins over property-wide.
	scoped = frappe.get_all(
		"Rate Plan",
		filters={**filters, "room_type": room_type},
		fields=["name", "code"],
		limit=1,
	)
	if scoped:
		return frappe.get_doc("Rate Plan", scoped[0].name)

	property_wide = frappe.get_all(
		"Rate Plan",
		filters={**filters, "room_type": ["is", "not set"]},
		fields=["name", "code"],
		limit=1,
	)
	if property_wide:
		return frappe.get_doc("Rate Plan", property_wide[0].name)

	return None


def _seasons_for(resort_property, arrival_date, departure_date):
	return frappe.get_all(
		"Season",
		filters={
			"resort_property": resort_property,
			"is_active": 1,
			"start_date": ["<=", departure_date],
			"end_date": [">=", arrival_date],
		},
		fields=["name", "code", "season_name", "start_date", "end_date", "priority", "modifier_pct", "absolute_rate"],
		order_by="priority desc",
	)


def _pick_season(active_seasons, night_date):
	"""Highest-priority season whose window contains this night."""
	night = getdate(night_date)
	for s in active_seasons:
		if getdate(s.start_date) <= night <= getdate(s.end_date):
			return s
	return None


def resolve_room_rate(room_type, arrival_date, departure_date, plan_code=None):
	"""Returns a plan-aware pricing breakdown.

	{
	  applied_plan: {code, name, refundable, cancellation_hours} | None,
	  base_rate: float,               # per-night before season/weekend
	  nightly_breakdown: [{date, rate, season_code, season_pct, weekend}],
	  total_amount: float,
	  season_uplift_summary: "Weekend +30%" | "Peak +50%" | None,
	}

	Falls back to legacy Item Price × nights when no Rate Plan exists.
	"""
	from frappe.utils import date_diff

	if not room_type or not arrival_date or not departure_date:
		return {"applied_plan": None, "base_rate": 0, "nightly_breakdown": [], "total_amount": 0, "season_uplift_summary": None}

	resort_property = _resort_property_of_room_type(room_type)
	rt = frappe.db.get_value("Room Type", room_type, ["erpnext_item", "room_type_code"], as_dict=True) or {}
	item_code = rt.get("erpnext_item") or ROOM_ITEM_BY_CODE.get(rt.get("room_type_code"))

	# Backward compat: no Rate Plan configured → return the legacy flat rate.
	plan = _rate_plan_for(room_type, resort_property, explicit_code=plan_code)
	if not plan:
		nights = date_diff(departure_date, arrival_date)
		flat = flt(_item_price(item_code)) * nights
		return {
			"applied_plan": None,
			"base_rate": flt(_item_price(item_code)),
			"nightly_breakdown": [],
			"total_amount": flat,
			"season_uplift_summary": None,
		}

	base_rate = flt(plan.base_rate_override) or flt(_item_price(item_code))
	seasons = _seasons_for(resort_property, arrival_date, departure_date)

	breakdown = []
	uplifts = set()
	nights = date_diff(departure_date, arrival_date)
	for i in range(nights):
		night = add_days(arrival_date, i)
		# Fri (4) / Sat (5) are weekend.
		is_weekend = getdate(night).weekday() in (4, 5)
		season = _pick_season(seasons, night)

		if season and season.absolute_rate:
			nightly = flt(season.absolute_rate)
			season_pct = None
		elif season and season.modifier_pct:
			nightly = base_rate * (1 + flt(season.modifier_pct) / 100.0)
			season_pct = flt(season.modifier_pct)
			sign = "+" if season_pct >= 0 else ""
			uplifts.add(f"{season.code} {sign}{season_pct:g}%")
		else:
			nightly = base_rate
			season_pct = None

		if is_weekend and flt(plan.weekend_uplift_pct):
			nightly = nightly * (1 + flt(plan.weekend_uplift_pct) / 100.0)
			uplifts.add(f"Weekend +{flt(plan.weekend_uplift_pct):g}%")

		breakdown.append(
			{
				"date": str(night),
				"rate": round(nightly, 2),
				"season_code": season.code if season else None,
				"season_pct": season_pct,
				"weekend": is_weekend,
			}
		)

	total = sum(n["rate"] for n in breakdown)
	return {
		"applied_plan": {
			"code": plan.code,
			"name": plan.plan_name,
			"refundable": bool(plan.refundable),
			"cancellation_hours": plan.cancellation_hours,
		},
		"base_rate": base_rate,
		"nightly_breakdown": breakdown,
		"total_amount": round(total, 2),
		"season_uplift_summary": " · ".join(sorted(uplifts)) or None,
	}


def packages_for(room_type, arrival_date, departure_date):
	"""Active packages that match this room type + fit the booking window."""
	resort_property = _resort_property_of_room_type(room_type)
	from frappe.utils import date_diff

	nights_requested = date_diff(departure_date, arrival_date)
	rows = frappe.get_all(
		"Package",
		filters={
			"resort_property": resort_property,
			"is_active": 1,
		},
		fields=["name", "code", "package_name", "nights", "room_type", "package_price", "currency", "valid_from", "valid_to"],
	)
	out = []
	for p in rows:
		if p.room_type and p.room_type != room_type:
			continue
		if p.valid_from and getdate(arrival_date) < getdate(p.valid_from):
			continue
		if p.valid_to and getdate(departure_date) > getdate(p.valid_to):
			continue
		if p.nights and p.nights != nights_requested:
			# Include as informational; not a fit
			continue
		inclusions = frappe.get_all(
			"Package Inclusion",
			filters={"parent": p.name, "parenttype": "Package"},
			fields=["inclusion_name", "quantity"],
			order_by="idx asc",
		)
		out.append({
			"name": p.name,
			"code": p.code,
			"package_name": p.package_name,
			"nights": p.nights,
			"room_type": p.room_type,
			"package_price": flt(p.package_price),
			"currency": p.currency,
			"inclusions": inclusions,
			"inclusions_summary": " + ".join(i.inclusion_name for i in inclusions) if inclusions else "",
		})
	return out
