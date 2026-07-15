"""Public guest booking — spec 002 direct-booking channel.

Guest-facing endpoints (allow_guest=True) that power the public booking flow:
search availability, request a booking (creates a Hold + Guest Profile), and
look up an existing booking. These deliberately expose only guest-safe fields
and never confirm a reservation or take payment directly — a booking request
lands as a Hold that staff confirm and collect the deposit for through the
existing back-office flow.

Abuse guardrails: per-IP rate limits on every endpoint (frappe.rate_limiter),
strict input validation, single room type per request, a per-guest active-hold
cap, and email-gated lookup/deposit. The online deposit path verifies the
Razorpay HMAC signature and re-derives the captured amount from Razorpay's API
— client-supplied amounts are never trusted.
"""

from __future__ import annotations

import re
from contextlib import contextmanager

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import add_to_date, flt, getdate, now_datetime, today

from the_reezort.reservation.api import (
	_availability_rows,
	_get_or_create_guest_profile,
	_property_currency,
	_validate_stay_dates,
)

# A guest may not hold more than this many un-confirmed bookings at once.
MAX_ACTIVE_HOLDS_PER_GUEST = 3
MAX_ROOMS_PER_REQUEST = 5
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _default_property():
	return frappe.db.get_value("Resort Property", {"is_active": 1}, "name")


def _guard_future(arrival_date):
	if getdate(arrival_date) < getdate(today()):
		frappe.throw(_("Arrival date can't be in the past."))


def _room_image(room_type):
	return frappe.db.get_value("Room Type", room_type, "image")


def _safe_offer(row, adults, children):
	"""Guest-safe projection of an availability row — no internal inventory
	counts, rate-plan internals, or season/hold breakdowns."""
	occupancy = int(row.get("max_occupancy") or 0)
	fits = occupancy == 0 or (int(adults or 0) + int(children or 0)) <= occupancy
	return {
		"room_type": row["room_type"],
		"room_type_name": row["room_type_name"],
		"image": _room_image(row["room_type"]),
		"available_count": row["available_count"],
		"currency": row["currency"],
		"total_amount": flt(row["total_amount"]),
		"max_occupancy": occupancy,
		"fits_party": fits,
	}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=30, seconds=300)
def guest_search(property=None, arrival_date=None, departure_date=None, adults=2, children=0):
	"""Public availability search — returns only bookable room types with a
	guest-safe price, image, and capacity fit."""
	property = property or _default_property()
	if not property:
		frappe.throw(_("No property is available for booking."))
	_validate_stay_dates(arrival_date, departure_date)
	_guard_future(arrival_date)

	rows = _availability_rows(property, arrival_date, departure_date)
	offers = [
		_safe_offer(row, adults, children)
		for row in rows
		if row["available_count"] > 0
	]
	nights = (getdate(departure_date) - getdate(arrival_date)).days
	return {
		"property": property,
		"property_name": frappe.db.get_value("Resort Property", property, "property_name") or property,
		"arrival_date": str(arrival_date),
		"departure_date": str(departure_date),
		"nights": nights,
		"currency": _property_currency(property),
		"offers": offers,
	}


def _validate_booker(booker):
	booker = booker or {}
	name = (booker.get("full_name") or "").strip()
	email = (booker.get("email") or "").strip()
	phone = (booker.get("phone") or "").strip()
	if not name:
		frappe.throw(_("Your name is required."))
	if not _EMAIL_RE.match(email):
		frappe.throw(_("A valid email is required."))
	if len(phone) < 6:
		frappe.throw(_("A valid phone number is required."))
	return {"full_name": name, "email": email, "phone": phone}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=5, seconds=3600)
