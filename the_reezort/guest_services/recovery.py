"""Guest Services — Complaint, Recovery, and Handoff endpoints.

Callable paths (note: this file is recovery.py, NOT api.py):
  the_reezort.guest_services.recovery.create_complaint
  the_reezort.guest_services.recovery.propose_service_recovery
  the_reezort.guest_services.recovery.create_service_handoff
  the_reezort.guest_services.recovery.list_complaints
  the_reezort.guest_services.recovery.list_service_recoveries

The spec's api.md lists paths under the_reezort.guest_services.api.* — those
are owned by the sibling agent.  The actual callable paths above are what the
frontend should call for this module.  See .audit-handoff/010-recovery.md.
"""

import json

import frappe
from frappe import _
from frappe.utils import now_datetime

from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_VALID_COMPLAINT_STATUSES = {
    "Open",
    "Acknowledged",
    "Investigating",
    "Waiting for Guest",
    "Waiting for Department",
    "Recovery Proposed",
    "Recovery Approved",
    "Resolved",
    "Reopened",
    "Escalated",
    "Closed",
}

_VALID_SEVERITIES = {"Low", "Medium", "High", "Critical"}

_VALID_CATEGORIES = {
    "Room",
    "Housekeeping",
    "Maintenance",
    "F&B",
    "Billing",
    "Staff",
    "Noise",
    "Safety",
    "Delay",
    "Event",
    "Other",
}

_VALID_RECOVERY_TYPES = {
    "Apology",
    "Amenity",
    "Room Move",
    "Complimentary Item",
    "Discount",
    "Refund Request",
    "Loyalty Credit",
    "Manager Call",
    "Other",
}

_FINANCIAL_RECOVERY_TYPES = {"Discount", "Refund Request", "Loyalty Credit", "Complimentary Item"}

_VALID_TARGET_MODULES = {
    "Housekeeping",
    "Maintenance",
    "F&B",
    "Billing",
    "Events",
    "Integrations",
    "Security",
    "Spa Parked",
}


def _as_dict(value):
    if isinstance(value, str):
        return json.loads(value) if value else {}
    return value or {}


# ---------------------------------------------------------------------------
# create_complaint
# ---------------------------------------------------------------------------


@frappe.whitelist()
def create_complaint(payload):
    """Create a Guest Complaint record.

    Payload keys:
      property (str, required)
      category (str, required)
      severity (str, default Medium)
      summary  (str, required)
      details  (str, required)
      stay, reservation, room, guest_profile, source_request (optional Links)
      desired_resolution (str, optional)
      department (str, optional — defaults Front Desk)
      legal_or_safety_risk (bool, optional)
    """
    _require_permission("Guest Complaint", "create")
    p = _as_dict(payload)

    resort_property = p.get("property") or p.get("resort_property")
    if not resort_property:
        frappe.throw(_("property is required."), frappe.MandatoryError)

    category = p.get("category") or p.get("complaint_category")
    if not category:
        frappe.throw(_("category is required."), frappe.MandatoryError)
    if category not in _VALID_CATEGORIES:
        frappe.throw(_("Invalid complaint category: {0}").format(category), frappe.ValidationError)

    severity = p.get("severity", "Medium")
    if severity not in _VALID_SEVERITIES:
        frappe.throw(_("Invalid severity: {0}").format(severity), frappe.ValidationError)

    summary = p.get("summary") or p.get("complaint_summary")
    if not summary:
        frappe.throw(_("summary is required."), frappe.MandatoryError)

    details = p.get("details") or p.get("complaint_details")
    if not details:
        frappe.throw(_("details is required."), frappe.MandatoryError)

    doc = frappe.get_doc(
        {
            "doctype": "Guest Complaint",
            "resort_property": resort_property,
            "complaint_category": category,
            "severity": severity,
            "complaint_summary": summary,
            "complaint_details": details,
            "status": "Open",
            "department": p.get("department", "Front Desk"),
            "owner_user": frappe.session.user,
            "stay": p.get("stay"),
            "reservation": p.get("reservation"),
            "room": p.get("room"),
            "guest_profile": p.get("guest_profile"),
            "source_request": p.get("source_request"),
            "desired_resolution": p.get("desired_resolution"),
            "legal_or_safety_risk": 1 if p.get("legal_or_safety_risk") else 0,
        }
    )
    doc.insert(ignore_permissions=False)

    escalated = doc.status == "Escalated"
    return _envelope(
        {
            "guest_complaint": doc.name,
            "status": doc.status,
            "escalated": escalated,
        }
    )


