"""Per-OTA adapters — pure functions that map a raw source row to the
canonical parsed shape stored on OTA Reservation Message.

Each adapter takes a `dict` (a single CSV row or JSON object from the source
feed) and returns a dict of `parsed_*` fields. Missing/unknown fields come
back as `None` so the UI can render `—`. Adapters MUST NOT hit the database
or raise on unknown fields — they translate shape, nothing more.

Registering a new OTA:
  1. Add the source label to OTA Reservation Message.source Select options
     and OTA Ingest Batch.source Select options.
  2. Write parse_<source>_row(row) here returning the canonical dict.
  3. Add it to ADAPTERS.

The ingest orchestrator dispatches by source name.
"""

from __future__ import annotations

from typing import Callable

from frappe.utils import flt, get_datetime


# Canonical output shape (all optional, adapter fills what the source has):
# {
#   "external_id":         str,     REQUIRED — dedupe key
#   "parsed_guest_name":   str,
#   "parsed_email":        str,
#   "parsed_phone":        str,
#   "parsed_arrival":      str,     YYYY-MM-DD
#   "parsed_departure":    str,     YYYY-MM-DD
#   "parsed_adults":       int,
#   "parsed_children":     int,
#   "parsed_room_type_code": str,
#   "parsed_rate_code":    str,
#   "parsed_total":        float,
#   "parsed_currency":     str,     ISO code
# }


def _s(row: dict, *keys: str) -> str | None:
	"""Pick the first non-empty value across a set of column-name aliases.
	OTA CSV exports rename columns across regions / years — checking a few
	aliases means one adapter tolerates minor CSV format drift."""
	for k in keys:
		v = row.get(k)
		if v is None:
			continue
		v = str(v).strip()
		if v:
			return v
	return None


def _i(row: dict, *keys: str, default: int = 0) -> int:
	v = _s(row, *keys)
	if v is None:
		return default
	try:
		return int(float(v))
	except (TypeError, ValueError):
		return default


def _f(row: dict, *keys: str) -> float:
	v = _s(row, *keys)
	if v is None:
		return 0.0
	try:
		return flt(v)
	except (TypeError, ValueError):
		return 0.0


def _date(row: dict, *keys: str) -> str | None:
	v = _s(row, *keys)
	if not v:
		return None
	try:
		return str(get_datetime(v).date())
	except Exception:
		return None


# ---------------------------------------------------------------------------
# Booking.com
# ---------------------------------------------------------------------------


def parse_bookingcom_row(row: dict) -> dict:
	"""Mirrors the Booking.com CSV export columns used across their extranet."""
	return {
		"external_id": _s(row, "Reservation number", "reservation_number", "booking_id"),
		"parsed_guest_name": _s(row, "Guest name", "guest_name"),
		"parsed_email": _s(row, "Guest email", "guest_email", "email"),
		"parsed_phone": _s(row, "Guest phone", "phone"),
		"parsed_arrival": _date(row, "Check-in", "check_in", "arrival"),
		"parsed_departure": _date(row, "Check-out", "check_out", "departure"),
		"parsed_adults": _i(row, "Adults", "adults", default=2),
		"parsed_children": _i(row, "Children", "children"),
		"parsed_room_type_code": _s(row, "Room", "room_type_code", "unit_type"),
		"parsed_rate_code": _s(row, "Rate plan", "rate_code", "rate_plan"),
		"parsed_total": _f(row, "Total price", "price", "total"),
		"parsed_currency": _s(row, "Currency", "currency") or "INR",
	}


# ---------------------------------------------------------------------------
# Expedia
# ---------------------------------------------------------------------------


def parse_expedia_row(row: dict) -> dict:
	"""Mirrors Expedia Partner Central confirmation report columns."""
	return {
		"external_id": _s(row, "Confirmation number", "itinerary_id", "reservation_id"),
		"parsed_guest_name": _s(row, "Guest name", "Primary guest", "guest"),
		"parsed_email": _s(row, "Email", "guest_email"),
		"parsed_phone": _s(row, "Phone", "phone"),
		"parsed_arrival": _date(row, "Arrival", "Check-in date"),
		"parsed_departure": _date(row, "Departure", "Check-out date"),
		"parsed_adults": _i(row, "Adults", default=2),
		"parsed_children": _i(row, "Children"),
		"parsed_room_type_code": _s(row, "Room type", "unit", "room_code"),
		"parsed_rate_code": _s(row, "Rate plan", "rate_type"),
		"parsed_total": _f(row, "Room revenue", "Total", "price"),
		"parsed_currency": _s(row, "Currency", "currency") or "INR",
	}


# ---------------------------------------------------------------------------
# Manual — generic pass-through so ops can hand-craft a CSV in the same shape
# as the parsed columns.
# ---------------------------------------------------------------------------


def parse_manual_row(row: dict) -> dict:
	return {
		"external_id": _s(row, "external_id", "id", "reservation_id"),
		"parsed_guest_name": _s(row, "parsed_guest_name", "guest_name", "name"),
		"parsed_email": _s(row, "parsed_email", "email"),
		"parsed_phone": _s(row, "parsed_phone", "phone"),
		"parsed_arrival": _date(row, "parsed_arrival", "arrival", "check_in"),
		"parsed_departure": _date(row, "parsed_departure", "departure", "check_out"),
		"parsed_adults": _i(row, "parsed_adults", "adults", default=2),
		"parsed_children": _i(row, "parsed_children", "children"),
		"parsed_room_type_code": _s(row, "parsed_room_type_code", "room_type", "room"),
		"parsed_rate_code": _s(row, "parsed_rate_code", "rate_code", "rate"),
		"parsed_total": _f(row, "parsed_total", "total", "price"),
		"parsed_currency": _s(row, "parsed_currency", "currency") or "INR",
	}


ADAPTERS: dict[str, Callable[[dict], dict]] = {
	"Booking.com": parse_bookingcom_row,
	"Expedia": parse_expedia_row,
	# Airbnb + Agoda + GDS reuse the manual shape for slice-1 — real adapters ship in follow-ups.
	"Airbnb": parse_manual_row,
	"Agoda": parse_manual_row,
	"GDS": parse_manual_row,
	"Manual": parse_manual_row,
}


def get_adapter(source: str) -> Callable[[dict], dict]:
	if source not in ADAPTERS:
		raise ValueError(f"No OTA adapter registered for source {source!r}")
	return ADAPTERS[source]
