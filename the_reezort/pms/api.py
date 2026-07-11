"""PMS Stay Lifecycle (003) — the full check-in process.

The arrival journey, end to end:
  context -> ID/KYC capture -> registration card -> room assignment ->
  before-stay condition photos -> deposit -> finalize check-in.

`get_check_in_context` is the single read the front-desk screen drives off; the
save_* endpoints persist each step; `finalize_check_in` enforces the legal gate
(verified KYC + signed registration card) and lands the Stay + folio + room.
Deposits reuse billing.deposits; condition photos reuse capture_room_condition.
No ERPNext financial documents are created here (the deposit PE lives in billing).
"""

import frappe
from frappe import _
from frappe.utils import now, today, getdate, date_diff, flt, cint

from the_reezort.billing.api import get_or_create_folio
from the_reezort.reservation.api import _room_rate, ROOM_ITEM_BY_CODE
from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import as_list as _as_list
from the_reezort.utils import require_permission as _require_permission

CHECK_IN_ELIGIBLE_RESERVATION_STATUSES = {"Confirmed", "Modified", "Checked In"}
ACTIVE_STAY_STATUSES = ("Draft", "Reserved", "Due In", "In House", "Due Out", "Checked Out")


def _primary_guest_name(reservation_doc):
	if reservation_doc.staying_guest_profile:
		name = frappe.db.get_value("Guest Profile", reservation_doc.staying_guest_profile, "guest_full_name")
		if name:
			return name

	for row in reservation_doc.get("guests") or []:
		if row.guest_name:
			return row.guest_name

	return "Guest"


# A room is ready to receive a guest only once housekeeping has cleared it.
# A just-departed room is Vacant + Dirty; it must not be re-assigned (or re-enter
# sellable inventory) until cleaned, unless the property policy allows it.
READY_HOUSEKEEPING_STATUSES = ("Clean", "Inspected")


def _allocation_housekeeping_filter(property_name):
	"""housekeeping_status filter for allocation, honoring the property's
	allow_dirty_allocation_default from Property Settings.

	Falls back to Resort Property.allow_dirty_room_allocation when no Property
	Settings record exists yet (backward-compatible for existing deployments).
	Returns None when no filter should be applied (dirty rooms allowed).
	"""
	from the_reezort.the_reezort.doctype.property_settings.property_settings import (
		_get_setting_or_none as _ps_setting_or_none,
	)

	allow_dirty = _ps_setting_or_none(property_name, "allow_dirty_allocation_default")
	if allow_dirty is None:
		# No Property Settings record yet — fall back to the legacy Resort Property flag.
		allow_dirty = frappe.db.get_value(
			"Resort Property", property_name, "allow_dirty_room_allocation"
		)
	if allow_dirty:
		return None
	return ["in", list(READY_HOUSEKEEPING_STATUSES)]


def _resolve_vacant_room(property_name, room_type):
	filters = {
		"resort_property": property_name,
		"room_type": room_type,
		"sellable_status": "Sellable",
		"occupancy_status": "Vacant",
		"is_active": 1,
	}
	hk = _allocation_housekeeping_filter(property_name)
	if hk:
		filters["housekeeping_status"] = hk
	return frappe.db.get_value("Room", filters, "name")


def _available_rooms(property_name, room_type):
	"""All vacant, sellable, housekeeping-ready rooms of a type — the picker's options."""
	filters = {
		"resort_property": property_name,
		"room_type": room_type,
		"sellable_status": "Sellable",
		"occupancy_status": "Vacant",
		"is_active": 1,
	}
	hk = _allocation_housekeeping_filter(property_name)
	if hk:
		filters["housekeeping_status"] = hk
	return frappe.get_all(
		"Room",
		filters=filters,
		fields=["name", "room_number", "room_name", "housekeeping_status"],
		order_by="room_number asc",
	)


KYC_FIELDS = (
	"date_of_birth", "nationality", "address",
	"id_type", "id_number", "id_expiry", "id_document", "id_name",
)

# Below this match score the name on the ID is treated as not matching the
# reservation, and KYC verification requires a manager override reason.
NAME_MATCH_THRESHOLD = 80


def _normalize_name(value):
	import re

	value = (value or "").lower().strip()
	value = re.sub(r"\b(mr|mrs|ms|dr|shri|smt|kum|m/s)\.?\b", " ", value)
	value = re.sub(r"[^a-z0-9 ]", " ", value)
	return " ".join(sorted(t for t in value.split() if t))


def _name_match_score(a, b):
	"""0-100 similarity between two names (token overlap vs sequence ratio, stronger wins)."""
	import difflib

	na, nb = _normalize_name(a), _normalize_name(b)
	if not na or not nb:
		return 0
	ta, tb = set(na.split()), set(nb.split())
	jaccard = len(ta & tb) / len(ta | tb) if (ta | tb) else 0
	seq = difflib.SequenceMatcher(None, na, nb).ratio()
	return round(max(jaccard, seq) * 100)


