"""Guest Services API — module 010 request-core endpoints.

Endpoints in this file:
  create_guest_request(payload)
  assign_guest_request(guest_request, assigned_to, department, reason)
  update_guest_request_status(guest_request, status, note)
  verify_guest_request(guest_request, satisfaction)
  get_service_console(resort_property, filters)

Settings helpers forwarded from the doctype controller:
  get_guest_service_settings / update_guest_service_settings are exposed in
  guest_service_settings.py and do NOT need re-exporting here.
"""

import frappe
from frappe import _
from frappe.utils import add_to_date, now_datetime

from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission

# ---------- internal helpers ----------

_VALID_TRANSITIONS = {
    "New": {"Acknowledged", "Assigned", "In Progress", "Cancelled"},
    "Acknowledged": {"Assigned", "In Progress", "Cancelled"},
    "Assigned": {"In Progress", "Waiting for Department", "Waiting for Vendor", "Escalated", "Cancelled"},
    "In Progress": {
        "Waiting for Guest", "Waiting for Department", "Waiting for Vendor",
        "Escalated", "Completed", "Cancelled",
    },
    "Waiting for Guest": {"In Progress", "Completed", "Cancelled", "Escalated"},
    "Waiting for Department": {"In Progress", "Escalated", "Cancelled"},
    "Waiting for Vendor": {"In Progress", "Escalated", "Cancelled"},
    "Escalated": {"In Progress", "Completed", "Cancelled"},
    "Completed": {"Verified", "Reopened", "Closed"},
    "Verified": {"Closed", "Reopened"},
    "Reopened": {"Assigned", "In Progress", "Cancelled"},
    "Closed": set(),
    "Cancelled": set(),
}

_OPEN_STATUSES = [
    "New", "Acknowledged", "Assigned", "In Progress",
    "Waiting for Guest", "Waiting for Department", "Waiting for Vendor",
    "Escalated", "Reopened",
]


def _resolve_sla(request_type_name, priority, department, resort_property):
    """Return (response_minutes, resolution_minutes) by matching Service SLA Rule.

    Match order (most-specific first):
      1. property + request_type + priority + department
      2. property + request_type + priority
      3. property + request_type
      4. request_type + priority (cross-property)
      5. request_type
      6. Fall back to Guest Service Settings defaults
    """
    filters_candidates = [
        {"resort_property": resort_property, "request_type": request_type_name, "priority": priority, "department": department},
        {"resort_property": resort_property, "request_type": request_type_name, "priority": priority},
        {"resort_property": resort_property, "request_type": request_type_name},
        {"request_type": request_type_name, "priority": priority},
        {"request_type": request_type_name},
    ]

    for f in filters_candidates:
        f["is_active"] = 1
        row = frappe.db.get_value(
            "Service SLA Rule",
            f,
            ["response_minutes", "resolution_minutes"],
            as_dict=True,
        )
        if row:
            return row["response_minutes"], row["resolution_minutes"]

    # Fall back to Guest Service Settings
    settings_name = frappe.db.get_value(
        "Guest Service Settings", {"resort_property": resort_property}, "name"
    )
    if settings_name:
        sla_mins = frappe.db.get_value(
            "Guest Service Settings", settings_name, "default_request_sla_minutes"
        ) or 60
    else:
        sla_mins = 60
    return sla_mins, sla_mins * 2


def _request_payload(doc):
    return {
        "guest_request": doc.name,
        "status": doc.status,
        "priority": doc.priority,
        "department": doc.department,
        "assigned_to": doc.assigned_to,
        "subject": doc.subject,
        "response_due_at": str(doc.response_due_at) if doc.response_due_at else None,
        "resolution_due_at": str(doc.resolution_due_at) if doc.resolution_due_at else None,
        "completed_at": str(doc.completed_at) if doc.completed_at else None,
        "closed_at": str(doc.closed_at) if doc.closed_at else None,
        "guest_satisfaction": doc.guest_satisfaction,
    }


def _check_duplicate(doc):
    """Return a warning message if an active request already exists for the same
    guest+room+request_type combination."""
    if not doc.room or not doc.request_type:
        return None
    filters = {
        "room": doc.room,
        "request_type": doc.request_type,
        "status": ["in", _OPEN_STATUSES],
        "name": ["!=", doc.name],
    }
    if doc.guest_profile:
        filters["guest_profile"] = doc.guest_profile
    existing = frappe.db.get_value("Guest Request", filters, "name")
    if existing:
        return "Duplicate active request exists: {0}".format(existing)
    return None


