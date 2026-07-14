"""PMS Stay Lifecycle — late checkout, no-show, checkout readiness, early departure, walk-in.

Endpoints that extend the core check-in/checkout spine in pms/api.py with the
remaining spec-required operational flows.
"""

import frappe
from frappe import _
from frappe.utils import now, today, getdate, get_time, flt, date_diff

from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import require_permission as _require_permission


# ── Late Checkout ──────────────────────────────────────────────────────────

@frappe.whitelist()
def request_late_checkout(stay, requested_checkout_time, reason=None):
    """Front desk requests a late checkout for an in-house stay."""
    _require_permission("Late Checkout Request", "create")
    stay_doc = frappe.get_doc("Stay", stay)
    if stay_doc.stay_status not in ("In House", "Due Out"):
        frappe.throw(_("Only an in-house stay can request late checkout (status is {0}).").format(stay_doc.stay_status))

    existing = frappe.db.get_value(
        "Late Checkout Request",
        {"stay": stay, "request_status": ["in", ["Pending", "Approved"]]},
        "name",
    )
    if existing:
        return {"late_checkout_request": existing, "reused": True}

    incoming = _check_incoming_conflict(stay_doc.current_room, stay_doc.departure_date)

    doc = frappe.get_doc({
        "doctype": "Late Checkout Request",
        "resort_property": stay_doc.resort_property,
        "stay": stay,
        "reservation": stay_doc.reservation,
        "guest_name": stay_doc.primary_guest_name,
        "room": stay_doc.current_room,
        "requested_checkout_time": requested_checkout_time,
        "request_status": "Pending",
        "reason": reason,
        "requested_by": frappe.session.user,
        "requested_at": now(),
        "affects_incoming": 1 if incoming else 0,
        "incoming_reservation": incoming,
    })
    doc.insert(ignore_permissions=True)
    return {"late_checkout_request": doc.name, "reused": False, "affects_incoming": bool(incoming)}


def _check_incoming_conflict(room, departure_date):
    """Check if there's an incoming reservation for this room on the departure date."""
    if not room or not departure_date:
        return None
    dep = getdate(departure_date)
    return frappe.db.get_value(
        "Reservation Room",
        {
            "room": room,
            "parent": ["!=", ""],
        },
        "parent",
        filters={
            "room": room,
        },
    ) if False else _find_incoming_reservation(room, dep)


def _find_incoming_reservation(room, departure_date):
    """Find a confirmed reservation arriving on the departure date for the same room."""
    reservations = frappe.get_all(
        "Reservation",
        filters={
            "status": ["in", ["Confirmed", "Modified"]],
            "arrival_date": departure_date,
        },
        fields=["name"],
    )
    for r in reservations:
        rooms = frappe.get_all(
            "Reservation Room",
            filters={"parent": r.name, "room": room},
            fields=["name"],
            limit=1,
        )
        if rooms:
            return r.name
    return None


@frappe.whitelist()
def approve_late_checkout(late_checkout_request, charge_policy="No Charge", rejection_reason=None, approve=1):
    """Manager approves or rejects a late checkout request."""
    _require_permission("Late Checkout Request", "write")
    doc = frappe.get_doc("Late Checkout Request", late_checkout_request)
    if doc.request_status != "Pending":
        frappe.throw(_("Request is already {0}.").format(doc.request_status))

    manager_roles = {"Front Office Manager", "Resort Manager", "System Manager"}
    if not (manager_roles & set(frappe.get_roles())):
        frappe.throw(_("Only a Front Office Manager or Resort Manager can approve late checkout."), frappe.PermissionError)

    if str(approve) in ("1", "true", "True"):
        doc.request_status = "Approved"
        doc.charge_policy = charge_policy
        doc.approved_by = frappe.session.user
        doc.approved_at = now()

        _notify_housekeeping_late_checkout(doc)
        doc.housekeeping_notified = 1
    else:
        doc.request_status = "Rejected"
        doc.rejection_reason = rejection_reason

    doc.save(ignore_permissions=True)
    return {
        "late_checkout_request": doc.name,
        "request_status": doc.request_status,
        "charge_policy": doc.charge_policy if doc.request_status == "Approved" else None,
    }


def _notify_housekeeping_late_checkout(lc_doc):
    """Update or create a housekeeping task flagging the late checkout."""
    if not lc_doc.room:
        return
    key = f"late-checkout:{lc_doc.stay}"
    existing = frappe.db.get_value("Housekeeping Task", {"idempotency_key": key}, "name")
    if existing:
        return

    rp, building, floor = frappe.db.get_value("Room", lc_doc.room, ["resort_property", "building", "floor"])
    frappe.get_doc({
        "doctype": "Housekeeping Task",
        "resort_property": rp or lc_doc.resort_property,
        "room": lc_doc.room,
        "building": building,
        "floor": floor,
        "task_type": "Late Checkout",
        "task_status": "Queued",
        "priority": "Medium",
        "requires_inspection": 0,
        "dnd_status": "None",
        "stay": lc_doc.stay,
        "source_doctype": "Late Checkout Request",
        "source_name": lc_doc.name,
        "idempotency_key": key,
    }).insert(ignore_permissions=True)


