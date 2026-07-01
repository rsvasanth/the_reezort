import json
from collections import Counter

import frappe
from frappe import _
from frappe.utils import add_to_date, date_diff, flt, getdate, now_datetime

BLOCKING_RESERVATION_STATUSES = ("Deposit Pending", "Confirmed", "Modified", "Checked In")
# Owner policy ("Require deposit to confirm"): % of total estimated amount
# the guest must pay before the reservation can be confirmed under each policy.
DEPOSIT_POLICY_PERCENT = {"None": 0, "Partial": 20, "Full": 100, "Corporate Credit": 0, "Voucher": 0, "Manual Approval": 0}
BLOCKING_ROOM_STATUSES = ("Held", "Confirmed", "Checked In")
BLOCKING_MAINTENANCE_STATUSES = ("Under Maintenance", "Out of Order", "Out of Service")
ROOM_ITEM_BY_CODE = {
	"DLX": "ROOM-DLX",
	"STE": "ROOM-STE",
	"VIL": "ROOM-VIL",
}


def _as_dict(value):
	if isinstance(value, str):
		return json.loads(value) if value else {}
	return value or {}


def _as_list(value):
	if isinstance(value, str):
		return json.loads(value) if value else []
	return value or []


def _require_permission(doctype, permission_type="read"):
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)

	if not frappe.has_permission(doctype, permission_type):
		frappe.throw(
			_("You do not have {0} permission for {1}.").format(permission_type, doctype),
			frappe.PermissionError,
		)


def _validate_stay_dates(arrival_date, departure_date):
	if not arrival_date or not departure_date:
		frappe.throw(_("Arrival date and departure date are required."))

	arrival = getdate(arrival_date)
	departure = getdate(departure_date)

	if departure <= arrival:
		frappe.throw(_("Departure date must be after arrival date."))

	return arrival, departure


def _property_currency(property_name):
	return frappe.db.get_value("Resort Property", property_name, "default_currency")


def _room_type_inventory(property_name):
	rows = frappe.get_all(
		"Room",
		filters={
			"resort_property": property_name,
			"is_active": 1,
			"maintenance_status": ["not in", BLOCKING_MAINTENANCE_STATUSES],
			"sellable_status": "Sellable",
		},
		fields=["room_type"],
	)
	return Counter(row.room_type for row in rows)


def _overlapping_reservations(property_name, arrival_date, departure_date):
	return frappe.get_all(
		"Reservation",
		filters={
			"resort_property": property_name,
			"status": ["in", BLOCKING_RESERVATION_STATUSES],
			"arrival_date": ["<", departure_date],
			"departure_date": [">", arrival_date],
		},
		pluck="name",
	)


def _reservation_room_usage(reservations):
	if not reservations:
		return Counter()

	rows = frappe.get_all(
		"Reservation Room",
		filters={"parent": ["in", reservations], "status": ["in", BLOCKING_ROOM_STATUSES]},
		fields=["room_type"],
	)
	return Counter(row.room_type for row in rows)


def _active_hold_usage(property_name, arrival_date, departure_date):
	rows = frappe.get_all(
		"Room Hold",
		filters={
			"resort_property": property_name,
			"status": "Active",
			"start_date": ["<", departure_date],
			"end_date": [">", arrival_date],
			"expires_at": [">", now_datetime()],
		},
		fields=["room_type", "quantity"],
	)
	usage = Counter()
	for row in rows:
		usage[row.room_type] += row.quantity or 1
	return usage


def _room_rate(room_type, nights):
	# Prefer the Room Type's own linked ERPNext item (set when a rate is configured in
	# the console); fall back to the legacy hardcoded map for the original demo types.
	rt = frappe.db.get_value("Room Type", room_type, ["erpnext_item", "room_type_code"], as_dict=True) or {}
	item_code = rt.get("erpnext_item") or ROOM_ITEM_BY_CODE.get(rt.get("room_type_code"))
	price_list = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
	rate = 0

	if item_code and price_list:
		rate = (
			frappe.db.get_value(
				"Item Price",
				{"item_code": item_code, "price_list": price_list, "selling": 1},
				"price_list_rate",
			)
			or 0
		)

	return rate * nights


