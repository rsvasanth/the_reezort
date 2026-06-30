"""PMS Stay Lifecycle — thin check-in slice (003).

Provides the minimum needed for 004 checkout settlement: create a Stay from a
confirmed Reservation and open its Guest Folio (reusing the billing service).
No ERPNext financial documents are created here.
"""

import frappe
from frappe import _
from frappe.utils import now

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


def _as_list(value):
	if isinstance(value, str):
		import json

		return json.loads(value) if value else []
	return value or []


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