# ---------- whitelisted endpoints ----------


@frappe.whitelist()
def create_guest_request(payload):
    """Create a new Guest Request.

    Resolves SLA due times from Service SLA Rule or Guest Service Settings.
    Returns a duplicate warning if a matching active request exists.
    """
    _require_permission("Guest Request", "create")
    payload = _as_dict(payload)

    required = ("property", "request_type", "subject")
    missing = [f for f in required if not payload.get(f)]
    if missing:
        frappe.throw(
            _("Missing required fields: {0}").format(", ".join(missing)),
            frappe.ValidationError,
        )

    has_context = any(payload.get(k) for k in ("stay", "reservation", "room", "guest_profile"))
    if not has_context:
        frappe.throw(
            _("Guest Request must include at least one of: stay, reservation, room, guest_profile."),
            frappe.ValidationError,
        )

    resort_property = payload["property"]
    request_type_name = payload["request_type"]
    priority = payload.get("priority", "Normal")

    # Resolve department: payload > request type default
    department = payload.get("department")
    if not department:
        department = frappe.db.get_value(
            "Guest Request Type", request_type_name, "default_department"
        ) or "Front Desk"

    # Resolve SLA
    resp_mins, res_mins = _resolve_sla(request_type_name, priority, department, resort_property)
    now = now_datetime()
    response_due_at = add_to_date(now, minutes=resp_mins)
    resolution_due_at = add_to_date(now, minutes=res_mins)

    # Resolve privacy_level from request type if not supplied
    privacy_level = payload.get("privacy_level")
    if not privacy_level:
        privacy_level = (
            frappe.db.get_value("Guest Request Type", request_type_name, "default_privacy_level")
            or "Normal"
        )

    doc = frappe.get_doc(
        {
            "doctype": "Guest Request",
            "resort_property": resort_property,
            "request_type": request_type_name,
            "status": "New",
            "priority": priority,
            "source": payload.get("source"),
            "guest_profile": payload.get("guest_profile"),
            "reservation": payload.get("reservation"),
            "stay": payload.get("stay"),
            "room": payload.get("room"),
            "guest_folio": payload.get("guest_folio"),
            "department": department,
            "subject": payload["subject"],
            "guest_visible_notes": payload.get("guest_visible_notes"),
            "internal_notes": payload.get("internal_notes"),
            "privacy_level": privacy_level,
            "response_due_at": response_due_at,
            "resolution_due_at": resolution_due_at,
            "source_reference": payload.get("source_reference"),
        }
    )
    doc.insert(ignore_permissions=True)

    warnings = []
    dup = _check_duplicate(doc)
    if dup:
        warnings.append(dup)

    return _envelope(_request_payload(doc), warnings=warnings or None)


@frappe.whitelist()
def assign_guest_request(guest_request, assigned_to, department=None, reason=None):
    """Assign a Guest Request to a staff member, transitioning status to Assigned."""
    _require_permission("Guest Request", "write")

    doc = frappe.get_doc("Guest Request", guest_request)
    current = doc.status

    allowed = _VALID_TRANSITIONS.get(current, set())
    if "Assigned" not in allowed:
        frappe.throw(
            _("Cannot assign a request in status '{0}'.").format(current),
            frappe.ValidationError,
            http_status_code=409,
        )

    if not frappe.db.exists("User", assigned_to):
        frappe.throw(_("User {0} does not exist.").format(assigned_to), frappe.ValidationError)

    doc.assigned_to = assigned_to
    if department:
        doc.department = department
    doc.status = "Assigned"
    if reason:
        existing = doc.internal_notes or ""
        doc.internal_notes = (existing + "\n" + reason).strip()
    doc.save(ignore_permissions=True)

    return _envelope(_request_payload(doc))