def _reservation_guest_name(reservation_doc):
	"""The booking name to match the ID against."""
	if reservation_doc.staying_guest_profile:
		name = frappe.db.get_value("Guest Profile", reservation_doc.staying_guest_profile, "guest_full_name")
		if name:
			return name
	return _primary_guest_name(reservation_doc)


def _name_match(reservation_doc, id_name):
	"""Match status of the name on the ID against the reservation's booking name."""
	booking_name = _reservation_guest_name(reservation_doc)
	score = _name_match_score(id_name or booking_name, booking_name)
	if score >= NAME_MATCH_THRESHOLD:
		status = "match"
	elif score >= 60:
		status = "review"
	else:
		status = "mismatch"
	return {"id_name": id_name, "reservation_name": booking_name, "score": score, "status": status}


def _guest_context(guest_profile):
	"""Guest identity + KYC snapshot for the check-in screen (None if no profile)."""
	if not guest_profile or not frappe.db.exists("Guest Profile", guest_profile):
		return None
	g = frappe.db.get_value(
		"Guest Profile",
		guest_profile,
		[
			"name", "guest_full_name", "email", "phone", "image",
			"date_of_birth", "nationality", "address",
			"id_type", "id_number", "id_expiry", "id_document", "id_name",
			"kyc_verified", "kyc_verified_by", "kyc_verified_at",
			"name_match_score", "kyc_override_reason",
		],
		as_dict=True,
	)
	return g


def _registration_card_data(doc):
	return {
		"name": doc.name,
		"reservation": doc.reservation,
		"stay": doc.stay,
		"guest_profile": doc.guest_profile,
		"guest_full_name": doc.guest_full_name,
		"id_type": doc.id_type,
		"id_number": doc.id_number,
		"nationality": doc.nationality,
		"date_of_birth": doc.date_of_birth,
		"address": doc.address,
		"purpose_of_visit": doc.purpose_of_visit,
		"arrival_from": doc.arrival_from,
		"vehicle_number": doc.vehicle_number,
		"expected_departure": doc.expected_departure,
		"adults": doc.adults,
		"children": doc.children,
		"terms_accepted": doc.terms_accepted,
		"signature": doc.signature,
		"signed_at": doc.signed_at,
		"registered_by": doc.registered_by,
		"is_signed": bool(doc.signature and doc.terms_accepted),
	}


def _deposit_context(folio_name):
	"""Deposit/payment summary for a folio (None if no folio yet)."""
	if not folio_name:
		return None
	folio = frappe.db.get_value(
		"Guest Folio", folio_name,
		["name", "total_paid", "outstanding_amount", "total_charges", "folio_status"],
		as_dict=True,
	)
	if not folio:
		return None
	deposits = frappe.get_all(
		"Folio Line",
		filters={"guest_folio": folio_name, "line_type": "Deposit Application"},
		fields=["name", "amount", "description", "erpnext_payment_entry", "service_date"],
		order_by="creation asc",
	)
	folio["deposits"] = deposits
	folio["deposit_total"] = sum(flt(d.amount) for d in deposits)
	return folio


def _post_accommodation_charge(stay_doc, folio_name):
	"""Post the room/accommodation charge to the folio (idempotent per stay).

	Without this the folio has no room revenue and checkout settles ₹0 for the
	stay. The line carries the room type's ERPNext item so settlement invoices it
	with GST. extend_stay tops this same charge up for extra nights.
	"""
	if not folio_name:
		return None
	key = f"room-charge:{stay_doc.name}"
	existing = frappe.db.get_value("Folio Line", {"idempotency_key": key}, "name")
	if existing:
		return existing

	nights = date_diff(stay_doc.departure_date, stay_doc.arrival_date) or 1
	per_night = flt(_room_rate(stay_doc.room_type, 1))
	if per_night <= 0:
		return None
	rt = frappe.db.get_value(
		"Room Type", stay_doc.room_type, ["erpnext_item", "room_type_name", "room_type_code"], as_dict=True
	) or {}
	item_code = rt.get("erpnext_item") or ROOM_ITEM_BY_CODE.get(rt.get("room_type_code"))

	amount = nights * per_night
	line = frappe.get_doc(
		{
			"doctype": "Folio Line",
			"guest_folio": folio_name,
			"line_type": "Charge",
			"source_module": "Room",
			"source_doctype": "Stay",
			"source_name": stay_doc.name,
			"idempotency_key": key,
			"service_date": today(),
			"item_code": item_code,
			"qty": nights,
			"rate": per_night,
			"amount": amount,
			"tax_treatment": "Standard",
			"description": f"Accommodation: {rt.get('room_type_name') or stay_doc.room_type} × {nights} night(s)",
		}
	)
	line.insert(ignore_permissions=True)

	# Estimated GST so the folio's outstanding reflects the tax-inclusive amount
	# before the invoice is posted (the authoritative tax lands on the SI at settle).
	_post_tax_estimate(stay_doc, folio_name, amount)
	return line.name