@frappe.whitelist()
def list_late_checkout_requests(resort_property=None, status=None):
    """List late checkout requests for the front desk queue."""
    _require_permission("Late Checkout Request", "read")
    filters = {}
    if resort_property:
        filters["resort_property"] = resort_property
    if status:
        filters["request_status"] = status
    return {
        "requests": frappe.get_all(
            "Late Checkout Request",
            filters=filters,
            fields=[
                "name", "stay", "guest_name", "room", "requested_checkout_time",
                "request_status", "charge_policy", "affects_incoming", "requested_at",
            ],
            order_by="requested_at desc",
        )
    }


# ── No-Show ───────────────────────────────────────────────────────────────

@frappe.whitelist()
def mark_no_show(reservation, reason, fee_applicable=0, fee_amount=0):
    """Mark a reservation as no-show after cutoff. Releases room allocation."""
    _require_permission("No Show Record", "create")
    res = frappe.get_doc("Reservation", reservation)

    checked_in = frappe.db.exists(
        "Stay", {"reservation": reservation, "stay_status": ["in", ("In House", "Due Out")]}
    )
    if checked_in:
        frappe.throw(_("Cannot mark no-show — guest is already checked in."))

    if res.status in ("Cancelled", "Completed"):
        frappe.throw(_("Reservation is already {0}.").format(res.status))

    existing = frappe.db.get_value(
        "No Show Record",
        {"reservation": reservation, "no_show_status": "No Show"},
        "name",
    )
    if existing:
        return {"no_show_record": existing, "reused": True}

    room_type = res.rooms[0].room_type if res.rooms else None
    allocated_room = res.rooms[0].room if res.rooms and res.rooms[0].room else None

    doc = frappe.get_doc({
        "doctype": "No Show Record",
        "resort_property": res.resort_property,
        "reservation": reservation,
        "guest_name": _reservation_guest_name(res),
        "room": allocated_room,
        "room_type": room_type,
        "no_show_status": "No Show",
        "marked_by": frappe.session.user,
        "marked_at": now(),
        "reason": reason,
        "fee_applicable": 1 if str(fee_applicable) in ("1", "true", "True") else 0,
        "fee_amount": flt(fee_amount),
    })
    doc.insert(ignore_permissions=True)

    if allocated_room:
        occ = frappe.db.get_value("Room", allocated_room, "occupancy_status")
        if occ in ("Allocated", "Due In"):
            frappe.db.set_value("Room", allocated_room, "occupancy_status", "Vacant")
        for rr in res.rooms:
            if rr.room == allocated_room:
                rr.room = None
                rr.status = "No Show"

    res.status = "No Show"
    res.save(ignore_permissions=True)

    return {"no_show_record": doc.name, "reused": False, "room_released": allocated_room}


def _reservation_guest_name(res):
    if res.staying_guest_profile:
        name = frappe.db.get_value("Guest Profile", res.staying_guest_profile, "guest_full_name")
        if name:
            return name
    for row in res.get("guests") or []:
        if row.guest_name:
            return row.guest_name
    return "Guest"


@frappe.whitelist()
def reverse_no_show(no_show_record, reversal_reason):
    """Reverse a no-show (manager approval required). Restores the reservation to Confirmed."""
    _require_permission("No Show Record", "write")
    doc = frappe.get_doc("No Show Record", no_show_record)
    if doc.no_show_status != "No Show":
        frappe.throw(_("This no-show has already been reversed."))

    manager_roles = {"Front Office Manager", "Resort Manager", "System Manager"}
    if not (manager_roles & set(frappe.get_roles())):
        frappe.throw(_("Only a Front Office Manager or Resort Manager can reverse a no-show."), frappe.PermissionError)

    if not (reversal_reason or "").strip():
        frappe.throw(_("A reversal reason is required."))

    doc.no_show_status = "Reversed"
    doc.reversed_by = frappe.session.user
    doc.reversed_at = now()
    doc.reversal_reason = reversal_reason.strip()
    doc.reversal_approved_by = frappe.session.user
    doc.save(ignore_permissions=True)

    res = frappe.get_doc("Reservation", doc.reservation)
    if res.status == "No Show":
        res.status = "Confirmed"
        if res.rooms:
            for rr in res.rooms:
                if rr.status == "No Show":
                    rr.status = "Confirmed"
        res.save(ignore_permissions=True)

    return {
        "no_show_record": doc.name,
        "no_show_status": "Reversed",
        "reservation": doc.reservation,
        "reservation_status": "Confirmed",
    }