def _availability_rows(property_name, arrival_date, departure_date, plan_code=None):
	"""Plan-aware availability. Falls back to the flat _room_rate when no
	Rate Plan exists on the property (backward compat)."""
	from the_reezort.reservation.pricing import packages_for, resolve_room_rate

	inventory = _room_type_inventory(property_name)
	reservation_usage = _reservation_room_usage(
		_overlapping_reservations(property_name, arrival_date, departure_date)
	)
	hold_usage = _active_hold_usage(property_name, arrival_date, departure_date)
	nights = date_diff(departure_date, arrival_date)
	currency = _property_currency(property_name)
	rows = []

	for room_type, physical_count in inventory.items():
		blocked_count = reservation_usage[room_type] + hold_usage[room_type]
		available_count = max(physical_count - blocked_count, 0)
		room_type_doc = frappe.db.get_value(
			"Room Type",
			room_type,
			["room_type_name", "room_type_code", "standard_adults", "standard_children", "max_occupancy"],
			as_dict=True,
		)
		pricing = resolve_room_rate(room_type, arrival_date, departure_date, plan_code=plan_code)
		# When resolver returns applied_plan=None it means no Rate Plan is set —
		# total_amount is already the legacy flat computation for that case.
		total_amount = pricing["total_amount"] if pricing["total_amount"] else _room_rate(room_type, nights)
		rows.append(
			{
				"room_type": room_type,
				"room_type_code": room_type_doc.room_type_code,
				"room_type_name": room_type_doc.room_type_name,
				"physical_count": physical_count,
				"blocked_count": blocked_count,
				"available_count": available_count,
				"currency": currency,
				"total_amount": total_amount,
				"tax_estimate": 0,
				"deposit_required": 0,
				"standard_adults": room_type_doc.standard_adults,
				"standard_children": room_type_doc.standard_children,
				"max_occupancy": room_type_doc.max_occupancy,
				# Plan-aware fields — null when no plan configured.
				"applied_plan": pricing["applied_plan"],
				"season_uplift_summary": pricing["season_uplift_summary"],
				"nightly_breakdown": pricing["nightly_breakdown"],
				"packages": packages_for(room_type, arrival_date, departure_date),
			}
		)

	return sorted(rows, key=lambda row: row["room_type_name"])


@frappe.whitelist(allow_guest=True)
def search_availability(property=None, arrival_date=None, departure_date=None, rooms=None, promo_code=None, source="Direct"):
	_validate_stay_dates(arrival_date, departure_date)

	if not property:
		property = frappe.db.get_value("Resort Property", {"is_active": 1}, "name")
	if not property:
		frappe.throw(_("A Resort Property is required."))

	requested_rooms = _as_list(rooms) or [{"adults": 2, "children": 0}]
	offers = []

	for row in _availability_rows(property, arrival_date, departure_date):
		if row["available_count"] >= len(requested_rooms):
			offers.append(
				{
					**row,
					"rate_plan": "BAR",
					"package": None,
					"cancellation_policy_summary": "Flexible policy placeholder for the first reservation slice.",
				}
			)

	return {"property": property, "offers": offers, "source": source, "promo_code": promo_code}


@frappe.whitelist()
def create_quote_or_hold(
	property=None,
	arrival_date=None,
	departure_date=None,
	rooms=None,
	source="Direct",
	source_reference=None,
	hold_minutes=15,
):
	_require_permission("Reservation", "create")
	_validate_stay_dates(arrival_date, departure_date)

	rooms = _as_list(rooms)
	if not rooms:
		frappe.throw(_("At least one room request is required."))

	available_by_type = {row["room_type"]: row for row in _availability_rows(property, arrival_date, departure_date)}
	requested_count = Counter(row.get("room_type") for row in rooms)
	for room_type, count in requested_count.items():
		if not room_type or available_by_type.get(room_type, {}).get("available_count", 0) < count:
			frappe.throw(_("Requested room type is not available: {0}").format(room_type))

	hold_expires_at = add_to_date(now_datetime(), minutes=int(hold_minutes or 15))
	reservation = frappe.get_doc(
		{
			"doctype": "Reservation",
			"resort_property": property,
			"status": "Hold",
			"booking_source": source,
			"source_reference": source_reference,
			"arrival_date": arrival_date,
			"departure_date": departure_date,
			"currency": _property_currency(property),
			"hold_expires_at": hold_expires_at,
			"rooms": [
				{
					"room_type": row["room_type"],
					"adults": row.get("adults") or 2,
					"children": row.get("children") or 0,
					"estimated_amount": _room_rate(row["room_type"], date_diff(departure_date, arrival_date)),
					"status": "Held",
				}
				for row in rooms
			],
		}
	)
	reservation.insert(ignore_permissions=True)

	for room_type, quantity in requested_count.items():
		hold = frappe.get_doc(
			{
				"doctype": "Room Hold",
				"resort_property": property,
				"reservation": reservation.name,
				"hold_scope": "Room Type",
				"room_type": room_type,
				"start_date": arrival_date,
				"end_date": departure_date,
				"quantity": quantity,
				"status": "Active",
				"expires_at": hold_expires_at,
				"source": "Staff" if source == "Staff" else "Online",
			}
		)
		hold.insert(ignore_permissions=True)

	frappe.db.commit()

	return {"reservation": reservation.name, "status": reservation.status, "hold_expires_at": hold_expires_at}