def guest_request_booking(
	property=None, arrival_date=None, departure_date=None, room_type=None,
	quantity=1, adults=2, children=0, booker=None,
):
	"""Create a booking REQUEST as a Hold reservation from the public site.

	Staff confirm the hold and collect the deposit through the back office; this
	endpoint never auto-confirms or charges. Returns the booking reference.
	"""
	property = property or _default_property()
	if not property:
		frappe.throw(_("No property is available for booking."))
	_validate_stay_dates(arrival_date, departure_date)
	_guard_future(arrival_date)
	if not room_type or not frappe.db.exists("Room Type", room_type):
		frappe.throw(_("Please choose a room type."))
	quantity = int(quantity or 1)
	if quantity < 1 or quantity > MAX_ROOMS_PER_REQUEST:
		frappe.throw(_("Rooms per booking must be between 1 and {0}.").format(MAX_ROOMS_PER_REQUEST))

	booker = frappe.parse_json(booker) if isinstance(booker, str) else booker
	booker = _validate_booker(booker)

	# Availability re-check (never trust the client's selection).
	available = {row["room_type"]: row for row in _availability_rows(property, arrival_date, departure_date)}
	if available.get(room_type, {}).get("available_count", 0) < quantity:
		frappe.throw(_("Sorry — that room type is no longer available for those dates."))

	profile = _get_or_create_guest_profile(booker)

	# Spam guard: cap concurrent un-confirmed holds per guest.
	if profile:
		active = frappe.db.count(
			"Reservation",
			{"booker_guest_profile": profile, "status": ["in", ["Hold", "Deposit Pending"]]},
		)
		if active >= MAX_ACTIVE_HOLDS_PER_GUEST:
			frappe.throw(_("You already have several pending booking requests. Please contact us to proceed."))

	row = available[room_type]
	nights = (getdate(departure_date) - getdate(arrival_date)).days
	per_room = flt(row["total_amount"])
	# A website request Hold lives longer than a live 15-min staff hold — give
	# the front office 48h to confirm and collect the deposit.
	hold_expires_at = add_to_date(now_datetime(), hours=48)
	reservation = frappe.get_doc(
		{
			"doctype": "Reservation",
			"resort_property": property,
			"status": "Hold",
			"booking_source": "Website",
			"deposit_policy": "Partial",
			"arrival_date": arrival_date,
			"departure_date": departure_date,
			"currency": _property_currency(property),
			"hold_expires_at": hold_expires_at,
			"booker_guest_profile": profile,
			"staying_guest_profile": profile,
			"rooms": [
				{
					"room_type": room_type,
					"adults": int(adults or 2),
					"children": int(children or 0),
					"estimated_amount": per_room,
					"status": "Held",
				}
				for _i in range(quantity)
			],
		}
	)
	reservation.insert(ignore_permissions=True)

	frappe.get_doc(
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
			"source": "Online",
		}
	).insert(ignore_permissions=True)

	frappe.db.commit()
	return {
		"reference": reservation.name,
		"status": reservation.status,
		"guest_name": booker["full_name"],
		"arrival_date": str(arrival_date),
		"departure_date": str(departure_date),
		"room_type_name": row["room_type_name"],
		"nights": nights,
		"estimated_total": per_room * quantity,
		"currency": _property_currency(property),
	}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=15, seconds=600)
def guest_lookup_booking(reference=None, email=None):
	"""Look up a booking's status. Email-gated: the caller must supply the
	booker's email so a bare reference can't be enumerated."""
	if not reference or not email:
		frappe.throw(_("A booking reference and email are required."))
	# Generic message for both missing-reference and email-mismatch so a bare
	# reference can't be enumerated.
	not_found = _("No booking found for that reference and email.")
	if not frappe.db.exists("Reservation", reference):
		frappe.throw(not_found)
	doc = frappe.get_doc("Reservation", reference)
	profile_email = (
		frappe.db.get_value("Guest Profile", doc.booker_guest_profile, "email")
		if doc.booker_guest_profile
		else None
	)
	if not profile_email or profile_email.strip().lower() != email.strip().lower():
		# Do not reveal whether the reference exists — same message either way.
		frappe.throw(_("No booking found for that reference and email."))

	room = doc.rooms[0] if doc.rooms else None
	return {
		"reference": doc.name,
		"status": doc.status,
		"arrival_date": str(doc.arrival_date) if doc.arrival_date else None,
		"departure_date": str(doc.departure_date) if doc.departure_date else None,
		"room_type_name": frappe.db.get_value("Room Type", room.room_type, "room_type_name") if room else None,
		"guest_name": frappe.db.get_value("Guest Profile", doc.booker_guest_profile, "guest_full_name")
		if doc.booker_guest_profile
		else None,
		"deposit_status": doc.deposit_status,
		"currency": doc.currency,
		"total_estimated_amount": flt(doc.total_estimated_amount),
	}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=60, seconds=300)