def _post_tax_estimate(stay_doc, folio_name, taxable_amount):
	"""Post/refresh a Tax Preview folio line estimating GST on the accommodation charge."""
	from the_reezort.billing.erpnext_posting import default_sales_tax_rate

	key = f"room-tax:{stay_doc.name}"
	if frappe.db.get_value("Folio Line", {"idempotency_key": key}, "name"):
		return
	company = frappe.db.get_value("Guest Folio", folio_name, "company")
	rate_pct = default_sales_tax_rate(company) if company else 0
	if rate_pct <= 0:
		return
	tax_amount = flt(taxable_amount) * rate_pct / 100.0
	frappe.get_doc(
		{
			"doctype": "Folio Line",
			"guest_folio": folio_name,
			"line_type": "Tax Preview",
			"source_module": "Room",
			"source_doctype": "Stay",
			"source_name": stay_doc.name,
			"idempotency_key": key,
			"service_date": today(),
			"qty": 1,
			"rate": tax_amount,
			"amount": tax_amount,
			"tax_treatment": "Standard",
			"description": f"Estimated GST @ {rate_pct:g}%",
		}
	).insert(ignore_permissions=True)


ROOM_MOVE_REASONS = {"Maintenance", "Guest Request", "Upgrade", "Downgrade", "Overbooking", "Other"}


@frappe.whitelist()
def list_vacant_rooms_for_move(stay):
	"""All vacant + sellable + active rooms in the stay's property, excluding the current one."""
	_require_permission("Stay", "read")
	stay_doc = frappe.db.get_value("Stay", stay, ["resort_property", "current_room"], as_dict=True)
	if not stay_doc:
		frappe.throw(_("Stay {0} does not exist.").format(stay))
	rooms = frappe.get_all(
		"Room",
		filters={
			"resort_property": stay_doc.resort_property,
			"occupancy_status": "Vacant",
			"sellable_status": "Sellable",
			"is_active": 1,
			"name": ["!=", stay_doc.current_room],
		},
		fields=["name", "room_number", "room_name", "room_type", "housekeeping_status"],
		order_by="room_number asc",
	)
	return {"rooms": rooms}


def _validate_target_room(stay_doc, to_room):
	if to_room == stay_doc.current_room:
		frappe.throw(_("Target room is the same as the current room."))
	target = frappe.db.get_value(
		"Room", to_room,
		["name", "resort_property", "occupancy_status", "sellable_status", "is_active", "room_number", "room_name"],
		as_dict=True,
	)
	if not target:
		frappe.throw(_("Target room {0} does not exist.").format(to_room))
	if target.resort_property != stay_doc.resort_property:
		frappe.throw(_("Target room belongs to a different property."))
	if not target.is_active:
		frappe.throw(_("Target room is not active."))
	if target.occupancy_status != "Vacant":
		frappe.throw(_("Target room {0} is not vacant (status {1}).").format(to_room, target.occupancy_status))
	if target.sellable_status != "Sellable":
		frappe.throw(_("Target room {0} is not sellable.").format(to_room))
	return target