@frappe.whitelist()
def list_no_show_eligible(resort_property=None):
    """Reservations eligible for no-show review: confirmed, arrival date <= today, not checked in."""
    _require_permission("No Show Record", "read")
    filters = {
        "status": ["in", ["Confirmed", "Modified"]],
        "arrival_date": ["<=", today()],
    }
    if resort_property:
        filters["resort_property"] = resort_property

    candidates = []
    for r in frappe.get_all("Reservation", filters=filters, fields=["name", "arrival_date", "departure_date", "staying_guest_profile", "resort_property"]):
        has_stay = frappe.db.exists("Stay", {"reservation": r.name, "stay_status": ["in", ("In House", "Due Out", "Checked Out")]})
        if has_stay:
            continue
        already_marked = frappe.db.exists("No Show Record", {"reservation": r.name, "no_show_status": "No Show"})
        if already_marked:
            continue
        room_row = frappe.get_all("Reservation Room", filters={"parent": r.name}, fields=["room_type", "room"], limit=1)
        candidates.append({
            "reservation": r.name,
            "guest": _reservation_guest_name(frappe.get_doc("Reservation", r.name)),
            "arrival_date": str(r.arrival_date),
            "room_type": room_row[0].room_type if room_row else None,
            "allocated_room": room_row[0].room if room_row and room_row[0].room else None,
        })

    return {"eligible": candidates}


# ── Checkout Readiness ─────────────────────────────────────────────────────

@frappe.whitelist()
def get_checkout_readiness(stay):
    """Return a structured blocker checklist for checkout."""
    _require_permission("Stay", "read")
    stay_doc = frappe.get_doc("Stay", stay)
    blockers = []
    warnings = []

    folio = frappe.db.get_value("Guest Folio", {"stay": stay}, ["name", "folio_status", "outstanding_amount"], as_dict=True)
    if folio:
        if folio.folio_status in ("Draft", "Open", "Under Review"):
            blockers.append({"type": "folio", "message": f"Folio is {folio.folio_status} — settle before checkout", "folio": folio.name})
        if flt(folio.outstanding_amount) > 0:
            blockers.append({"type": "outstanding", "message": f"Outstanding balance: ₹{flt(folio.outstanding_amount):,.2f}", "folio": folio.name})
    else:
        warnings.append({"type": "no_folio", "message": "No folio found for this stay"})

    if stay_doc.current_room:
        pending_minibar = frappe.db.count("Minibar Posting", {
            "room": stay_doc.current_room,
            "posting_status": "Draft",
        }) if frappe.db.exists("DocType", "Minibar Posting") else 0
        if pending_minibar:
            blockers.append({"type": "minibar", "message": f"{pending_minibar} unposted minibar posting(s)"})

        pending_inspection = frappe.db.count("Room Inspection", {
            "room": stay_doc.current_room,
            "inspection_result": ["in", ["Pending", ""]],
        }) if frappe.db.exists("DocType", "Room Inspection") else 0
        if pending_inspection:
            warnings.append({"type": "inspection", "message": "Room inspection pending"})

    open_requests = frappe.db.count("Guest Request", {
        "stay": stay,
        "request_status": ["in", ["Open", "Assigned", "In Progress"]],
    }) if frappe.db.exists("DocType", "Guest Request") else 0
    if open_requests:
        warnings.append({"type": "guest_requests", "message": f"{open_requests} open guest request(s)"})

    open_complaints = frappe.db.count("Guest Complaint", {
        "stay": stay,
        "complaint_status": ["not in", ["Resolved", "Closed", "Withdrawn"]],
    }) if frappe.db.exists("DocType", "Guest Complaint") else 0
    if open_complaints:
        warnings.append({"type": "complaints", "message": f"{open_complaints} unresolved complaint(s)"})

    open_approvals = frappe.db.count("Approval Request", {
        "reference_doctype": "Stay",
        "reference_name": stay,
        "approval_status": "Pending",
    }) if frappe.db.exists("DocType", "Approval Request") else 0
    if open_approvals:
        blockers.append({"type": "approvals", "message": f"{open_approvals} pending approval(s)"})

    condition_captured = frappe.db.exists("Room Condition Capture", {"stay": stay, "capture_stage": "Check-Out"})
    if not condition_captured:
        warnings.append({"type": "condition_capture", "message": "Check-out condition photos not captured"})

    can_checkout = len(blockers) == 0

    return {
        "stay": stay,
        "guest": stay_doc.primary_guest_name,
        "room": stay_doc.current_room,
        "departure_date": str(stay_doc.departure_date) if stay_doc.departure_date else None,
        "blockers": blockers,
        "warnings": warnings,
        "can_checkout": can_checkout,
    }