def guest_site_content():
	"""Everything the public marketing site needs in one call: property story,
	villas (room types with descriptions/amenities and a from-rate), dining
	outlets, and gallery images. Guest-safe fields only."""
	property = _default_property()
	if not property:
		frappe.throw(_("No property is available."))

	prop = frappe.db.get_value(
		"Resort Property", property,
		["name", "property_name", "image", "address", "phone", "email",
		 "default_check_in_time", "default_check_out_time"],
		as_dict=True,
	)

	# From-rate per villa over a near-term window (7→9 days out).
	arrival, departure = today(), None
	arrival = frappe.utils.add_days(today(), 7)
	departure = frappe.utils.add_days(today(), 9)
	rate_by_type = {}
	try:
		for row in _availability_rows(property, arrival, departure):
			nights = 2
			rate_by_type[row["room_type"]] = flt(row["total_amount"]) / nights
	except Exception:
		pass

	villas = []
	for rt in frappe.get_all(
		"Room Type",
		filters={"resort_property": property, "is_active": 1},
		fields=[
			"name", "room_type_name", "description", "image",
			"standard_adults", "standard_children", "max_occupancy",
			"bed_configuration", "view_tags",
		],
		order_by="room_type_name asc",
	):
		# default_amenities is a child Table (Room Type Amenity), not a column.
		amenities = frappe.get_all(
			"Room Type Amenity",
			filters={"parent": rt.name, "is_guest_visible": 1},
			pluck="amenity",
			order_by="idx asc",
		)
		villas.append(
			{
				"room_type": rt.name,
				"name": rt.room_type_name,
				"description": rt.description,
				"image": rt.image,
				"max_occupancy": rt.max_occupancy,
				"bed_configuration": rt.bed_configuration,
				"view_tags": [t.strip() for t in (rt.view_tags or "").replace("\n", ",").split(",") if t.strip()],
				"amenities": amenities,
				"from_rate": flt(rate_by_type.get(rt.name)) or None,
			}
		)

	dining = frappe.get_all(
		"FnB Outlet",
		filters={"resort_property": property, "is_active": 1},
		fields=["outlet_name", "outlet_type"],
		order_by="is_default desc, outlet_name asc",
	)

	gallery = [v["image"] for v in villas if v["image"]]
	if prop.image:
		gallery.insert(0, prop.image)

	return {
		"property": prop.name,
		"property_name": prop.property_name,
		"hero_image": prop.image or (gallery[0] if gallery else None),
		"address": prop.address,
		"phone": prop.phone,
		"email": prop.email,
		"check_in_time": str(prop.default_check_in_time) if prop.default_check_in_time else None,
		"check_out_time": str(prop.default_check_out_time) if prop.default_check_out_time else None,
		"villas": villas,
		"dining": dining,
		"gallery": gallery[:8],
	}


# --------------------------------------------------------------------------- #
#  online deposit — Razorpay, email-verified, amounts re-derived server-side
# --------------------------------------------------------------------------- #


@contextmanager
def _as_system():
	"""Elevate AFTER our own checks (email match + Razorpay HMAC + authoritative
	amount) — the folio/deposit internals are staff-permission-gated and this
	whitelisted endpoint is the trusted service boundary for the guest path."""
	user = frappe.session.user
	frappe.set_user("Administrator")
	try:
		yield
	finally:
		frappe.set_user(user)


def _verified_booking(reference, email):
	"""Resolve a booking by reference, gated on the booker's email. Generic
	not-found message either way so references can't be enumerated."""
	not_found = _("No booking found for that reference and email.")
	if not reference or not email or not frappe.db.exists("Reservation", reference):
		frappe.throw(not_found)
	doc = frappe.get_doc("Reservation", reference)
	profile_email = (
		frappe.db.get_value("Guest Profile", doc.booker_guest_profile, "email")
		if doc.booker_guest_profile
		else None
	)
	if not profile_email or profile_email.strip().lower() != str(email).strip().lower():
		frappe.throw(not_found)
	return doc