# ---------------------------------------------------------------------------
# propose_service_recovery
# ---------------------------------------------------------------------------


@frappe.whitelist()
def propose_service_recovery(payload):
    """Propose a Service Recovery Action linked to a complaint or request.

    Payload keys:
      guest_complaint (str, optional)
      guest_request   (str, optional)  — at least one required
      recovery_type   (str, required)
      estimated_value (float, optional)
      reason          (str, required)
      requires_billing_handoff (bool, optional)
      guest_folio     (str, optional)
      cost_center     (str, optional)
    """
    _require_permission("Service Recovery Action", "create")
    p = _as_dict(payload)

    guest_complaint = p.get("guest_complaint")
    guest_request = p.get("guest_request")
    if not guest_complaint and not guest_request:
        frappe.throw(
            _("Either guest_complaint or guest_request is required."), frappe.MandatoryError
        )

    recovery_type = p.get("recovery_type")
    if not recovery_type:
        frappe.throw(_("recovery_type is required."), frappe.MandatoryError)
    if recovery_type not in _VALID_RECOVERY_TYPES:
        frappe.throw(_("Invalid recovery_type: {0}").format(recovery_type), frappe.ValidationError)

    reason = p.get("reason")
    if not reason:
        frappe.throw(_("reason is required."), frappe.MandatoryError)

    estimated_value = p.get("estimated_value") or 0
    try:
        estimated_value = float(estimated_value)
    except (TypeError, ValueError):
        frappe.throw(_("estimated_value must be numeric."), frappe.ValidationError)

    # Approval gate: financial types always need approval; also if estimated_value > 0
    is_financial = recovery_type in _FINANCIAL_RECOVERY_TYPES
    approval_required = 1 if (is_financial or estimated_value > 0) else 0

    # Status: if approval needed -> Pending Approval; otherwise Draft
    status = "Pending Approval" if approval_required else "Draft"

    doc = frappe.get_doc(
        {
            "doctype": "Service Recovery Action",
            "guest_complaint": guest_complaint,
            "guest_request": guest_request,
            "recovery_type": recovery_type,
            "status": status,
            "estimated_value": estimated_value,
            "reason": reason,
            "approval_required": approval_required,
            "cost_center": p.get("cost_center"),
            "guest_folio": p.get("guest_folio"),
        }
    )
    doc.insert(ignore_permissions=False)

    # Advance complaint status to Recovery Proposed if linked
    if guest_complaint:
        complaint = frappe.get_doc("Guest Complaint", guest_complaint)
        if complaint.status not in ("Resolved", "Closed", "Escalated"):
            complaint.status = "Recovery Proposed"
            complaint.save(ignore_permissions=False)

    return _envelope(
        {
            "service_recovery_action": doc.name,
            "status": doc.status,
            "approval_required": bool(approval_required),
        }
    )


# ---------------------------------------------------------------------------
# create_service_handoff
# ---------------------------------------------------------------------------


