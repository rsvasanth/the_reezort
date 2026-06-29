"""PMS Stay Lifecycle — thin check-in slice (003).

Provides the minimum needed for 004 checkout settlement: create a Stay from a
confirmed Reservation and open its Guest Folio (reusing the billing service).
No ERPNext financial documents are created here.
"""

import frappe
from frappe import _

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
