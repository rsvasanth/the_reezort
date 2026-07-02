"""OTA reservation ingest — spec 013 first slice.

Manual/uploadable OTA ingest. Property receives an OTA CSV export or JSON
payload, calls ingest_payload(), the orchestrator parses each row via the
per-source adapter and stores it as an `OTA Reservation Message` in `New`
state. Staff review each row in the inbox and either `convert` it into a
native Reservation or `reject` it with a reason.

State machine:
  New → Converted    (mints Reservation, source_reference = external_id)
  New → Rejected     (records reason)
  New → Dead-letter  (parser or DB error on ingest)
  Dead-letter → New  (via retry_dead_letter cron; reparse succeeded)

Row-level dedupe: unique (source, external_id). Re-ingesting the same OTA
booking increments duplicate_count on the batch and does not create a
second row.

File-level dedupe: payload_hash on OTA Ingest Batch. A re-upload of the
exact same file returns the prior batch verbatim (not "no-op with warning"
— literal reuse) so the inbox stays clean and idempotent.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
from typing import Any

import frappe
from frappe import _
from frappe.utils import add_days, add_to_date, flt, get_datetime, getdate, now_datetime, today

from the_reezort.integrations.ota.adapters import ADAPTERS, get_adapter
from the_reezort.staff.api import _envelope

# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _require_ota_role():
	_require_login()
	roles = set(frappe.get_roles(frappe.session.user))
	if not roles & {"System Manager", "Resort Manager", "Reservation Agent", "Accounts Manager"}:
		frappe.throw(
			_("OTA inbox is limited to Resort Manager, Reservation Agent, and Accounts Manager."),
			frappe.PermissionError,
		)


def _require_write_role():
	_require_login()
	roles = set(frappe.get_roles(frappe.session.user))
	if not roles & {"System Manager", "Resort Manager", "Reservation Agent"}:
		frappe.throw(
			_("Only Resort Manager and Reservation Agent can convert or reject OTA messages."),
			frappe.PermissionError,
		)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _payload_hash(payload: str) -> str:
	return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _parse_rows(source: str, payload: str) -> list[dict]:
	"""Split the payload into rows. Supports CSV (default) and JSON."""
	trimmed = (payload or "").strip()
	if not trimmed:
		return []
	# Try JSON first (JSON is stricter — malformed CSV won't accidentally parse).
	if trimmed.startswith("[") or trimmed.startswith("{"):
		try:
			obj = json.loads(trimmed)
			return obj if isinstance(obj, list) else [obj]
		except json.JSONDecodeError:
			pass
	# CSV.
	reader = csv.DictReader(io.StringIO(trimmed))
	return [dict(row) for row in reader if any((v or "").strip() for v in row.values())]


def _message_dict(doc) -> dict:
	return {
		"name": doc.name,
		"source": doc.source,
		"external_id": doc.external_id,
		"state": doc.state,
		"resort_property": doc.resort_property,
		"received_at": str(doc.received_at) if doc.received_at else None,
		"processed_at": str(doc.processed_at) if doc.processed_at else None,
		"batch": doc.batch,
		"parsed_guest_name": doc.parsed_guest_name,
		"parsed_email": doc.parsed_email,
		"parsed_phone": doc.parsed_phone,
		"parsed_adults": doc.parsed_adults,
		"parsed_children": doc.parsed_children,
		"parsed_arrival": str(doc.parsed_arrival) if doc.parsed_arrival else None,
		"parsed_departure": str(doc.parsed_departure) if doc.parsed_departure else None,
		"parsed_room_type_code": doc.parsed_room_type_code,
		"parsed_rate_code": doc.parsed_rate_code,
		"parsed_total": flt(doc.parsed_total),
		"parsed_currency": doc.parsed_currency,
		"converted_reservation": doc.converted_reservation,
		"rejection_reason": doc.rejection_reason,
		"dead_letter_error": doc.dead_letter_error,
		"notes": doc.notes,
	}


def _find_similar_reservations(doc) -> list[dict]:
	"""Non-blocking duplicate hint for the Review sheet. Matches on:
	  · Reservation.source_reference == external_id (any source)  → hard hint
	  · overlapping dates + same email OR name                     → soft hint
	The UI surfaces these before Convert as an FYI banner. Only a matching
	external_id blocks convert (see _refuse_convert)."""
	hints: list[dict] = []
	if doc.external_id:
		rows = frappe.get_all(
			"Reservation",
			filters={"source_reference": doc.external_id},
			fields=["name", "status", "arrival_date", "departure_date", "resort_property"],
		)
		for r in rows:
			hints.append({"reservation": r["name"], "match": "external_id", **r})

	if not doc.parsed_arrival or not doc.parsed_departure:
		return hints

	overlap_filters: dict[str, Any] = {
		"arrival_date": ["<", doc.parsed_departure],
		"departure_date": [">", doc.parsed_arrival],
		"status": ["in", ["Hold", "Confirmed", "Checked In", "Checked Out"]],
	}
	overlap = frappe.get_all(
		"Reservation",
		filters=overlap_filters,
		fields=["name", "status", "arrival_date", "departure_date", "staying_guest_profile"],
		limit_page_length=25,
	)
	seen = {h["reservation"] for h in hints}
	for r in overlap:
		if r["name"] in seen or not r.get("staying_guest_profile"):
			continue
		profile = frappe.db.get_value(
			"Guest Profile", r["staying_guest_profile"], ["guest_full_name", "email"], as_dict=True
		) or {}
		matched = False
		if doc.parsed_email and profile.get("email") and doc.parsed_email.lower() == profile.get("email").lower():
			matched = True
		elif doc.parsed_guest_name and profile.get("guest_full_name") and (
			doc.parsed_guest_name.lower() == profile.get("guest_full_name").lower()
		):
			matched = True
		if matched:
			hints.append({"reservation": r["name"], "match": "guest_and_dates", **r})
	return hints


def _get_or_create_guest_profile(doc) -> str | None:
	if not doc.parsed_guest_name:
		return None
	existing = None
	if doc.parsed_email:
		existing = frappe.db.get_value("Guest Profile", {"email": doc.parsed_email}, "name")
	if not existing and doc.parsed_phone:
		existing = frappe.db.get_value("Guest Profile", {"phone": doc.parsed_phone}, "name")
	if existing:
		return existing
	profile = frappe.get_doc(
		{
			"doctype": "Guest Profile",
			"guest_full_name": doc.parsed_guest_name,
			"email": doc.parsed_email,
			"phone": doc.parsed_phone,
		}
	)
	profile.flags.ignore_permissions = True
	profile.insert()
	return profile.name


def _resolve_room_type(resort_property: str, code: str | None) -> str | None:
	"""Best-effort room type resolution — matches by room_type_code first, then
	by room_type_name (case-insensitive contains). Returns None if no match;
	convert refuses when None."""
	if not code:
		return None
	# Exact code match.
	rt = frappe.db.get_value("Room Type", {"room_type_code": code, "resort_property": resort_property}, "name")
	if rt:
		return rt
	# Global exact code.
	rt = frappe.db.get_value("Room Type", {"room_type_code": code}, "name")
	if rt:
		return rt
	# Case-insensitive name contains — last-ditch (helps with human-typed manual entries).
	rows = frappe.get_all(
		"Room Type",
		fields=["name", "room_type_name"],
		limit_page_length=25,
	)
	for r in rows:
		if r["room_type_name"] and code.lower() in r["room_type_name"].lower():
			return r["name"]
	return None


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


@frappe.whitelist()
def list_inbox(
	state: str | list[str] | None = None,
	source: str | None = None,
	resort_property: str | None = None,
	search: str | None = None,
	limit: int = 100,
) -> dict:
	"""OTA inbox listing. Newest first. Counts per state for the KPI strip."""
	_require_ota_role()
	filters: dict = {}
	if state:
		if isinstance(state, str):
			state = json.loads(state) if state.startswith("[") else [state]
		filters["state"] = ["in", state]
	if source:
		filters["source"] = source
	if resort_property:
		filters["resort_property"] = resort_property
	names = frappe.get_all(
		"OTA Reservation Message",
		filters=filters,
		pluck="name",
		order_by="received_at desc",
		limit_page_length=limit,
	)
	messages = [_message_dict(frappe.get_doc("OTA Reservation Message", n)) for n in names]
	if search:
		needle = search.strip().lower()
		messages = [
			m for m in messages
			if needle in (m["external_id"] or "").lower()
			or needle in (m["parsed_guest_name"] or "").lower()
			or needle in (m["parsed_email"] or "").lower()
		]

	all_counts = frappe.db.sql(
		"""
		SELECT state, COUNT(*) AS n
		FROM `tabOTA Reservation Message`
		GROUP BY state
		""",
		as_dict=True,
	)
	counts = {"New": 0, "Converted": 0, "Rejected": 0, "Dead-letter": 0}
	for r in all_counts:
		counts[r["state"]] = r["n"]

	return _envelope(
		{
			"messages": messages,
			"counts": counts,
			"sources": list(ADAPTERS.keys()),
		}
	)


@frappe.whitelist()
def get_message(name: str) -> dict:
	"""Full detail + duplicate hints for the Review sheet."""
	_require_ota_role()
	if not frappe.db.exists("OTA Reservation Message", name):
		frappe.throw(_("Unknown OTA message: {0}").format(name))
	doc = frappe.get_doc("OTA Reservation Message", name)
	return _envelope(
		{
			"message": _message_dict(doc),
			"raw_payload": doc.raw_payload,
			"similar_reservations": _find_similar_reservations(doc),
		}
	)


# ---------------------------------------------------------------------------
# Writes — ingest
# ---------------------------------------------------------------------------


@frappe.whitelist()
def ingest_payload(
	source: str,
	payload: str,
	filename: str | None = None,
	resort_property: str | None = None,
) -> dict:
	"""Parse `payload` (CSV or JSON string) via the source's adapter and
	persist each row as an OTA Reservation Message. Returns a batch summary.

	File-level idempotency: a re-upload of the same payload returns the
	prior batch verbatim (not a warning, a literal reuse).

	Row-level idempotency: within a batch, rows with a (source, external_id)
	already present skip (duplicate_count++). Rows that raise on insert are
	saved as Dead-letter with the error message.
	"""
	_require_write_role()
	if source not in ADAPTERS:
		frappe.throw(_("Unknown OTA source: {0}").format(source))
	if not payload or not payload.strip():
		frappe.throw(_("Empty payload."))

	digest = _payload_hash(payload)
	existing_batch = frappe.db.get_value("OTA Ingest Batch", {"payload_hash": digest}, "name")
	if existing_batch:
		batch = frappe.get_doc("OTA Ingest Batch", existing_batch)
		return _envelope(
			{
				"batch": batch.name,
				"row_count": batch.row_count,
				"success_count": batch.success_count,
				"duplicate_count": batch.duplicate_count,
				"dead_letter_count": batch.dead_letter_count,
				"reused": True,
			}
		)

	rows = _parse_rows(source, payload)
	if not rows:
		frappe.throw(_("No parseable rows found in payload."))

	adapter = get_adapter(source)
	batch = frappe.get_doc(
		{
			"doctype": "OTA Ingest Batch",
			"source": source,
			"filename": filename,
			"uploaded_at": now_datetime(),
			"uploaded_by": frappe.session.user,
			"payload_hash": digest,
			"row_count": len(rows),
			"success_count": 0,
			"duplicate_count": 0,
			"dead_letter_count": 0,
		}
	)
	batch.flags.ignore_permissions = True
	batch.insert()

	success = 0
	duplicates = 0
	dead_letters = 0
	dead_letter_notes: list[str] = []
	for i, row in enumerate(rows, start=1):
		parsed: dict = {}
		try:
			parsed = adapter(row) or {}
		except Exception as exc:
			dead_letters += 1
			dead_letter_notes.append(f"Row {i}: adapter raised {type(exc).__name__}: {exc}")
			continue
		external_id = parsed.get("external_id")
		if not external_id:
			dead_letters += 1
			dead_letter_notes.append(f"Row {i}: missing external_id")
			continue

		if frappe.db.exists("OTA Reservation Message", {"source": source, "external_id": external_id}):
			duplicates += 1
			continue

		msg_payload = {
			"doctype": "OTA Reservation Message",
			"resort_property": resort_property,
			"source": source,
			"external_id": external_id,
			"state": "New",
			"received_at": now_datetime(),
			"batch": batch.name,
			"raw_payload": json.dumps(row),
			**{k: v for k, v in parsed.items() if k != "external_id"},
		}
		try:
			msg = frappe.get_doc(msg_payload)
			msg.flags.ignore_permissions = True
			msg.insert()
			success += 1
		except Exception as exc:
			dead_letters += 1
			dead_letter_notes.append(f"Row {i} ({external_id}): insert raised {type(exc).__name__}: {exc}")
			# Persist a Dead-letter placeholder so the row is auditable.
			try:
				frappe.get_doc(
					{
						"doctype": "OTA Reservation Message",
						"source": source,
						"external_id": external_id,
						"state": "Dead-letter",
						"received_at": now_datetime(),
						"batch": batch.name,
						"raw_payload": json.dumps(row),
						"dead_letter_error": str(exc),
					}
				).insert(ignore_permissions=True)
			except Exception:
				pass

	batch.success_count = success
	batch.duplicate_count = duplicates
	batch.dead_letter_count = dead_letters
	if dead_letter_notes:
		batch.notes = "\n".join(dead_letter_notes)
	batch.flags.ignore_permissions = True
	batch.save()
	frappe.db.commit()

	return _envelope(
		{
			"batch": batch.name,
			"row_count": len(rows),
			"success_count": success,
			"duplicate_count": duplicates,
			"dead_letter_count": dead_letters,
			"reused": False,
		}
	)


# ---------------------------------------------------------------------------
# Writes — convert / reject
# ---------------------------------------------------------------------------


@frappe.whitelist()
def convert_to_reservation(name: str, resort_property: str | None = None) -> dict:
	"""Mint a Reservation from a New OTA message.

	Refuses when:
	  · state != 'New'
	  · resort_property can't be resolved
	  · a Reservation already carries source_reference = external_id (hard dupe)
	  · room type can't be resolved from parsed_room_type_code
	  · arrival/departure invalid (departure not after arrival)
	"""
	_require_write_role()
	if not frappe.db.exists("OTA Reservation Message", name):
		frappe.throw(_("Unknown OTA message: {0}").format(name))
	doc = frappe.get_doc("OTA Reservation Message", name)
	if doc.state != "New":
		frappe.throw(_("Cannot convert an OTA message in state {0}.").format(doc.state))

	# Property fallback.
	prop = resort_property or doc.resort_property or frappe.db.get_value("Resort Property", {"is_active": 1}, "name") or frappe.db.get_value("Resort Property", {}, "name")
	if not prop:
		frappe.throw(_("No resort property could be resolved."))

	# Refuse if the external_id already produced a Reservation.
	dup = frappe.db.get_value("Reservation", {"source_reference": doc.external_id}, "name")
	if dup:
		frappe.throw(_("A Reservation for external_id {0} already exists: {1}").format(doc.external_id, dup))

	# Dates.
	if not doc.parsed_arrival or not doc.parsed_departure:
		frappe.throw(_("Arrival / Departure dates missing on OTA message."))
	if getdate(doc.parsed_departure) <= getdate(doc.parsed_arrival):
		frappe.throw(_("Departure must be after arrival on the OTA message."))

	# Room type.
	room_type = _resolve_room_type(prop, doc.parsed_room_type_code)
	if not room_type:
		frappe.throw(
			_("Could not resolve room type from code {0}. Add a mapping and retry.").format(doc.parsed_room_type_code)
		)

	# Guest profile.
	profile = _get_or_create_guest_profile(doc)

	# Mint the Reservation.
	reservation = frappe.get_doc(
		{
			"doctype": "Reservation",
			"resort_property": prop,
			"status": "Confirmed",
			"booking_source": "OTA",
			"source_reference": doc.external_id,
			"arrival_date": doc.parsed_arrival,
			"departure_date": doc.parsed_departure,
			"currency": doc.parsed_currency or "INR",
			"staying_guest_profile": profile,
			"confirmed_at": now_datetime(),
			"guests": (
				[
					{
						"guest_profile": profile,
						"guest_name": doc.parsed_guest_name,
						"guest_type": "Adult",
						"is_primary_guest": 1,
					}
				]
				if profile
				else []
			),
			"rooms": [
				{
					"room_type": room_type,
					"adults": doc.parsed_adults or 2,
					"children": doc.parsed_children or 0,
					"status": "Confirmed",
				}
			],
			"total_estimated_amount": flt(doc.parsed_total),
			"internal_notes": f"Ingested from OTA {doc.source} · {doc.external_id}\n{doc.notes or ''}",
		}
	)
	reservation.flags.ignore_permissions = True
	reservation.insert()

	doc.state = "Converted"
	doc.converted_reservation = reservation.name
	doc.processed_at = now_datetime()
	doc.flags.ignore_permissions = True
	doc.save()

	# Notify Reservation Agents so the front desk sees it appear.
	try:
		from the_reezort.staff.notify_api import notify_role

		notify_role(
			role="Reservation Agent",
			subject=_("OTA · {0} converted → {1}").format(doc.source, reservation.name),
			body=_("{0} · Arr {1} → Dep {2}").format(
				doc.parsed_guest_name or "(unknown)", doc.parsed_arrival, doc.parsed_departure
			),
			link=f"#/reservations/{reservation.name}",
			dedupe_key=f"ota-convert:{doc.name}",
		)
	except Exception:
		pass

	frappe.db.commit()
	return _envelope({"message": _message_dict(doc), "reservation": reservation.name})


@frappe.whitelist()
def reject_message(name: str, reason: str) -> dict:
	_require_write_role()
	if not frappe.db.exists("OTA Reservation Message", name):
		frappe.throw(_("Unknown OTA message: {0}").format(name))
	if not reason or not str(reason).strip():
		frappe.throw(_("A rejection reason is required."))
	doc = frappe.get_doc("OTA Reservation Message", name)
	if doc.state != "New":
		frappe.throw(_("Cannot reject an OTA message in state {0}.").format(doc.state))
	doc.state = "Rejected"
	doc.rejection_reason = reason
	doc.processed_at = now_datetime()
	doc.flags.ignore_permissions = True
	doc.save()
	frappe.db.commit()
	return _envelope({"message": _message_dict(doc)})


# ---------------------------------------------------------------------------
# Scheduler — hourly dead-letter retry
# ---------------------------------------------------------------------------


def retry_dead_letter() -> int:
	"""Re-parse Dead-letter rows via the source adapter. If parse now
	succeeds, transition to New so a human can review. Returns count reset."""
	rows = frappe.get_all(
		"OTA Reservation Message",
		filters={"state": "Dead-letter"},
		fields=["name", "source", "raw_payload"],
	)
	reset = 0
	for row in rows:
		try:
			payload = json.loads(row.raw_payload or "{}")
			adapter = get_adapter(row.source)
			parsed = adapter(payload) or {}
			if not parsed.get("external_id"):
				continue
			doc = frappe.get_doc("OTA Reservation Message", row.name)
			for k, v in parsed.items():
				doc.set(k, v)
			doc.state = "New"
			doc.dead_letter_error = None
			doc.flags.ignore_permissions = True
			doc.save()
			reset += 1
		except Exception:
			continue
	frappe.db.commit()
	return reset
