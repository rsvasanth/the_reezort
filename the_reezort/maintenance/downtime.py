"""Downtime and release API surface for module 009 — spec contracts/api.md.

Endpoints (exact signatures per contract):
  · create_room_downtime(payload)
  · extend_room_downtime(room_downtime, expected_release_at, reason, approval=None)
  · request_room_release(room_downtime, notes=None)
  · verify_and_release_room(room_downtime, verification)
  · get_room_downtime_board(property, filters=None)
  · get_engineering_board(property, filters=None)
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import now_datetime

from the_reezort.staff.api import _envelope
from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import require_permission as _require_permission

# SQL cannot express this ordering here: Frappe's order_by validator splits on
# commas and rejects the FIELD() expression this used to rely on, which threw
# for every caller and meant the board never loaded. Rank in Python instead.
_DOWNTIME_PRIORITY_RANK = {"Safety Critical": 0, "Revenue Blocking": 1, "Guest Impacting": 2, "Urgent": 3, "High": 4, "Normal": 5, "Low": 6}


# ---------- helpers ----------


def _get_engineering_settings(resort_property: str):
    """Return Engineering Settings doc for property (auto-created with defaults)."""
    from the_reezort.the_reezort.doctype.engineering_settings.engineering_settings import (
        _get_or_create,
    )
    return _get_or_create(resort_property)


def _downtime_dict(doc) -> dict:
    return {
        "name": doc.name,
        "resort_property": doc.resort_property,
        "room": doc.room,
        "maintenance_ticket": doc.maintenance_ticket,
        "downtime_type": doc.downtime_type,
        "downtime_status": doc.downtime_status,
        "revenue_impact_class": doc.revenue_impact_class,
        "housekeeping_required": bool(doc.housekeeping_required),
        "start_at": str(doc.start_at) if doc.start_at else None,
        "expected_release_at": str(doc.expected_release_at) if doc.expected_release_at else None,
        "actual_release_at": str(doc.actual_release_at) if doc.actual_release_at else None,
        "extension_count": doc.extension_count or 0,
        "reason": doc.reason,
        "affected_reservation": doc.affected_reservation,
        "affected_stay": doc.affected_stay,
        "approved_by": doc.approved_by,
        "release_verified_by": doc.release_verified_by,
    }


def _require_downtime_permission(perm: str = "read") -> None:
    _require_permission("Room Downtime", perm)


def _create_post_repair_housekeeping_task(room: str, source_name: str) -> str | None:
    """Create a Maintenance Follow-up housekeeping task for a room post-repair.

    Attempts to call housekeeping.api.create_task first. Falls back to a direct
    Housekeeping Task insert if that function is unavailable.
    Returns the task name or None on failure.
    """
    try:
        from the_reezort.housekeeping.api import create_task as _hk_create_task

        import hashlib
        h = hashlib.md5()
        h.update(f"post-repair:{source_name}:{room}".encode())
        idem_key = f"prc:{h.hexdigest()[:16]}"

        result = _hk_create_task({
            "room": room,
            "task_type": "Maintenance Follow-up",
            "task_status": "Queued",
            "priority": "High",
            "source_doctype": "Room Downtime",
            "source_name": source_name,
            "idempotency_key": idem_key,
        })
        return result.get("data", {}).get("task", {}).get("name")
    except Exception:
        pass

    # Fallback: direct insert.
    try:
        import hashlib
        h = hashlib.md5()
        h.update(f"post-repair:{source_name}:{room}".encode())
        idem_key = f"prc:{h.hexdigest()[:16]}"

        existing = frappe.db.get_value(
            "Housekeeping Task", {"idempotency_key": idem_key}, "name"
        )
        if existing:
            return existing

        resort_property = frappe.db.get_value("Room", room, "resort_property")
        hk_doc = frappe.get_doc({
            "doctype": "Housekeeping Task",
            "resort_property": resort_property,
            "room": room,
            "task_type": "Maintenance Follow-up",
            "task_status": "Queued",
            "priority": "High",
            "source_doctype": "Room Downtime",
            "source_name": source_name,
            "idempotency_key": idem_key,
        })
        hk_doc.insert(ignore_permissions=True)
        return hk_doc.name
    except Exception:
        return None


# ---------- endpoints ----------


@frappe.whitelist()
def create_room_downtime(payload: dict | str) -> dict:
    """Create a Room Downtime and block the room.

    Required payload fields: room, maintenance_ticket, downtime_type,
    start_at, expected_release_at, reason, revenue_impact_class.

    For Out of Order downtime, require_supervisor_for_ooo from Engineering
    Settings enforces that approved_by is supplied.
    """
    _require_downtime_permission("create")
    payload = _as_dict(payload)

    # Basic required fields.
    for field in ("room", "maintenance_ticket", "downtime_type", "start_at",
                  "expected_release_at", "reason"):
        if not payload.get(field):
            frappe.throw(_("{0} is required for Room Downtime.").format(field))

    room = payload["room"]
    ticket_name = payload["maintenance_ticket"]

    if not frappe.db.exists("Room", room):
        frappe.throw(_("Room {0} does not exist.").format(room))
    if not frappe.db.exists("Maintenance Ticket", ticket_name):
        frappe.throw(_("Maintenance Ticket {0} does not exist.").format(ticket_name))

    # Fetch property from the ticket.
    resort_property = frappe.db.get_value("Maintenance Ticket", ticket_name, "resort_property")

    # Engineering settings gate for OOO.
    settings = _get_engineering_settings(resort_property)
    if (
        payload["downtime_type"] == "Out of Order"
        and settings.require_supervisor_for_ooo
        and not payload.get("approved_by")
    ):
        frappe.throw(
            _("Out of Order downtime requires supervisor approval (approved_by). "
              "Engineering Settings: require_supervisor_for_ooo is enabled.")
        )

    housekeeping_required = int(
        payload.get("housekeeping_required",
                    int(settings.require_housekeeping_after_repair))
    )

    dt_doc = frappe.get_doc({
        "doctype": "Room Downtime",
        "resort_property": resort_property,
        "room": room,
        "maintenance_ticket": ticket_name,
        "downtime_type": payload["downtime_type"],
        "downtime_status": "Active",
        "start_at": payload["start_at"],
        "expected_release_at": payload["expected_release_at"],
        "reason": payload["reason"],
        "revenue_impact_class": payload.get("revenue_impact_class") or "None",
        "housekeeping_required": housekeeping_required,
        "affected_reservation": payload.get("affected_reservation"),
        "affected_stay": payload.get("affected_stay"),
        "approved_by": payload.get("approved_by"),
        "extension_count": 0,
    })
    dt_doc.insert(ignore_permissions=True)

    # Link downtime + set revenue_blocking on the ticket.
    frappe.db.set_value(
        "Maintenance Ticket",
        ticket_name,
        {"downtime": dt_doc.name, "revenue_blocking": 1},
        update_modified=True,
    )

    return _envelope(
        {"downtime": _downtime_dict(dt_doc)},
        next_actions=["request_room_release"],
    )


@frappe.whitelist()
def extend_room_downtime(
    room_downtime: str,
    expected_release_at: str,
    reason: str,
    approval: str | None = None,
) -> dict:
    """Extend the expected release date of an active/extended downtime."""
    _require_downtime_permission("write")
    if not frappe.db.exists("Room Downtime", room_downtime):
        frappe.throw(_("Room Downtime {0} does not exist.").format(room_downtime))

    doc = frappe.get_doc("Room Downtime", room_downtime)
    if doc.downtime_status not in ("Active", "Extended"):
        frappe.throw(
            _("Can only extend Active or Extended downtime; current status: {0}.").format(
                doc.downtime_status
            )
        )
    if not expected_release_at:
        frappe.throw(_("expected_release_at is required."))
    if not reason:
        frappe.throw(_("reason is required for extension."))

    doc.expected_release_at = expected_release_at
    doc.downtime_status = "Extended"
    doc.extension_count = (doc.extension_count or 0) + 1
    doc.reason = (doc.reason or "") + f"\n[Extension {doc.extension_count}] {reason}"
    if approval:
        doc.approved_by = approval
    doc.save(ignore_permissions=True)

    return _envelope({"downtime": _downtime_dict(doc)})


@frappe.whitelist()
def request_room_release(room_downtime: str, notes: str | None = None) -> dict:
    """Signal that repair is complete and release verification can begin.

    Downtime → Pending Release; linked Maintenance Ticket → Verification Required.
    """
    _require_downtime_permission("write")
    if not frappe.db.exists("Room Downtime", room_downtime):
        frappe.throw(_("Room Downtime {0} does not exist.").format(room_downtime))

    doc = frappe.get_doc("Room Downtime", room_downtime)
    if doc.downtime_status not in ("Active", "Extended"):
        frappe.throw(
            _("Can only request release from Active or Extended downtime; "
              "current status: {0}.").format(doc.downtime_status)
        )

    doc.downtime_status = "Pending Release"
    doc.save(ignore_permissions=True)

    # Transition the linked ticket to Verification Required if applicable.
    ticket_name = doc.maintenance_ticket
    if ticket_name:
        ticket_state = frappe.db.get_value("Maintenance Ticket", ticket_name, "state")
        if ticket_state == "Resolved":
            frappe.db.set_value(
                "Maintenance Ticket",
                ticket_name,
                "state",
                "Verification Required",
                update_modified=True,
            )
            if notes:
                t_doc = frappe.get_doc("Maintenance Ticket", ticket_name)
                existing = (t_doc.get("technical_notes") or "").strip()
                stamp = f"[{now_datetime().strftime('%Y-%m-%d %H:%M')} {frappe.session.user}] "
                t_doc.technical_notes = (existing + "\n" + stamp + notes).strip()
                t_doc.save(ignore_permissions=True)

    return _envelope(
        {"downtime": _downtime_dict(doc)},
        next_actions=["verify_and_release_room"],
    )


@frappe.whitelist()
def verify_and_release_room(room_downtime: str, verification: dict | str) -> dict:
    """Complete release verification for a room.

    Creates a Maintenance Release Verification record.
    If verification passes:
      - Downtime → Released (restores room maintenance status).
      - Ticket → Released.
      - If housekeeping required: creates post-repair housekeeping task.
    If verification fails / Housekeeping Required:
      - Keeps downtime in Pending Release; links housekeeping task.
    """
    _require_downtime_permission("write")
    verification = _as_dict(verification)

    if not frappe.db.exists("Room Downtime", room_downtime):
        frappe.throw(_("Room Downtime {0} does not exist.").format(room_downtime))

    dt_doc = frappe.get_doc("Room Downtime", room_downtime)
    if dt_doc.downtime_status != "Pending Release":
        frappe.throw(
            _("Can only verify a Pending Release downtime; "
              "current status: {0}.").format(dt_doc.downtime_status)
        )

    resort_property = dt_doc.resort_property
    settings = _get_engineering_settings(resort_property)

    # Supervisor approval gate for release.
    supervisor_roles = {"Resort Manager", "System Manager"}
    if (
        settings.require_supervisor_for_release
        and not verification.get("verified_by")
        and not (supervisor_roles & set(frappe.get_roles()))
    ):
        frappe.throw(
            _("Release verification requires supervisor approval. "
              "Engineering Settings: require_supervisor_for_release is enabled.")
        )

    now = now_datetime()
    verification_status = verification.get("verification_status") or "Passed"
    notes = verification.get("notes") or ""

    # Determine if housekeeping task needs to be created.
    hk_task_name = None
    need_housekeeping = (
        dt_doc.housekeeping_required
        or settings.require_housekeeping_after_repair
        or verification_status == "Housekeeping Required"
    )

    if need_housekeeping:
        hk_task_name = _create_post_repair_housekeeping_task(dt_doc.room, room_downtime)

    # Create the verification record.
    mrv = frappe.get_doc({
        "doctype": "Maintenance Release Verification",
        "maintenance_ticket": dt_doc.maintenance_ticket,
        "room_downtime": room_downtime,
        "verification_status": verification_status,
        "verified_by": verification.get("verified_by") or frappe.session.user,
        "verified_at": now,
        "notes": notes,
        "housekeeping_task": hk_task_name,
    })
    mrv.insert(ignore_permissions=True)

    blockers: list[dict] = []

    if verification_status == "Passed":
        # Release the downtime — controller handles room maintenance_status restore.
        dt_doc.downtime_status = "Released"
        dt_doc.actual_release_at = now
        dt_doc.release_verified_by = mrv.verified_by
        dt_doc.save(ignore_permissions=True)

        # Advance ticket to Released.
        ticket_name = dt_doc.maintenance_ticket
        if ticket_name:
            ticket_state = frappe.db.get_value("Maintenance Ticket", ticket_name, "state")
            if ticket_state in ("Verification Required", "Resolved"):
                frappe.db.set_value(
                    "Maintenance Ticket",
                    ticket_name,
                    {"state": "Released", "released_at": now},
                    update_modified=True,
                )

    elif verification_status in ("Failed", "Housekeeping Required"):
        # Stay in Pending Release; flag the blockers.
        blockers.append({
            "code": "verification_failed",
            "message": _("Verification {0}. Room remains blocked.").format(verification_status),
            "detail": {"housekeeping_task": hk_task_name},
        })
    elif verification_status == "Cancelled":
        pass  # No state change.

    return _envelope(
        {
            "verification": {
                "name": mrv.name,
                "verification_status": mrv.verification_status,
                "verified_by": mrv.verified_by,
                "verified_at": str(mrv.verified_at),
                "housekeeping_task": hk_task_name,
                "notes": notes,
            },
            "downtime": _downtime_dict(dt_doc),
        },
        blockers=blockers,
    )


@frappe.whitelist()
def get_room_downtime_board(property: str, filters: dict | str | None = None) -> dict:
    """Board view: all Room Downtimes for a property with optional filters.

    filters dict may include: downtime_status, downtime_type, room.
    """
    _require_downtime_permission("read")
    filters = _as_dict(filters) if filters else {}

    query_filters: dict = {"resort_property": property}
    if filters.get("downtime_status"):
        query_filters["downtime_status"] = ["in", filters["downtime_status"]] \
            if isinstance(filters["downtime_status"], list) \
            else filters["downtime_status"]
    if filters.get("downtime_type"):
        query_filters["downtime_type"] = filters["downtime_type"]
    if filters.get("room"):
        query_filters["room"] = filters["room"]

    rows = frappe.get_all(
        "Room Downtime",
        filters=query_filters,
        fields=["name"],
        order_by="start_at desc",
        limit_page_length=200,
    )
    downtimes = [_downtime_dict(frappe.get_doc("Room Downtime", r.name)) for r in rows]

    counts: dict[str, int] = {}
    for d in downtimes:
        counts[d["downtime_status"]] = counts.get(d["downtime_status"], 0) + 1

    return _envelope({"downtimes": downtimes, "counts": counts})


@frappe.whitelist()
def get_engineering_board(property: str, filters: dict | str | None = None) -> dict:
    """Engineering control board: open tickets for a property with optional filters.

    filters dict may include: state (list or str), priority, room, assigned_to.
    """
    _require_permission_ticket("read")
    filters = _as_dict(filters) if filters else {}

    from the_reezort.maintenance.api import (
        OPEN_STATES,
        _ticket_dict,
    )

    query_filters: dict = {"resort_property": property}
    states = filters.get("state")
    if states:
        if isinstance(states, str):
            states = [states]
        query_filters["state"] = ["in", states]
    else:
        query_filters["state"] = ["in", list(OPEN_STATES)]

    if filters.get("priority"):
        query_filters["priority"] = filters["priority"]
    if filters.get("room"):
        query_filters["room"] = filters["room"]
    if filters.get("assigned_to"):
        query_filters["assigned_to"] = filters["assigned_to"]

    rows = frappe.get_all(
        "Maintenance Ticket",
        filters=query_filters,
        fields=["name"],
        order_by="escalated desc, reported_at asc",
        limit_page_length=200,
    )
    tickets = [_ticket_dict(frappe.get_doc("Maintenance Ticket", r.name)) for r in rows]
    tickets.sort(key=lambda t: (
    	0 if t.get("escalated") else 1,
    	_DOWNTIME_PRIORITY_RANK.get(t.get("priority"), len(_DOWNTIME_PRIORITY_RANK)),
    ))

    counts: dict[str, int] = {}
    for t in tickets:
        counts[t["state"]] = counts.get(t["state"], 0) + 1

    overdue = sum(1 for t in tickets if t.get("is_overdue"))

    return _envelope({"tickets": tickets, "counts": counts, "overdue": overdue})


def _require_permission_ticket(perm: str = "read") -> None:
    _require_permission("Maintenance Ticket", perm)
