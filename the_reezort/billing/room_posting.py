"""Generic outlet → room posting (spec 004).

Lets any department (spa, laundry, transport, recreation, telephone, misc)
post an incidental charge to an in-house guest's folio starting from the room
or stay — without navigating into the folio workspace. This is the general
sibling of the restaurant-specific `fnb.restaurant.post_order_to_room`.

Only positive Charge lines are posted here; discounts/adjustments still go
through the finance-gated `billing.api.add_folio_line` path.
"""

import frappe
from frappe import _
from frappe.utils import flt, today

from the_reezort.audit.api import record_audit_event
from the_reezort.billing.api import _folio_totals, get_or_create_folio
from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission

# Departments allowed to post an incidental to a room.
POSTING_DEPARTMENTS = ("Spa", "Laundry", "Transport", "Recreation", "Business Center", "Telephone", "Minibar", "Misc")
_CLOSED_FOLIO_STATUSES = {"Settled", "Closed", "Cancelled", "Transferred"}


def _resolve_in_house_stay(stay=None, room=None):
	fields = ["name", "stay_status", "current_room", "primary_guest_name", "customer", "resort_property"]
	if stay:
		return frappe.db.get_value("Stay", stay, fields, as_dict=True)
	if room:
		return frappe.db.get_value(
			"Stay", {"current_room": room, "stay_status": "In House"}, fields, as_dict=True
		)
	return None


@frappe.whitelist()
def list_postable_rooms(search=None, limit=25):
	"""In-house stays a department can post a charge to."""
	_require_permission("Guest Folio", "read")
	rows = frappe.get_all(
		"Stay",
		filters={"stay_status": "In House"},
		fields=["name", "primary_guest_name", "current_room", "resort_property"],
		order_by="modified desc",
		limit_page_length=int(limit or 25),
	)
	if search:
		s = str(search).lower()
		rows = [
			r for r in rows
			if s in (r.primary_guest_name or "").lower() or s in (r.current_room or "").lower()
		]
	return _envelope({"rooms": rows})


@frappe.whitelist()
def validate_room_posting_target(stay=None, room=None):
	"""Pre-check: resolve the in-house guest + folio and whether a charge can be
	posted. Drives the department 'charge to room' screen before it posts."""
	_require_permission("Guest Folio", "read")
	row = _resolve_in_house_stay(stay, room)
	if not row:
		return _envelope({"postable": False, "reason": _("No in-house stay found for that room.")})
	if row.stay_status != "In House":
		return _envelope(
			{"postable": False, "stay": row.name, "reason": _("Stay is {0}, not In House.").format(row.stay_status)}
		)
	folio = frappe.db.get_value("Guest Folio", {"stay": row.name}, ["name", "folio_status"], as_dict=True)
	closed = bool(folio and folio.folio_status in _CLOSED_FOLIO_STATUSES)
	return _envelope(
		{
			"postable": not closed,
			"stay": row.name,
			"room": row.current_room,
			"guest_name": row.primary_guest_name,
			"folio": folio.name if folio else None,
			"folio_status": folio.folio_status if folio else "Not Created",
			"reason": _("Folio is {0}.").format(folio.folio_status) if closed else None,
		}
	)


@frappe.whitelist()
def post_charge_to_room(
	stay=None, room=None, description=None, amount=None, department="Misc",
	item_code=None, qty=1, service_date=None, idempotency_key=None,
):
	"""Post a positive department incidental to an in-house guest's folio."""
	_require_permission("Guest Folio", "write")
	target = validate_room_posting_target(stay=stay, room=room)["data"]
	if not target.get("postable"):
		frappe.throw(target.get("reason") or _("Cannot post to this room."))
	if not description or not str(description).strip():
		frappe.throw(_("A description is required."))
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Amount must be greater than zero."))
	if department not in POSTING_DEPARTMENTS:
		department = "Misc"

	stay_name = target["stay"]
	customer = frappe.db.get_value("Stay", stay_name, "customer")
	folio = get_or_create_folio(stay=stay_name, customer=customer)["data"]["folio"]["name"]

	qty = flt(qty) or 1
	rate = amount / qty
	key = idempotency_key or f"room-charge:{department}:{stay_name}:{frappe.generate_hash(length=10)}"
	line = frappe.get_doc(
		{
			"doctype": "Folio Line",
			"guest_folio": folio,
			"line_type": "Charge",
			"source_module": department,
			"department": department,
			"idempotency_key": key,
			"service_date": service_date or today(),
			"item_code": item_code,
			"description": str(description).strip(),
			"qty": qty,
			"rate": rate,
			"amount": amount,
			"tax_treatment": "Standard",
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()

	record_audit_event(
		"Guest Folio", folio, "billing.post_charge_to_room",
		description, {"department": department, "amount": amount, "folio_line": line.name},
	)
	return _envelope(
		{
			"folio": folio,
			"folio_line": line.name,
			"amount": amount,
			"department": department,
			"guest_name": target.get("guest_name"),
			"folio_totals": _folio_totals(frappe.get_doc("Guest Folio", folio)),
		}
	)