# ── Early Departure ────────────────────────────────────────────────────────

@frappe.whitelist()
def early_departure(stay, new_departure_date, reason=None):
    """Shorten a stay to an earlier departure date. Notifies housekeeping."""
    _require_permission("Stay", "write")
    stay_doc = frappe.get_doc("Stay", stay)
    if stay_doc.stay_status not in ("In House", "Due Out"):
        frappe.throw(_("Only an in-house stay can depart early (status is {0}).").format(stay_doc.stay_status))

    new_dep = getdate(new_departure_date)
    cur_dep = getdate(stay_doc.departure_date)
    if new_dep >= cur_dep:
        frappe.throw(_("New departure must be before the current departure ({0}).").format(cur_dep))

    arr = getdate(stay_doc.arrival_date)
    if new_dep <= arr:
        frappe.throw(_("New departure must be after the arrival date ({0}).").format(arr))

    frappe.db.set_value("Stay", stay, {
        "departure_date": new_dep,
        "stay_status": "Due Out",
    })

    if stay_doc.reservation:
        frappe.db.set_value("Reservation", stay_doc.reservation, "departure_date", new_dep)

    if stay_doc.current_room:
        key = f"early-departure:{stay}"
        existing = frappe.db.get_value("Housekeeping Task", {"idempotency_key": key}, "name")
        if not existing:
            rp, building, floor = frappe.db.get_value("Room", stay_doc.current_room, ["resort_property", "building", "floor"])
            frappe.get_doc({
                "doctype": "Housekeeping Task",
                "resort_property": rp or stay_doc.resort_property,
                "room": stay_doc.current_room,
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
                "notes": f"Early departure — original checkout {cur_dep}",
            }).insert(ignore_permissions=True)

    return {
        "stay": stay,
        "new_departure_date": str(new_dep),
        "original_departure_date": str(cur_dep),
        "nights_shortened": date_diff(cur_dep, new_dep),
        "reason": reason,
    }


# ── Walk-In Check-In ──────────────────────────────────────────────────────

@frappe.whitelist()
def walk_in_check_in(resort_property, room_type, guest_name, nights=1, adults=1, children=0, room=None, phone=None, email=None):
    """Create a reservation + check in atomically for a walk-in guest."""
    _require_permission("Stay", "create")

    if not frappe.db.exists("Resort Property", resort_property):
        frappe.throw(_("Resort Property {0} does not exist.").format(resort_property))
    if not frappe.db.exists("Room Type", room_type):
        frappe.throw(_("Room Type {0} does not exist.").format(room_type))

    arrival = getdate(today())
    departure = frappe.utils.add_days(arrival, int(nights) or 1)

    guest_profile = frappe.get_doc({
        "doctype": "Guest Profile",
        "guest_full_name": guest_name,
        "phone": phone,
        "email": email,
        "nationality": "Indian",
    })
    guest_profile.insert(ignore_permissions=True)

    customer = None
    if frappe.db.exists("DocType", "Customer"):
        existing_customer = frappe.db.get_value("Customer", {"customer_name": guest_name}, "name")
        if existing_customer:
            customer = existing_customer
        else:
            cust = frappe.get_doc({
                "doctype": "Customer",
                "customer_name": guest_name,
                "customer_type": "Individual",
                "customer_group": frappe.db.get_single_value("Selling Settings", "customer_group") or "Individual",
                "territory": frappe.db.get_single_value("Selling Settings", "territory") or "India",
            })
            cust.insert(ignore_permissions=True)
            customer = cust.name

    frappe.db.set_value("Guest Profile", guest_profile.name, "erpnext_customer", customer)

    res = frappe.get_doc({
        "doctype": "Reservation",
        "resort_property": resort_property,
        "arrival_date": arrival,
        "departure_date": departure,
        "status": "Confirmed",
        "source": "Walk-In",
        "staying_guest_profile": guest_profile.name,
        "erpnext_customer": customer,
        "guests": [{"guest_name": guest_name, "is_primary_guest": 1, "email": email, "phone": phone}],
        "rooms": [{"room_type": room_type, "room": room, "adults": int(adults) or 1, "children": int(children) or 0, "status": "Confirmed"}],
    })
    res.insert(ignore_permissions=True)

    from the_reezort.pms.api import check_in
    result = check_in(res.name, room=room)

    return {
        "reservation": res.name,
        "guest_profile": guest_profile.name,
        "customer": customer,
        **result,
    }