@frappe.whitelist()
def move_guest_room(stay, to_room, reason, notes=None, source_out_of_order=0):
	"""Move an in-house guest to a different room.

	Use case: sudden electrical issue, guest preference, upgrade, etc.
	Source room → Vacant + Dirty (or also Out of Order + Not Sellable if flagged).
	Target room → Occupied. Stay's current_room updates. The folio carries over
	(linked to stay, not room). An audit Room Move is logged. When the source is
	flagged Out of Order, a maintenance Housekeeping Task is auto-created.
	Idempotent stay-state guard: refuses to move a non-in-house stay.
	"""
	_require_permission("Stay", "write")
	if reason not in ROOM_MOVE_REASONS:
		frappe.throw(_("Invalid move reason {0}.").format(reason))

	stay_doc = frappe.get_doc("Stay", stay)
	if stay_doc.stay_status not in ("In House", "Due Out"):
		frappe.throw(_("Only an in-house stay can be moved (status is {0}).").format(stay_doc.stay_status))
	if not stay_doc.current_room:
		frappe.throw(_("Stay has no current room to move from."))

	from_room = stay_doc.current_room
	target = _validate_target_room(stay_doc, to_room)
	ooo = str(source_out_of_order) in ("1", "true", "True")

	# Source room: free occupancy, mark dirty; if OOO also flag maintenance + block sales.
	source_updates = {"occupancy_status": "Vacant", "housekeeping_status": "Dirty"}
	if ooo:
		source_updates["maintenance_status"] = "Out of Order"
		source_updates["sellable_status"] = "Not Sellable"
	frappe.db.set_value("Room", from_room, source_updates)

	# Target room: occupied.
	frappe.db.set_value("Room", to_room, "occupancy_status", "Occupied")

	# Stay points at the new room.
	frappe.db.set_value("Stay", stay, "current_room", to_room)

	# Reservation's first room row mirrors the assignment so screens stay consistent.
	if stay_doc.reservation:
		res = frappe.get_doc("Reservation", stay_doc.reservation)
		if res.rooms:
			res.rooms[0].room = to_room
			res.save(ignore_permissions=True)

	# Auto-create a maintenance Housekeeping Task when source is OOO (engineering signal).
	maintenance_task = None
	if ooo and frappe.db.exists("DocType", "Housekeeping Task"):
		key = f"room-move-ooo:{stay}:{from_room}"
		existing = frappe.db.get_value("Housekeeping Task", {"idempotency_key": key}, "name")
		if existing:
			maintenance_task = existing
		else:
			rp, building, floor = frappe.db.get_value("Room", from_room, ["resort_property", "building", "floor"])
			maintenance_task = frappe.get_doc(
				{
					"doctype": "Housekeeping Task",
					"resort_property": rp or stay_doc.resort_property,
					"room": from_room,
					"building": building,
					"floor": floor,
					"task_type": "Maintenance Follow-up",
					"task_status": "Queued",
					"priority": "High",
					"requires_inspection": 1,
					"dnd_status": "None",
					"stay": stay,
					"source_doctype": "Room Move",
					"source_name": stay,
					"idempotency_key": key,
				}
			).insert(ignore_permissions=True).name

	# Audit record.
	move = frappe.get_doc(
		{
			"doctype": "Room Move",
			"resort_property": stay_doc.resort_property,
			"stay": stay,
			"reservation": stay_doc.reservation,
			"guest_name": stay_doc.primary_guest_name,
			"from_room": from_room,
			"to_room": to_room,
			"reason": reason,
			"source_out_of_order": 1 if ooo else 0,
			"notes": notes,
			"moved_by": frappe.session.user,
			"moved_at": now(),
			"maintenance_task": maintenance_task,
		}
	).insert(ignore_permissions=True)

	frappe.db.commit()
	return {
		"move": move.name,
		"stay": stay,
		"from_room": from_room,
		"to_room": to_room,
		"source_out_of_order": bool(ooo),
		"maintenance_task": maintenance_task,
		"target_room_number": target.room_number,
		"target_room_name": target.room_name,
	}


def _ensure_guest_profile(reservation_doc):
	"""Create a Guest Profile from the reservation's primary guest and link it back."""
	primary = None
	for row in reservation_doc.get("guests") or []:
		if row.is_primary_guest:
			primary = row
			break
	primary = primary or (reservation_doc.guests[0] if reservation_doc.get("guests") else None)

	guest = frappe.get_doc(
		{
			"doctype": "Guest Profile",
			"guest_full_name": (primary.guest_name if primary else None) or _primary_guest_name(reservation_doc),
			"email": primary.email if primary else None,
			"phone": primary.phone if primary else None,
			"nationality": (primary.nationality if primary else None) or "Indian",
			"erpnext_customer": reservation_doc.erpnext_customer,
		}
	)
	guest.insert(ignore_permissions=True)
	frappe.db.set_value("Reservation", reservation_doc.name, "staying_guest_profile", guest.name)
	reservation_doc.staying_guest_profile = guest.name
	return guest.name


def _condition_capture_data(doc):
	return {
		"name": doc.name,
		"resort_property": doc.resort_property,
		"stay": doc.stay,
		"room": doc.room,
		"capture_stage": doc.capture_stage,
		"captured_by": doc.captured_by,
		"captured_at": doc.captured_at,
		"overall_condition": doc.overall_condition,
		"notes": doc.notes,
		"photos": [
			{"image": row.image, "caption": row.caption, "area": row.area}
			for row in doc.get("photos")
		],
	}


