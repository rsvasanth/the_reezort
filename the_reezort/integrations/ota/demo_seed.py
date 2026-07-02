"""Seed a small OTA inbox on prod so the demo has something to render.

Idempotent — matched on (source, external_id). Re-run safely.

Ships 6 messages across Booking.com + Expedia in mixed states:
  · 3 New (unreviewed)
  · 1 Converted (already made a Reservation)
  · 1 Rejected (with a reason)
  · 1 Dead-letter (with an error message so the retry flow can demo)

Arrival dates are staggered next-week-ish so overlap-check hints have
something to bite on.
"""

from __future__ import annotations

import json
from datetime import date, timedelta

import frappe
from frappe.utils import add_days, now_datetime, today

DEMO_MESSAGES = [
	# (source, external_id, guest_name, email, phone, arr_offset, nights, adults, children, room_code, rate_code, total, state, notes)
	("Booking.com", "BDC-4482991", "Aarav Sharma", "aarav.sharma@example.com", "+91 90000 12345",  3, 2, 2, 0, "SAV", "BAR",     28000, "New", "Paid on Booking.com — do not collect deposit"),
	("Booking.com", "BDC-4482992", "Diya Nair",    "diya.nair@example.com",    "+91 98111 22233",  5, 3, 2, 1, "DLX", "BAR",     42000, "New", "Requesting early check-in"),
	("Expedia",     "EXP-1123456", "Rita Menon",   "rita.menon@example.com",   "+91 99991 78912",  10, 3, 2, 0, "SAV", "MEMBER", 42000, "New", "Corporate rate through Expedia"),
	("Expedia",     "EXP-1123457", "Rohit Verma",  "rohit.verma@example.com",  "+91 87222 45611",  15, 1, 1, 0, "DLX", "BAR",    12500, "Converted", None),
	("Booking.com", "BDC-4482993", "Prashant Rao", "prashant.rao@example.com", "+91 98765 43210",  8, 2, 2, 0, "SAV", "BAR",     28000, "Rejected", "Duplicate — guest also emailed directly and we already have a Direct booking"),
	("Booking.com", "BDC-4482994", "",             "unknown@example.com",       "",                20, 4, 2, 0, "",    "BAR",     0,     "Dead-letter", None),
]


@frappe.whitelist()
def seed_ota_inbox(resort_property: str | None = None) -> dict:
	prop = resort_property or frappe.db.get_value("Resort Property", {"is_active": 1}, "name") or frappe.db.get_value(
		"Resort Property", {}, "name"
	)
	if not prop:
		return {"ok": False, "reason": "No Resort Property configured"}

	# All demo rows attach to a single synthetic batch so the audit trail
	# reads coherently: "demo seed batch on 2026-07-02".
	batch_name = frappe.db.get_value(
		"OTA Ingest Batch", {"filename": "demo-seed-slice-013"}, "name"
	)
	if not batch_name:
		batch = frappe.get_doc(
			{
				"doctype": "OTA Ingest Batch",
				"source": "Manual",
				"filename": "demo-seed-slice-013",
				"uploaded_at": now_datetime(),
				"uploaded_by": frappe.session.user,
				"payload_hash": f"demo-seed-{today()}",
				"row_count": len(DEMO_MESSAGES),
				"notes": "Demo seed — spec 013 slice-1 walkthrough data",
			}
		)
		batch.flags.ignore_permissions = True
		batch.insert()
		batch_name = batch.name

	created = []
	existed = []
	for source, ext_id, name, email, phone, arr_offset, nights, adults, children, room_code, rate_code, total, state, notes in DEMO_MESSAGES:
		if frappe.db.exists("OTA Reservation Message", {"source": source, "external_id": ext_id}):
			existed.append(ext_id)
			continue
		arr = add_days(today(), arr_offset)
		dep = add_days(arr, nights)
		msg = frappe.get_doc(
			{
				"doctype": "OTA Reservation Message",
				"resort_property": prop,
				"source": source,
				"external_id": ext_id,
				"state": state,
				"received_at": now_datetime(),
				"batch": batch_name,
				"parsed_guest_name": name or None,
				"parsed_email": email or None,
				"parsed_phone": phone or None,
				"parsed_arrival": arr,
				"parsed_departure": dep,
				"parsed_adults": adults,
				"parsed_children": children,
				"parsed_room_type_code": room_code or None,
				"parsed_rate_code": rate_code,
				"parsed_total": total,
				"parsed_currency": "INR",
				"notes": notes,
				"rejection_reason": notes if state == "Rejected" else None,
				"dead_letter_error": "Missing guest_name — adapter returned empty parsed_guest_name" if state == "Dead-letter" else None,
				"raw_payload": json.dumps(
					{
						"reservation_id": ext_id,
						"guest_name": name,
						"email": email,
						"arrival": str(arr),
						"departure": str(dep),
						"total": total,
					}
				),
			}
		)
		msg.flags.ignore_permissions = True
		msg.insert()
		created.append(msg.name)

	frappe.db.commit()
	return {"ok": True, "batch": batch_name, "created": created, "existed": existed}