@frappe.whitelist()
def create_service_handoff(payload):
    """Create a Service Handoff linking a source record to a target module.

    Payload keys:
      source_doctype  (str, required)
      source_name     (str, required)
      target_module   (str, required)
      handoff_payload (dict, optional — ignored, stored conceptually)
    """
    _require_permission("Service Handoff", "create")
    p = _as_dict(payload)

    source_doctype = p.get("source_doctype")
    if not source_doctype:
        frappe.throw(_("source_doctype is required."), frappe.MandatoryError)

    source_name = p.get("source_name")
    if not source_name:
        frappe.throw(_("source_name is required."), frappe.MandatoryError)

    target_module = p.get("target_module")
    if not target_module:
        frappe.throw(_("target_module is required."), frappe.MandatoryError)
    if target_module not in _VALID_TARGET_MODULES:
        frappe.throw(_("Invalid target_module: {0}").format(target_module), frappe.ValidationError)

    # Verify source record exists
    if not frappe.db.exists(source_doctype, source_name):
        frappe.throw(
            _("{0} {1} does not exist.").format(source_doctype, source_name),
            frappe.DoesNotExistError,
        )

    # Derive target_doctype heuristic mapping (best-effort; target agent updates target_name)
    _MODULE_TARGET_MAP = {
        "Maintenance": "Maintenance Ticket",
        "Housekeeping": "Room Condition Capture",
        "F&B": "FnB Order",
        "Billing": "Guest Folio",
        "Events": "Event Space",
        "Integrations": None,
        "Security": None,
        "Spa Parked": None,
    }
    target_doctype = _MODULE_TARGET_MAP.get(target_module)

    doc = frappe.get_doc(
        {
            "doctype": "Service Handoff",
            "source_doctype": source_doctype,
            "source_name": source_name,
            "target_module": target_module,
            "target_doctype": target_doctype or "",
            "status": "Created",
            "retry_count": 0,
            "owner_user": frappe.session.user,
        }
    )
    doc.insert(ignore_permissions=False)

    return _envelope(
        {
            "service_handoff": doc.name,
            "status": doc.status,
            "target_doctype": doc.target_doctype or None,
            "target_name": doc.target_name or None,
        }
    )


# ---------------------------------------------------------------------------
# list_complaints  (read endpoint)
# ---------------------------------------------------------------------------


@frappe.whitelist()
def list_complaints(resort_property=None, filters=None):
    """Return complaints for the console view.

    Args:
      resort_property: str — optional property filter
      filters: dict/JSON — additional frappe filters
    """
    _require_permission("Guest Complaint", "read")
    extra = _as_dict(filters)

    conditions = {}
    if resort_property:
        conditions["resort_property"] = resort_property
    conditions.update(extra)

    rows = frappe.get_all(
        "Guest Complaint",
        filters=conditions,
        fields=[
            "name",
            "resort_property",
            "complaint_category",
            "status",
            "severity",
            "complaint_summary",
            "department",
            "owner_user",
            "guest_profile",
            "stay",
            "room",
            "legal_or_safety_risk",
            "creation",
            "modified",
        ],
        order_by="creation desc",
        limit=200,
    )
    return _envelope({"complaints": rows, "total": len(rows)})


# ---------------------------------------------------------------------------
# list_service_recoveries  (read endpoint)
# ---------------------------------------------------------------------------


@frappe.whitelist()
def list_service_recoveries(filters=None):
    """Return service recovery actions for the console.

    Args:
      filters: dict/JSON — frappe filter dict
    """
    _require_permission("Service Recovery Action", "read")
    conditions = _as_dict(filters)

    rows = frappe.get_all(
        "Service Recovery Action",
        filters=conditions,
        fields=[
            "name",
            "guest_complaint",
            "guest_request",
            "recovery_type",
            "status",
            "estimated_value",
            "approval_required",
            "approval_request",
            "guest_folio",
            "reason",
            "creation",
            "modified",
        ],
        order_by="creation desc",
        limit=200,
    )
    return _envelope({"service_recoveries": rows, "total": len(rows)})


@frappe.whitelist()
def update_complaint_status(guest_complaint, status, note=None):
    """Advance a Guest Complaint's status. The controller enforces the
    business rules (resolution_summary required before Closed, legal/safety
    auto-escalation)."""
    _require_permission("Guest Complaint", "write")
    if status not in _VALID_COMPLAINT_STATUSES:
        frappe.throw(_("Invalid complaint status: {0}").format(status), frappe.ValidationError)

    doc = frappe.get_doc("Guest Complaint", guest_complaint)
    doc.status = status
    if note:
        appended = "\n\n[{0}] {1}".format(now_datetime(), note)
        doc.complaint_details = (doc.complaint_details or "") + appended
    doc.save(ignore_permissions=True)
    return _envelope({"guest_complaint": doc.name, "status": doc.status})