@frappe.whitelist()
def check_in(reservation, room=None, arrival_time=None):
	"""Check a confirmed reservation in: create the Stay and open its folio."""
	_require_permission("Stay", "create")

	reservation_doc = frappe.get_doc("Reservation", reservation)

	# Idempotent: reuse an existing active stay for this reservation.
	existing_stay = frappe.db.get_value(
		"Stay",
		{"reservation": reservation, "stay_status": ["in", ACTIVE_STAY_STATUSES]},
		"name",
	)
	if existing_stay:
		stay = frappe.get_doc("Stay", existing_stay)
		folio = get_or_create_folio(stay=stay.name, customer=stay.customer)
		folio_name = folio["data"]["folio"]["name"]
		_post_accommodation_charge(stay, folio_name)
		frappe.db.commit()
		return {
			"stay": stay.name,
			"stay_status": stay.stay_status,
			"folio": folio_name,
			"current_room": stay.current_room,
			"reused": True,
		}

	if reservation_doc.status not in CHECK_IN_ELIGIBLE_RESERVATION_STATUSES:
		frappe.throw(_("Reservation must be confirmed before check-in (status is {0}).").format(reservation_doc.status))

	if not reservation_doc.rooms:
		frappe.throw(_("Reservation has no rooms to check in."))

	first_room = reservation_doc.rooms[0]
	room_type = first_room.room_type

	# Open the folio from the reservation first — this resolves and caches the customer.
	folio_result = get_or_create_folio(reservation=reservation)
	folio_name = folio_result["data"]["folio"]["name"]
	customer = frappe.db.get_value("Reservation", reservation, "erpnext_customer") or folio_result["data"]["folio"][
		"customer"
	]

	resolved_room = room or _resolve_vacant_room(reservation_doc.resort_property, room_type)
	if not resolved_room:
		frappe.throw(_("No vacant sellable room is available for room type {0}.").format(room_type))

	adult_count = sum(int(r.adults or 0) for r in reservation_doc.rooms) or 1
	child_count = sum(int(r.children or 0) for r in reservation_doc.rooms)

	stay = frappe.get_doc(
		{
			"doctype": "Stay",
			"resort_property": reservation_doc.resort_property,
			"reservation": reservation,
			"customer": customer,
			"primary_guest_name": _primary_guest_name(reservation_doc),
			"stay_status": "In House",
			"arrival_date": reservation_doc.arrival_date,
			"arrival_time": arrival_time,
			"departure_date": reservation_doc.departure_date,
			"room_type": room_type,
			"current_room": resolved_room,
			"adult_count": adult_count,
			"child_count": child_count,
			"folio_status": "Active",
		}
	)
	stay.insert(ignore_permissions=True)

	# Link the primary folio to the new stay and mark the room occupied.
	frappe.db.set_value("Guest Folio", folio_name, "stay", stay.name)
	frappe.db.set_value("Room", resolved_room, "occupancy_status", "Occupied")

	# Post the accommodation charge so the folio carries room revenue for checkout.
	_post_accommodation_charge(stay, folio_name)

	# Advance the reservation and its first room row. Reload first: opening the
	# folio above may have cached the customer on the reservation and committed.
	reservation_doc.reload()
	reservation_doc.rooms[0].room = resolved_room
	reservation_doc.rooms[0].status = "Checked In"
	reservation_doc.status = "Checked In"
	reservation_doc.save(ignore_permissions=True)

	frappe.db.commit()

	return {
		"stay": stay.name,
		"stay_status": stay.stay_status,
		"folio": folio_name,
		"current_room": resolved_room,
		"reused": False,
	}


# ---------- full check-in process (003) ----------


@frappe.whitelist()
def get_check_in_context(reservation):
	"""Everything the front-desk check-in screen needs, in one read.

	Drives the stepper: guest + KYC, room options, registration card, deposit
	status, before-stay photos, and a readiness checklist gating finalize.
	"""
	_require_permission("Stay", "read")
	res = frappe.get_doc("Reservation", reservation)

	guest_profile = res.staying_guest_profile
	guest = _guest_context(guest_profile)

	room_type = res.rooms[0].room_type if res.rooms else None
	available = _available_rooms(res.resort_property, room_type) if room_type else []

	# Existing stay (re-entering an in-progress / completed check-in)?
	stay = frappe.db.get_value(
		"Stay",
		{"reservation": reservation, "stay_status": ["in", ACTIVE_STAY_STATUSES]},
		["name", "current_room", "stay_status"],
		as_dict=True,
	)

	folio = frappe.db.get_value(
		"Guest Folio", {"reservation": reservation}, "name"
	) or (frappe.db.get_value("Guest Folio", {"stay": stay.name}, "name") if stay else None)

	card_name = frappe.db.get_value("Guest Registration Card", {"reservation": reservation}, "name")
	card = _registration_card_data(frappe.get_doc("Guest Registration Card", card_name)) if card_name else None

	captures = frappe.get_all(
		"Room Condition Capture",
		filters={"stay": stay.name, "capture_stage": "Check-In"} if stay else {"name": ["is", "not set"]},
		fields=["name"],
	) if stay else []

	nights = date_diff(res.departure_date, res.arrival_date) if res.arrival_date and res.departure_date else None

	readiness = {
		"kyc": bool(guest and guest.get("kyc_verified")),
		"registration": bool(card and card.get("is_signed")),
		"room_selected": bool(stay and stay.get("current_room")) or len(available) > 0,
		"photos": len(captures) > 0,
		"deposit": bool((_deposit_context(folio) or {}).get("deposit_total")),
	}
	# Finalize gate: verified KYC + a signed registration card. Photos/deposit are
	# strongly recommended but not legally blocking (resort policy can tighten this).
	readiness["can_finalize"] = readiness["kyc"] and readiness["registration"] and readiness["room_selected"]

	return {
		"reservation": res.name,
		"status": res.status,
		"resort_property": res.resort_property,
		"room_type": room_type,
		"room_type_name": frappe.db.get_value("Room Type", room_type, "room_type_name") if room_type else None,
		"arrival_date": res.arrival_date,
		"departure_date": res.departure_date,
		"nights": nights,
		"guest_profile": guest_profile,
		"guest": guest,
		"available_rooms": available,
		"registration_card": card,
		"folio": folio,
		"deposit": _deposit_context(folio),
		"condition_capture": {"check_in_done": len(captures) > 0, "count": len(captures)},
		"stay": stay,
		"name_match": _name_match(res, guest.get("id_name") if guest else None),
		"readiness": readiness,
	}


