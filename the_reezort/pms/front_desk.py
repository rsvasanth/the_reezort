"""Front Desk board — arrivals (to check in) + in-house (to check out).

A thin read over Reservations + Stays so the front desk runs arrivals/departures
from the SPA. Check-in / check-out are the existing pms.api endpoints.
Returns a BARE dict (PMS convention).
"""

import frappe
from frappe import _
from frappe.utils import date_diff, getdate, today


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _reservation_guest(reservation_name, staying_guest_profile):
	if staying_guest_profile:
		name = frappe.db.get_value("Guest Profile", staying_guest_profile, "guest_full_name")
		if name:
			return name
	rows = frappe.get_all(
		"Reservation Guest", filters={"parent": reservation_name}, fields=["guest_name"], limit=1
	)
	return rows[0].guest_name if rows and rows[0].guest_name else "Guest"


@frappe.whitelist()
def get_front_desk_board(resort_property=None):
	_require_login()
	today_d = getdate(today())

	res_filters = {"status": ["in", ["Confirmed", "Modified"]]}
	if resort_property:
		res_filters["resort_property"] = resort_property
	arrivals = []
	for r in frappe.get_all(
		"Reservation",
		filters=res_filters,
		fields=["name", "arrival_date", "departure_date", "staying_guest_profile"],
		order_by="arrival_date asc",
	):
		room_type_row = frappe.get_all(
			"Reservation Room", filters={"parent": r.name}, fields=["room_type"], limit=1
		)
		room_type = room_type_row[0].room_type if room_type_row else None
		arrivals.append(
			{
				"reservation": r.name,
				"guest": _reservation_guest(r.name, r.staying_guest_profile),
				"arrival_date": str(r.arrival_date) if r.arrival_date else None,
				"departure_date": str(r.departure_date) if r.departure_date else None,
				"room_type": room_type,
				"room_type_image": frappe.db.get_value("Room Type", room_type, "image") if room_type else None,
				"nights": date_diff(r.departure_date, r.arrival_date) if (r.arrival_date and r.departure_date) else None,
				"due_today": bool(r.arrival_date and getdate(r.arrival_date) <= today_d),
			}
		)

	stay_filters = {"stay_status": "In House"}
	if resort_property:
		stay_filters["resort_property"] = resort_property
	in_house = []
	for s in frappe.get_all(
		"Stay",
		filters=stay_filters,
		fields=["name", "primary_guest_name", "current_room", "arrival_date", "departure_date", "folio_status"],
		order_by="departure_date asc",
	):
		room_image = None
		if s.current_room:
			room_image = frappe.db.get_value("Room", s.current_room, "image")
			if not room_image:
				rt = frappe.db.get_value("Room", s.current_room, "room_type")
				if rt:
					room_image = frappe.db.get_value("Room Type", rt, "image")
		in_house.append(
			{
				"stay": s.name,
				"guest": s.primary_guest_name,
				"room": s.current_room,
				"room_image": room_image,
				"arrival_date": str(s.arrival_date) if s.arrival_date else None,
				"departure_date": str(s.departure_date) if s.departure_date else None,
				"folio": frappe.db.get_value("Guest Folio", {"stay": s.name}, "name"),
				"folio_status": s.folio_status,
				"due_out": bool(s.departure_date and getdate(s.departure_date) <= today_d),
			}
		)

	return {
		"arrivals": arrivals,
		"in_house": in_house,
		"counts": {
			"arrivals": len(arrivals),
			"in_house": len(in_house),
			"due_out": sum(1 for x in in_house if x["due_out"]),
		},
	}
