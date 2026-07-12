"""
CRM Feedback module — submit_feedback, list_feedback, get_feedback.

Callable via the_reezort.crm.feedback.* (also re-exported from crm.api).
"""

import frappe
from frappe import _
from frappe.utils import now_datetime

from the_reezort.utils import envelope as _envelope, require_permission as _require_permission

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DEFAULT_FOLLOW_UP_SCORE = 6  # used when CRM Settings is unavailable


def _as_dict(payload):
    """Accept both str-encoded JSON and plain dict."""
    if isinstance(payload, str):
        import json
        return json.loads(payload)
    return payload or {}


def _get_follow_up_threshold():
    """Return the configured NPS follow-up threshold or the hardcoded default."""
    try:
        if frappe.db.exists("DocType", "CRM Settings") and frappe.db.exists(
            "CRM Settings", "CRM Settings"
        ):
            threshold = frappe.db.get_value(
                "CRM Settings", "CRM Settings", "default_feedback_follow_up_score"
            )
            if threshold is not None:
                return int(threshold)
    except Exception:
        pass
    return _DEFAULT_FOLLOW_UP_SCORE


def _derive_sentiment(nps_score):
    """Derive sentiment string from NPS score."""
    score = int(nps_score)
    if score >= 9:
        return "Positive"
    elif score >= 7:
        return "Neutral"
    else:
        return "Negative"


def _try_create_complaint(feedback_doc, p):
    """
    Attempt to create a linked Guest Complaint when follow-up is required.
    Guards against Guest Complaint doctype not existing and against missing
    required fields (resort_property, category).
    """
    if not frappe.db.exists("DocType", "Guest Complaint"):
        return None

    resort_property = p.get("resort_property") or frappe.db.get_single_value(
        "Property Settings", "resort_property"
    ) if frappe.db.exists("DocType", "Property Settings") else None

    if not resort_property:
        return None  # cannot create without required field

    try:
        from the_reezort.guest_services.recovery import create_complaint

        complaint_payload = {
            "property": resort_property,
            "category": "Guest Feedback",
            "severity": "Medium",
            "summary": "Low NPS / negative feedback — follow-up required",
            "details": feedback_doc.comments or "Feedback score triggered follow-up.",
            "guest_profile": feedback_doc.guest_profile,
            "stay": feedback_doc.stay,
            "reservation": feedback_doc.reservation,
            "source_request": feedback_doc.guest_request,
        }
        result = create_complaint(complaint_payload)
        complaint_name = (
            result.get("data", {}).get("guest_complaint")
            if isinstance(result, dict)
            else None
        )
        return complaint_name
    except Exception as exc:
        frappe.log_error(
            f"Auto-complaint creation failed for feedback {feedback_doc.name}: {exc}",
            "CRM Feedback",
        )
        return None


# ---------------------------------------------------------------------------
# Whitelisted endpoints
# ---------------------------------------------------------------------------


@frappe.whitelist()
def submit_feedback(payload=None, **kwargs):
    """
    Create a Guest Feedback record.

    Required (at least one of): nps_score, rating, comments.
    Optional: stay, reservation, guest_profile, context, sentiment,
              guest_request, event_booking, resort_property (for auto-complaint).

    Auto-derives sentiment from nps_score when not supplied.
    Flags status "Follow Up Required" when nps_score <= threshold OR
    sentiment is Negative, and attempts to create a linked Guest Complaint.
    """
    _require_permission("Guest Feedback", "create")

    p = _as_dict(payload) if payload else kwargs

    nps_score = p.get("nps_score")
    rating = p.get("rating")
    comments = p.get("comments")

    if nps_score is None and rating is None and not comments:
        frappe.throw(
            _("At least one of nps_score, rating, or comments is required."),
            frappe.MandatoryError,
        )

    if nps_score is not None:
        nps_score = int(nps_score)
        if not (0 <= nps_score <= 10):
            frappe.throw(_("nps_score must be between 0 and 10."), frappe.ValidationError)

    # Resolve sentiment
    sentiment = p.get("sentiment")
    if not sentiment and nps_score is not None:
        sentiment = _derive_sentiment(nps_score)

    # Determine status
    threshold = _get_follow_up_threshold()
    follow_up_required = (nps_score is not None and nps_score <= threshold) or (
        sentiment == "Negative"
    )
    status = "Follow Up Required" if follow_up_required else "New"

    doc = frappe.get_doc(
        {
            "doctype": "Guest Feedback",
            "guest_profile": p.get("guest_profile"),
            "reservation": p.get("reservation"),
            "stay": p.get("stay"),
            "event_booking": p.get("event_booking"),
            "guest_request": p.get("guest_request"),
            "context": p.get("context") or "General",
            "nps_score": nps_score,
            "rating": rating,
            "sentiment": sentiment,
            "comments": comments,
            "status": status,
            "submitted_at": p.get("submitted_at") or now_datetime(),
            "follow_up_owner": p.get("follow_up_owner"),
        }
    )
    doc.insert(ignore_permissions=False)

    complaint_name = None
    if follow_up_required:
        complaint_name = _try_create_complaint(doc, p)
        if complaint_name:
            frappe.db.set_value(
                "Guest Feedback", doc.name, "guest_complaint", complaint_name
            )
            frappe.db.set_value(
                "Guest Feedback", doc.name, "status", "Linked to Complaint"
            )
            status = "Linked to Complaint"

    return _envelope(
        data={
            "guest_feedback": doc.name,
            "status": status,
            "follow_up_required": follow_up_required,
            "guest_complaint": complaint_name,
        }
    )


@frappe.whitelist()
def list_feedback(filters=None, limit_page_length=20, limit_start=0):
    """Return a list of Guest Feedback records matching filters."""
    _require_permission("Guest Feedback", "read")

    f = _as_dict(filters) if filters else {}

    rows = frappe.get_list(
        "Guest Feedback",
        filters=f,
        fields=[
            "name",
            "guest_profile",
            "stay",
            "context",
            "status",
            "nps_score",
            "rating",
            "sentiment",
            "submitted_at",
            "follow_up_owner",
            "guest_complaint",
        ],
        order_by="submitted_at desc",
        limit_page_length=int(limit_page_length),
        limit_start=int(limit_start),
    )

    return _envelope(data={"feedback": rows, "count": len(rows)})


@frappe.whitelist()
def get_feedback(name):
    """Return a single Guest Feedback record."""
    _require_permission("Guest Feedback", "read")

    if not frappe.db.exists("Guest Feedback", name):
        frappe.throw(_("Guest Feedback {0} not found.").format(name), frappe.DoesNotExistError)

    doc = frappe.get_doc("Guest Feedback", name)
    return _envelope(data=doc.as_dict())