@frappe.whitelist()
def save_guest_kyc(reservation, kyc, verify=0, override_reason=None):
	"""Persist ID/KYC + identity onto the reservation's guest profile.

	Creates the guest profile from the reservation if it has none yet. `verify=1`
	stamps the KYC as verified. The name on the ID is matched against the
	reservation's booking name — on a mismatch, verification is refused unless a
	manager `override_reason` is supplied (which is recorded for audit).
	"""
	_require_permission("Guest Profile", "write")
	kyc = _as_dict(kyc)
	res = frappe.get_doc("Reservation", reservation)

	guest_profile = res.staying_guest_profile
	if not guest_profile:
		guest_profile = _ensure_guest_profile(res)

	guest = frappe.get_doc("Guest Profile", guest_profile)
	for field in KYC_FIELDS:
		if field in kyc and kyc.get(field) not in (None, ""):
			guest.set(field, kyc.get(field))

	match = _name_match(res, guest.id_name)
	guest.name_match_score = match["score"]

	if str(verify) in ("1", "true", "True"):
		if match["status"] == "mismatch" and not (override_reason or "").strip():
			frappe.throw(
				_("Name on ID '{0}' does not match the reservation '{1}' ({2}% match). A manager override reason is required to verify.").format(
					match["id_name"] or "—", match["reservation_name"], match["score"]
				),
				frappe.ValidationError,
			)
		if (override_reason or "").strip():
			guest.kyc_override_reason = override_reason.strip()
		guest.kyc_verified = 1
		guest.kyc_verified_by = frappe.session.user
		guest.kyc_verified_at = now()
	guest.save(ignore_permissions=True)

	# The ID scan is a private file — attach it to the Guest Profile so anyone with
	# permission to read the profile can view it (not just the uploader/System Manager).
	if kyc.get("id_document"):
		_attach_private_file(kyc.get("id_document"), "Guest Profile", guest.name)

	return {"guest_profile": guest.name, "guest": _guest_context(guest.name), "name_match": match}


def _attach_private_file(file_url, doctype, docname):
	"""Link an already-uploaded File to a document so private-file permission
	cascades from that document (and force it private if it isn't)."""
	name = frappe.db.get_value("File", {"file_url": file_url}, "name")
	if not name:
		return
	updates = {}
	f = frappe.db.get_value("File", name, ["attached_to_doctype", "attached_to_name", "is_private"], as_dict=True)
	if not f.attached_to_doctype:
		updates.update({"attached_to_doctype": doctype, "attached_to_name": docname})
	if not f.is_private:
		updates["is_private"] = 1
	if updates:
		frappe.db.set_value("File", name, updates)


@frappe.whitelist()
def save_registration_card(reservation, card):
	"""Create/update the per-reservation registration card (idempotent on reservation).

	Signing = terms_accepted + a signature image. Stamps signed_at/registered_by
	the first time it is signed.
	"""
	_require_permission("Stay", "create")
	card = _as_dict(card)
	res = frappe.get_doc("Reservation", reservation)

	existing = frappe.db.get_value("Guest Registration Card", {"reservation": reservation}, "name")
	doc = frappe.get_doc("Guest Registration Card", existing) if existing else frappe.new_doc("Guest Registration Card")

	doc.resort_property = res.resort_property
	doc.reservation = reservation
	doc.guest_profile = res.staying_guest_profile
	doc.guest_full_name = card.get("guest_full_name") or _primary_guest_name(res)
	for field in (
		"id_type", "id_number", "nationality", "date_of_birth", "address",
		"purpose_of_visit", "arrival_from", "vehicle_number", "expected_departure",
		"adults", "children", "signature",
	):
		if field in card:
			doc.set(field, card.get(field))
	doc.terms_accepted = 1 if card.get("terms_accepted") else 0

	# Snapshot the verified identity from the guest profile so the card stays a
	# self-contained legal record (independent of later profile edits).
	guest = _guest_context(res.staying_guest_profile)
	if guest:
		for field in ("id_type", "id_number", "nationality", "date_of_birth", "address"):
			if not doc.get(field) and guest.get(field):
				doc.set(field, guest.get(field))

	now_signed = bool(doc.signature and doc.terms_accepted)
	if now_signed and not doc.signed_at:
		doc.signed_at = now()
		doc.registered_by = frappe.session.user

	doc.save(ignore_permissions=True) if existing else doc.insert(ignore_permissions=True)
	return {"registration_card": _registration_card_data(doc)}