@frappe.whitelist()
def update_guest_request_status(guest_request, status, note=None):
    """Transition a Guest Request to a new status.

    Validates state machine. Appends optional note to guest_visible_notes or
    internal_notes (if status is terminal-adjacent, goes to internal_notes).
    """
    _require_permission("Guest Request", "write")

    doc = frappe.get_doc("Guest Request", guest_request)
    current = doc.status

    allowed = _VALID_TRANSITIONS.get(current, set())
    if status not in allowed:
        frappe.throw(
            _("Transition from '{0}' to '{1}' is not allowed.").format(current, status),
            frappe.ValidationError,
            http_status_code=409,
        )

    doc.status = status

    now = now_datetime()
    if status == "Acknowledged" and not doc.acknowledged_at:
        doc.acknowledged_at = now
    if status in ("Completed", "Verified") and not doc.completed_at:
        doc.completed_at = now
    if status == "Closed" and not doc.closed_at:
        doc.closed_at = now

    if note:
        doc.guest_visible_notes = ((doc.guest_visible_notes or "") + "\n" + note).strip()

    doc.save(ignore_permissions=True)

    result = _request_payload(doc)
    return _envelope(result)


@frappe.whitelist()
def verify_guest_request(guest_request, satisfaction):
    """Guest marks a completed request Satisfied, Neutral, or Not Satisfied.

    Not Satisfied automatically reopens the request.
    """
    _require_permission("Guest Request", "write")

    valid_satisfaction = {"Satisfied", "Neutral", "Not Satisfied"}
    if satisfaction not in valid_satisfaction:
        frappe.throw(
            _("Satisfaction must be one of: {0}.").format(", ".join(sorted(valid_satisfaction))),
            frappe.ValidationError,
        )

    doc = frappe.get_doc("Guest Request", guest_request)

    if doc.status not in ("Completed", "Verified"):
        frappe.throw(
            _("verify_guest_request can only be called on a Completed or Verified request (current: {0}).").format(
                doc.status
            ),
            frappe.ValidationError,
            http_status_code=409,
        )

    doc.guest_satisfaction = satisfaction
    if satisfaction == "Not Satisfied":
        doc.status = "Reopened"
        doc.guest_satisfaction = "Reopened"
    else:
        doc.status = "Verified"

    doc.save(ignore_permissions=True)

    return _envelope({"guest_request": doc.name, "status": doc.status, "guest_satisfaction": doc.guest_satisfaction})


@frappe.whitelist()
def get_service_console(resort_property, filters=None):
    """Return open requests, open complaints (if Guest Complaint doctype exists), and counts.

    Defensive guard: queries Guest Complaint only if the DocType exists in the DB.
    """
    _require_permission("Guest Request", "read")
    filters = _as_dict(filters) if filters else {}

    status_filter = filters.get("status", _OPEN_STATUSES)

    request_fields = [
        "name", "subject", "status", "priority", "department",
        "assigned_to", "room", "stay", "response_due_at", "resolution_due_at",
        "request_type", "source",
    ]
    requests = frappe.get_all(
        "Guest Request",
        filters={"resort_property": resort_property, "status": ["in", status_filter]},
        fields=request_fields,
        order_by="priority desc, creation asc",
        limit=200,
    )

    complaints = []
    if frappe.db.exists("DocType", "Guest Complaint"):
        complaint_open_statuses = [
            "Open", "Acknowledged", "Investigating",
            "Waiting for Guest", "Waiting for Department",
            "Recovery Proposed", "Recovery Approved", "Reopened", "Escalated",
        ]
        complaints = frappe.get_all(
            "Guest Complaint",
            filters={"resort_property": resort_property, "status": ["in", complaint_open_statuses]},
            fields=[
                "name", "complaint_summary", "status", "severity",
                "department", "owner_user", "room", "stay", "response_due_at",
            ],
            order_by="severity desc, creation asc",
            limit=200,
        )

    now = now_datetime()
    sla_exceptions = [
        r for r in requests
        if r.get("resolution_due_at") and r["resolution_due_at"] < now
    ]

    counts = {
        "open_requests": len(requests),
        "open_complaints": len(complaints),
        "sla_exceptions": len(sla_exceptions),
        "by_status": {},
        "by_priority": {},
    }
    for r in requests:
        counts["by_status"][r["status"]] = counts["by_status"].get(r["status"], 0) + 1
        counts["by_priority"][r["priority"]] = counts["by_priority"].get(r["priority"], 0) + 1

    return _envelope(
        {
            "requests": requests,
            "complaints": complaints,
            "sla_exceptions": sla_exceptions,
            "counts": counts,
            "vip_preparation": [],  # deferred per scope
        }
    )