def _get_or_create_guest_profile(booker):
	if not booker:
		return None

	name = booker.get("full_name") or booker.get("guest_name")
	if not name:
		return None

	existing = None
	if booker.get("email"):
		existing = frappe.db.get_value("Guest Profile", {"email": booker.get("email")}, "name")
	if not existing and booker.get("phone"):
		existing = frappe.db.get_value("Guest Profile", {"phone": booker.get("phone")}, "name")

	if existing:
		return existing

	doc = frappe.get_doc(
		{
			"doctype": "Guest Profile",
			"guest_full_name": name,
			"email": booker.get("email"),
			"phone": booker.get("phone"),
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _deposit_paid_on_reservation(reservation):
	"""Sum of Deposit Application folio lines across this reservation's folios."""
	folios = frappe.get_all("Guest Folio", {"reservation": reservation}, pluck="name")
	if not folios:
		return 0
	return flt(
		frappe.db.get_value(
			"Folio Line",
			{"guest_folio": ["in", folios], "line_type": "Deposit Application"},
			"sum(amount)",
		)
	)


@frappe.whitelist()
def ensure_booking_folio(reservation, booker=None):
	"""Ensure the reservation has a guest profile, ERPNext customer and an open
	folio so a deposit can be taken (Cash or Razorpay). Idempotent."""
	from the_reezort.billing.api import get_or_create_folio

	_require_permission("Reservation", "write")
	doc = frappe.get_doc("Reservation", reservation)
	booker = _as_dict(booker)

	if booker and not doc.staying_guest_profile:
		profile = _get_or_create_guest_profile(booker)
		doc.booker_guest_profile = profile
		doc.staying_guest_profile = profile
		if not doc.guests:
			doc.append(
				"guests",
				{
					"guest_profile": profile,
					"guest_name": booker.get("full_name"),
					"email": booker.get("email"),
					"phone": booker.get("phone"),
					"guest_type": "Adult",
					"is_primary_guest": 1,
				},
			)
		doc.save(ignore_permissions=True)

	folio = get_or_create_folio(reservation=reservation)["data"]["folio"]["name"]
	return {"reservation": reservation, "folio": folio}


@frappe.whitelist()
def record_booking_deposit(reservation, booker=None, amount=None, mode_of_payment="Cash"):
	"""Take a deposit on a Hold-stage reservation before it can be confirmed.

	The booker contact is captured first (creates the guest profile + ERPNext
	customer so a folio can open), then the deposit posts via the standard
	billing path — real advance Payment Entry, idempotent on (reservation, amount,
	mode). Reservation status moves to 'Deposit Pending' for the UI gate to flip.
	"""
	from the_reezort.billing.api import get_or_create_folio
	from the_reezort.billing.deposits import record_deposit

	_require_permission("Reservation", "write")
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Deposit amount must be positive."))

	doc = frappe.get_doc("Reservation", reservation)
	booker = _as_dict(booker)

	# Make sure the reservation has a guest profile + customer so a folio can open.
	if booker and not doc.staying_guest_profile:
		profile = _get_or_create_guest_profile(booker)
		doc.booker_guest_profile = profile
		doc.staying_guest_profile = profile
		if not doc.guests:
			doc.append(
				"guests",
				{
					"guest_profile": profile,
					"guest_name": booker.get("full_name"),
					"email": booker.get("email"),
					"phone": booker.get("phone"),
					"guest_type": "Adult",
					"is_primary_guest": 1,
				},
			)
		doc.save(ignore_permissions=True)

	folio = get_or_create_folio(reservation=reservation)["data"]["folio"]["name"]
	deposit = record_deposit(
		guest_folio=folio,
		amount=amount,
		mode_of_payment=mode_of_payment,
		idempotency_key=f"booking-deposit:{reservation}:{int(amount * 100)}:{mode_of_payment}",
	)

	state = get_reservation_deposit_state(reservation)
	# Flip the deposit-pending flag so the UI surfaces the gate (or its meeting).
	if state["met"]:
		frappe.db.set_value("Reservation", reservation, "deposit_status", "Paid")
	else:
		frappe.db.set_value("Reservation", reservation, {"status": "Deposit Pending", "deposit_status": "Partially Paid"})
	frappe.db.commit()

	return {"deposit": deposit, "state": get_reservation_deposit_state(reservation), "folio": folio}


@frappe.whitelist()
def get_reservation_deposit_state(reservation):
	"""Required/paid/outstanding/met for the booking deposit gate (drives UI)."""
	_require_permission("Reservation", "read")
	doc = frappe.get_doc("Reservation", reservation)
	pct = DEPOSIT_POLICY_PERCENT.get(doc.deposit_policy or "None", 0)
	required = round(flt(doc.total_estimated_amount) * pct / 100.0, 2)
	paid = _deposit_paid_on_reservation(reservation)
	outstanding = max(required - paid, 0)
	folio = frappe.db.get_value("Guest Folio", {"reservation": reservation}, "name")
	return {
		"reservation": doc.name,
		"deposit_policy": doc.deposit_policy,
		"deposit_status": doc.deposit_status,
		"required_percent": pct,
		"required_amount": required,
		"paid_amount": paid,
		"outstanding_amount": outstanding,
		"met": paid >= required and required > 0 or pct == 0,
		"total_estimated_amount": flt(doc.total_estimated_amount),
		"folio": folio,
		"currency": doc.currency,
	}


@frappe.whitelist()
def confirm_reservation(reservation=None, booker=None, guests=None, guarantee=None, accepted_terms=False):
	_require_permission("Reservation", "write")

	if not accepted_terms:
		frappe.throw(_("Terms must be accepted before confirmation."))

	doc = frappe.get_doc("Reservation", reservation)
	if doc.status not in {"Hold", "Draft", "Deposit Pending"}:
		frappe.throw(_("Reservation cannot be confirmed from status {0}.").format(doc.status))

	# Owner policy: a Partial/Full deposit must be paid before confirmation.
	pct = DEPOSIT_POLICY_PERCENT.get(doc.deposit_policy or "None", 0)
	if pct > 0:
		required = round(flt(doc.total_estimated_amount) * pct / 100.0, 2)
		paid = _deposit_paid_on_reservation(reservation)
		if paid < required:
			doc.deposit_status = "Pending"
			doc.status = "Deposit Pending"
			doc.save(ignore_permissions=True)
			frappe.db.commit()
			frappe.throw(
				_("Deposit required: {0} of {1} ({2}%) — paid {3}. Take the deposit before confirming.").format(
					required, flt(doc.total_estimated_amount), pct, paid
				),
				frappe.ValidationError,
			)

	booker = _as_dict(booker)
	guests = _as_list(guests)
	guarantee = _as_dict(guarantee)
	primary_profile = _get_or_create_guest_profile(booker)

	if not guests and booker:
		guests = [{"guest_name": booker.get("full_name"), "email": booker.get("email"), "phone": booker.get("phone"), "is_primary_guest": 1}]

	if not guests:
		frappe.throw(_("At least one guest is required."))

	for row in doc.rooms:
		row.status = "Confirmed"

	doc.set("guests", [])
	for index, guest in enumerate(guests):
		doc.append(
			"guests",
			{
				"guest_profile": primary_profile if index == 0 else guest.get("guest_profile"),
				"guest_name": guest.get("guest_name") or guest.get("full_name"),
				"email": guest.get("email"),
				"phone": guest.get("phone"),
				"guest_type": guest.get("guest_type") or "Adult",
				"is_primary_guest": 1 if guest.get("is_primary_guest") or index == 0 else 0,
			},
		)

	doc.booker_guest_profile = primary_profile
	doc.staying_guest_profile = primary_profile
	doc.status = "Confirmed"
	if pct > 0:
		paid = _deposit_paid_on_reservation(reservation)
		doc.deposit_status = "Paid" if paid >= round(flt(doc.total_estimated_amount) * pct / 100.0, 2) else "Partially Paid"
	elif guarantee.get("method") == "Payment":
		doc.deposit_status = "Paid"
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {"reservation": doc.name, "status": doc.status, "confirmation_number": doc.name}


@frappe.whitelist()
def cancel_reservation(reservation=None, reason="Guest Request", requested_deposit_action="No Action"):
	_require_permission("Reservation", "write")

	doc = frappe.get_doc("Reservation", reservation)
	if doc.status in {"Cancelled", "Completed", "Checked In"}:
		frappe.throw(_("Reservation cannot be cancelled from status {0}.").format(doc.status))

	for row in doc.rooms:
		row.status = "Cancelled"
	doc.status = "Cancelled"
	doc.internal_notes = "\n".join(filter(None, [doc.internal_notes, f"Cancellation reason: {reason}"]))
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"reservation": doc.name,
		"status": doc.status,
		"financial_handoff_required": requested_deposit_action in {"Refund", "Forfeit"},
	}


@frappe.whitelist()
def get_reservation_summary(reservation=None):
	_require_permission("Reservation", "read")

	doc = frappe.get_doc("Reservation", reservation)
	return {
		"reservation": doc.name,
		"status": doc.status,
		"arrival_date": doc.arrival_date,
		"departure_date": doc.departure_date,
		"nights": doc.nights,
		"rooms": [row.as_dict() for row in doc.rooms],
		"guests": [row.as_dict() for row in doc.guests],
		"deposit_status": doc.deposit_status,
		"total_estimated_amount": doc.total_estimated_amount,
		"check_in_ready": doc.status == "Confirmed",
	}


@frappe.whitelist()
def get_reservation(reservation):
	"""Full reservation detail for the workspace view."""
	_require_permission("Reservation", "read")
	doc = frappe.get_doc("Reservation", reservation)
	guest = None
	if doc.staying_guest_profile:
		guest = frappe.db.get_value("Guest Profile", doc.staying_guest_profile, "guest_full_name")
	if not guest and doc.get("guests"):
		guest = doc.guests[0].guest_name
	stay = frappe.db.get_value("Stay", {"reservation": reservation}, "name")
	return {
		"reservation": doc.name,
		"status": doc.status,
		"guest": guest or "Guest",
		"arrival_date": str(doc.arrival_date) if doc.arrival_date else None,
		"departure_date": str(doc.departure_date) if doc.departure_date else None,
		"nights": doc.nights,
		"deposit_status": doc.deposit_status,
		"total_estimated_amount": doc.total_estimated_amount,
		"currency": doc.currency,
		"resort_property": doc.resort_property,
		"booking_source": doc.booking_source,
		"check_in_ready": doc.status == "Confirmed",
		"stay": stay,
		"rooms": [
			{
				"room_type": r.room_type,
				"adults": r.adults,
				"children": r.children,
				"estimated_amount": r.estimated_amount,
				"status": r.status,
			}
			for r in doc.get("rooms")
		],
		"guests": [
			{"guest_name": g.guest_name, "email": g.email, "phone": g.phone, "is_primary_guest": g.is_primary_guest}
			for g in doc.get("guests")
		],
	}


@frappe.whitelist()
def list_reservations(resort_property=None):
	"""Active reservations for the Reservations board (booking pipeline)."""
	_require_permission("Reservation", "read")
	filters = {"status": ["in", ["Draft", "Quoted", "Hold", "Deposit Pending", "Confirmed", "Modified"]]}
	if resort_property:
		filters["resort_property"] = resort_property

	out = []
	for r in frappe.get_all(
		"Reservation",
		filters=filters,
		fields=["name", "status", "arrival_date", "departure_date", "staying_guest_profile", "hold_expires_at", "total_estimated_amount", "currency"],
		order_by="creation desc",
		limit=50,
	):
		guest = frappe.db.get_value("Guest Profile", r.staying_guest_profile, "guest_full_name") if r.staying_guest_profile else None
		if not guest:
			g = frappe.get_all("Reservation Guest", filters={"parent": r.name}, fields=["guest_name"], limit=1)
			guest = (g[0].guest_name if g and g[0].guest_name else "—")
		rt = frappe.get_all("Reservation Room", filters={"parent": r.name}, fields=["room_type"], limit=1)
		out.append(
			{
				"reservation": r.name,
				"status": r.status,
				"guest": guest,
				"arrival_date": str(r.arrival_date) if r.arrival_date else None,
				"departure_date": str(r.departure_date) if r.departure_date else None,
				"room_type": rt[0].room_type if rt else None,
				"total_estimated_amount": r.total_estimated_amount,
				"currency": r.currency,
			}
		)
	return {"reservations": out}


# ---------- occupancy timeline (Gantt view for Front Desk) ----------

@frappe.whitelist()
def get_occupancy_timeline(start_date=None, days=14, resort_property=None):
	"""Rooms × days grid with reservation blocks + open task chips for a Gantt view.

	Returns:
	  { start_date, end_date, days: [YYYY-MM-DD, …],
	    rooms: [{name, room_number, room_name, room_type, statuses}],
	    reservations: [{name, guest, room, room_type, arrival_date, departure_date, status, nights}],
	    tasks: [{name, room, task_type, task_status, priority, start_time, completed_at, due_at}] }
	"""
	from frappe.utils import add_days, getdate, today

	_require_permission("Reservation", "read")
	start = getdate(start_date) if start_date else getdate(today())
	days = int(days) or 14
	end = add_days(start, days)

	# Property default — first active if not passed.
	if not resort_property:
		resort_property = frappe.db.get_value("Resort Property", {"is_active": 1}, "name")

	rooms = frappe.get_all(
		"Room",
		filters={"resort_property": resort_property, "is_active": 1},
		fields=["name", "room_number", "room_name", "room_type", "occupancy_status", "housekeeping_status", "maintenance_status", "sellable_status"],
		order_by="room_number asc",
	)

	# All reservations that overlap the window and are blocking (not Cancelled) —
	# include Hold so the agent sees pipeline.
	res_rows = frappe.get_all(
		"Reservation",
		filters={
			"resort_property": resort_property,
			"status": ["not in", ("Cancelled", "No Show")],
			"arrival_date": ["<", end],
			"departure_date": [">", start],
		},
		fields=["name", "status", "arrival_date", "departure_date", "staying_guest_profile", "booker_guest_profile"],
	)
	reservations = []
	for r in res_rows:
		guest = None
		if r.staying_guest_profile:
			guest = frappe.db.get_value("Guest Profile", r.staying_guest_profile, "guest_full_name")
		room_row = frappe.db.get_value(
			"Reservation Room", {"parent": r.name}, ["room", "room_type"], as_dict=True
		)
		nights = (getdate(r.departure_date) - getdate(r.arrival_date)).days
		reservations.append(
			{
				"name": r.name,
				"guest": guest or "Guest",
				"status": r.status,
				"room": room_row.room if room_row else None,
				"room_type": room_row.room_type if room_row else None,
				"arrival_date": str(r.arrival_date),
				"departure_date": str(r.departure_date),
				"nights": nights,
			}
		)

	# Open housekeeping tasks in this window (dated by creation OR due_at).
	tasks = frappe.get_all(
		"Housekeeping Task",
		filters={
			"resort_property": resort_property,
			"task_status": ["in", ("Queued", "Assigned", "In Progress", "Paused", "Inspection Required")],
		},
		fields=["name", "room", "task_type", "task_status", "priority", "start_time", "completed_at", "due_at", "creation"],
		limit=500,
	)

	return {
		"start_date": str(start),
		"end_date": str(end),
		"days": [str(add_days(start, i)) for i in range(days)],
		"rooms": rooms,
		"reservations": reservations,
		"tasks": tasks,
		"resort_property": resort_property,
	}