@frappe.whitelist()
def finalize_check_in(reservation, room=None, arrival_time=None, enforce=1):
	"""Complete check-in: enforce the legal gate, then land Stay + folio + room.

	Gate (when enforce=1): the guest's KYC must be verified and a signed
	registration card must exist. Then delegates to the `check_in` primitive and
	backfills the registration card with the created stay.
	"""
	_require_permission("Stay", "create")
	res = frappe.get_doc("Reservation", reservation)

	if str(enforce) in ("1", "true", "True"):
		guest = _guest_context(res.staying_guest_profile)
		if not (guest and guest.get("kyc_verified")):
			frappe.throw(_("KYC must be verified before check-in."))
		card_name = frappe.db.get_value("Guest Registration Card", {"reservation": reservation}, "name")
		card = frappe.get_doc("Guest Registration Card", card_name) if card_name else None
		if not (card and card.signature and card.terms_accepted):
			frappe.throw(_("A signed registration card is required before check-in."))

	result = check_in(reservation, room=room, arrival_time=arrival_time)

	# Backfill the registration card with the stay it belongs to.
	card_name = frappe.db.get_value("Guest Registration Card", {"reservation": reservation}, "name")
	if card_name and result.get("stay"):
		frappe.db.set_value("Guest Registration Card", card_name, "stay", result["stay"])
		frappe.db.commit()

	result["registration_card"] = card_name
	return result


@frappe.whitelist()
def capture_room_condition(stay, capture_stage, photos, overall_condition=None, notes=None):
	_require_permission("Room Condition Capture", "create")
	if capture_stage not in {"Check-In", "Check-Out"}:
		frappe.throw(_("Capture stage must be Check-In or Check-Out."))

	photos = _as_list(photos)
	if not photos:
		frappe.throw(_("At least one room condition photo is required."))

	existing = frappe.db.get_value(
		"Room Condition Capture",
		{"stay": stay, "capture_stage": capture_stage},
		"name",
		order_by="creation asc",
	)
	if existing:
		return {"capture": _condition_capture_data(frappe.get_doc("Room Condition Capture", existing)), "reused": True}

	stay_doc = frappe.get_doc("Stay", stay)
	if not stay_doc.current_room:
		frappe.throw(_("Stay must have a current room before condition capture."))

	capture = frappe.get_doc(
		{
			"doctype": "Room Condition Capture",
			"resort_property": stay_doc.resort_property,
			"stay": stay_doc.name,
			"room": stay_doc.current_room,
			"capture_stage": capture_stage,
			"captured_by": frappe.session.user,
			"captured_at": now(),
			"overall_condition": overall_condition,
			"notes": notes,
		}
	)
	for photo in photos:
		if isinstance(photo, str):
			photo = {"image": photo}
		capture.append(
			"photos",
			{
				"image": photo.get("image"),
				"caption": photo.get("caption"),
				"area": photo.get("area"),
			},
		)
	capture.insert(ignore_permissions=True)
	return {"capture": _condition_capture_data(capture), "reused": False}


@frappe.whitelist()
def get_room_condition_captures(stay):
	_require_permission("Room Condition Capture", "read")
	captures = frappe.get_all(
		"Room Condition Capture",
		filters={"stay": stay},
		fields=["name"],
		order_by="captured_at asc",
	)
	return {"captures": [_condition_capture_data(frappe.get_doc("Room Condition Capture", row.name)) for row in captures]}


