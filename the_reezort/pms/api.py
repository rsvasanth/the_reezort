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

CHECK_IN_ELIGIBLE_RESERVATION_STATUSES = {"Confirmed", "Modified", "Checked In"}
ACTIVE_STAY_STATUSES = ("Draft", "Reserved", "Due In", "In House", "Due Out", "Checked Out")


def _require_permission(doctype, permission_type="read"):
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)

	if not frappe.has_permission(doctype, permission_type):
		frappe.throw(
			_("You do not have {0} permission for {1}.").format(permission_type, doctype),
			frappe.PermissionError,
		)


def _primary_guest_name(reservation_doc):
	if reservation_doc.staying_guest_profile:
		name = frappe.db.get_value("Guest Profile", reservation_doc.staying_guest_profile, "guest_full_name")
		if name:
			return name

	for row in reservation_doc.get("guests") or []:
		if row.guest_name:
			return row.guest_name

	return "Guest"


def _resolve_vacant_room(property_name, room_type):
	return frappe.db.get_value(
		"Room",
		{
			"resort_property": property_name,
			"room_type": room_type,
			"sellable_status": "Sellable",
			"occupancy_status": "Vacant",
			"is_active": 1,
		},
		"name",
	)


def _available_rooms(property_name, room_type):
	"""All vacant, sellable rooms of a type — the assignment picker's options."""
	return frappe.get_all(
		"Room",
		filters={
			"resort_property": property_name,
			"room_type": room_type,
			"sellable_status": "Sellable",
			"occupancy_status": "Vacant",
			"is_active": 1,
		},
		fields=["name", "room_number", "room_name", "housekeeping_status"],
		order_by="room_number asc",
	)


KYC_FIELDS = (
	"date_of_birth", "nationality", "address",
	"id_type", "id_number", "id_expiry", "id_document",
)


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
			"id_type", "id_number", "id_expiry", "id_document",
			"kyc_verified", "kyc_verified_by", "kyc_verified_at",
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


def _as_list(value):
	if isinstance(value, str):
		import json

		return json.loads(value) if value else []
	return value or []


def _as_dict(value):
	if isinstance(value, str):
		import json

		return json.loads(value) if value else {}
	return value or {}


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
		return {
			"stay": stay.name,
			"stay_status": stay.stay_status,
			"folio": folio["data"]["folio"]["name"],
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
		"readiness": readiness,
	}


@frappe.whitelist()
def save_guest_kyc(reservation, kyc, verify=0):
	"""Persist ID/KYC + identity onto the reservation's guest profile.

	Creates the guest profile from the reservation if it has none yet. `verify=1`
	stamps the KYC as verified (the front-desk agent confirms the physical ID).
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

	if str(verify) in ("1", "true", "True"):
		guest.kyc_verified = 1
		guest.kyc_verified_by = frappe.session.user
		guest.kyc_verified_at = now()
	guest.save(ignore_permissions=True)

	return {"guest_profile": guest.name, "guest": _guest_context(guest.name)}


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