def _deposit_due(doc):
	"""Outstanding deposit for a booking: policy percent of the estimate
	(website bookings carry Partial = 20%) minus what's already paid."""
	from the_reezort.reservation.api import DEPOSIT_POLICY_PERCENT, _deposit_paid_on_reservation

	pct = DEPOSIT_POLICY_PERCENT.get(doc.deposit_policy or "None", 0) or 20
	required = round(flt(doc.total_estimated_amount) * pct / 100.0, 2)
	paid = flt(_deposit_paid_on_reservation(doc.name))
	return max(required - paid, 0), required, paid


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=10, seconds=3600)
def guest_deposit_order(reference=None, email=None):
	"""Create a Razorpay order for a booking's outstanding deposit so the guest
	can secure the hold online. Amount is computed server-side from the
	reservation's own deposit policy — never taken from the client."""
	doc = _verified_booking(reference, email)
	if doc.status not in {"Hold", "Deposit Pending"}:
		frappe.throw(_("This booking is {0}; the deposit step no longer applies.").format(doc.status))

	due, required, paid = _deposit_due(doc)
	if due <= 0:
		frappe.throw(_("The deposit for this booking is already covered."))

	from the_reezort.billing.razorpay_gateway import _create_order

	order = _create_order(
		due,
		doc.currency or "INR",
		f"WEB-DEP-{doc.name}",
		{"reservation": doc.name, "intent": "website_deposit"},
	)
	order.update({"reference": doc.name, "deposit_due": due, "deposit_required": required, "deposit_paid": paid})
	return order


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=10, seconds=3600)
def guest_capture_deposit(
	reference=None, email=None, razorpay_order_id=None, razorpay_payment_id=None, razorpay_signature=None,
):
	"""Verify a Razorpay deposit payment and post it to the booking's folio.

	Defence in depth: booker-email gate, HMAC signature verification, and the
	captured amount re-fetched from Razorpay's API (client-supplied amounts are
	never trusted). Idempotent on the Razorpay payment id."""
	doc = _verified_booking(reference, email)

	from the_reezort.billing.razorpay_gateway import (
		_authoritative_amount,
		_ensure_razorpay_mode_of_payment,
		verify_signature,
	)

	if not verify_signature(razorpay_order_id, razorpay_payment_id, razorpay_signature):
		frappe.throw(_("Payment verification failed."))
	amount = _authoritative_amount(razorpay_payment_id, razorpay_order_id)
	if amount <= 0:
		frappe.throw(_("Payment amount could not be verified."))

	from the_reezort.billing.api import get_or_create_folio
	from the_reezort.billing.deposits import record_deposit
	from the_reezort.reservation.api import _deposit_paid_on_reservation

	with _as_system():
		mode = _ensure_razorpay_mode_of_payment()
		folio = get_or_create_folio(reservation=doc.name)["data"]["folio"]["name"]
		record_deposit(
			guest_folio=folio,
			amount=amount,
			mode_of_payment=mode,
			reference_no=razorpay_payment_id,
			idempotency_key=f"web-deposit:{razorpay_payment_id}",
		)

	due, _required, paid = _deposit_due(doc)
	if due <= 0:
		frappe.db.set_value("Reservation", doc.name, "deposit_status", "Paid")
	else:
		frappe.db.set_value(
			"Reservation", doc.name, {"status": "Deposit Pending", "deposit_status": "Partially Paid"}
		)
	frappe.db.commit()

	from the_reezort.audit.api import record_audit_event

	record_audit_event(
		"Reservation", doc.name, "guest_booking.deposit_captured", "",
		{"amount": amount, "payment_id": razorpay_payment_id, "paid_total": paid},
	)
	return {
		"reference": doc.name,
		"amount": amount,
		"deposit_paid": paid,
		"deposit_outstanding": due,
		"deposit_status": "Paid" if due <= 0 else "Partially Paid",
	}