@frappe.whitelist()
def check_out(stay):
	"""Check a stay out: close the folio side, free the room, and kick housekeeping.

	The spine of the back-half lifecycle. Requires the folio to be settled first
	(settlement already flips the stay to Checked Out and the room to "Checked Out").
	This then:
	  - confirms Stay = Checked Out,
	  - returns the room to Vacant + Dirty (sellable only after housekeeping),
	  - auto-creates a Departure Cleaning Housekeeping Task (requires inspection),
	  - leaves a check-out condition capture as the next action.
	Idempotent on the stay: re-running returns the same departure task.
	"""
	_require_permission("Stay", "write")
	stay_doc = frappe.get_doc("Stay", stay)
	if stay_doc.stay_status in ("Cancelled", "No Show"):
		frappe.throw(_("Stay {0} cannot be checked out (status {1}).").format(stay, stay_doc.stay_status))
	# Block only while the folio still has un-invoiced charges (open). An invoiced
	# folio — paid or on credit ("Ready for Settlement"/"Settled"/"Closed") — may check out.
	folio_status = frappe.db.get_value("Guest Folio", {"stay": stay}, "folio_status")
	if folio_status in ("Draft", "Open", "Under Review"):
		frappe.throw(_("Settle the folio before checkout (folio is {0}).").format(folio_status))

	room = stay_doc.current_room
	key = f"checkout-clean:{stay}"
	existing_task = frappe.db.get_value("Housekeeping Task", {"idempotency_key": key}, "name")

	frappe.db.set_value("Stay", stay, "stay_status", "Checked Out")

	task_name = existing_task
	if room:
		frappe.db.set_value("Room", room, {"occupancy_status": "Vacant", "housekeeping_status": "Dirty"})
		if not existing_task:
			rp, building, floor = frappe.db.get_value("Room", room, ["resort_property", "building", "floor"])
			task = frappe.get_doc(
				{
					"doctype": "Housekeeping Task",
					"resort_property": rp or stay_doc.resort_property,
					"room": room,
					"building": building,
					"floor": floor,
					"task_type": "Departure Cleaning",
					"task_status": "Queued",
					"priority": "High",
					"requires_inspection": 1,
					"dnd_status": "None",
					"stay": stay,
					"source_doctype": "Stay",
					"source_name": stay,
					"idempotency_key": key,
				}
			)
			task.insert(ignore_permissions=True)
			task_name = task.name

	# No explicit commit: the request commits on success (keeps this testable).
	folio = frappe.db.get_value("Guest Folio", {"stay": stay}, "name")
	return {
		"stay": stay,
		"stay_status": "Checked Out",
		"room": room,
		"housekeeping_task": task_name,
		"folio": folio,
		"reused": bool(existing_task),
		"next_actions": ["capture_checkout_condition"],
	}


@frappe.whitelist()
def extend_stay(stay, new_departure_date):
	"""Extend an in-house stay: push the departure date and charge the extra nights.

	The extra-night rate is taken from the guest's existing room charge so they pay
	the same nightly rate. Idempotent on (stay, new departure).
	"""
	_require_permission("Stay", "write")
	stay_doc = frappe.get_doc("Stay", stay)
	if stay_doc.stay_status not in ("In House", "Due Out"):
		frappe.throw(_("Only an in-house stay can be extended (status is {0}).").format(stay_doc.stay_status))

	new_dep = getdate(new_departure_date)
	cur_dep = getdate(stay_doc.departure_date)
	if new_dep <= cur_dep:
		frappe.throw(_("New departure must be after the current departure ({0}).").format(cur_dep))
	extra_nights = date_diff(new_dep, cur_dep)

	folio = frappe.db.get_value("Guest Folio", {"stay": stay}, "name")
	charge_added = None
	if folio:
		key = f"extend:{stay}:{new_dep}"
		existing_line = frappe.db.get_value("Folio Line", {"idempotency_key": key}, "name")
		if existing_line:
			charge_added = existing_line
		else:
			room_line = frappe.get_all(
				"Folio Line",
				filters={"guest_folio": folio, "line_type": "Charge", "source_module": ["in", ["Room", "PMS"]]},
				fields=["rate"],
				order_by="creation asc",
				limit=1,
			)
			nightly = room_line[0].rate if room_line and room_line[0].rate else None
			if nightly:
				line = frappe.get_doc(
					{
						"doctype": "Folio Line",
						"guest_folio": folio,
						"line_type": "Charge",
						"source_module": "Room",
						"source_doctype": "Stay",
						"source_name": stay,
						"idempotency_key": key,
						"service_date": today(),
						"qty": extra_nights,
						"rate": nightly,
						"amount": extra_nights * nightly,
						"tax_treatment": "Standard",
						"description": f"Extended stay: {extra_nights} extra night(s)",
					}
				)
				line.insert(ignore_permissions=True)
				charge_added = line.name

	frappe.db.set_value("Stay", stay, "departure_date", new_dep)
	if stay_doc.reservation:
		frappe.db.set_value("Reservation", stay_doc.reservation, "departure_date", new_dep)

	return {
		"stay": stay,
		"new_departure_date": str(new_dep),
		"extra_nights": extra_nights,
		"charge_added": charge_added,
		"folio": folio,
	}
