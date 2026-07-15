"""CRM module API — Guest 360, profile upsert, consent, preference.

Module path: the_reezort.crm.api
All endpoints: @frappe.whitelist(), _require_permission first, return _envelope().
"""

import frappe
from frappe import _
from frappe.utils import now_datetime

from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission

# ---------------------------------------------------------------------------
# CRM Settings helpers
# ---------------------------------------------------------------------------

_CRM_SETTINGS_NAME = "CRM Settings"


def _get_or_create_crm_settings():
    """Return the single CRM Settings record, creating it with defaults on first access."""
    if frappe.db.exists("CRM Settings", _CRM_SETTINGS_NAME):
        return frappe.get_doc("CRM Settings", _CRM_SETTINGS_NAME)
    doc = frappe.get_doc(
        {
            "doctype": "CRM Settings",
            "name": _CRM_SETTINGS_NAME,
            "auto_create_guest_profile_from_reservation": 1,
            "require_approval_for_profile_merge": 1,
            "require_consent_for_marketing": 1,
            "loyalty_enabled": 0,
            "default_feedback_follow_up_score": 7,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc


@frappe.whitelist()
def get_crm_settings():
    """Return (and auto-create) the global CRM Settings record."""
    _require_permission("CRM Settings", "read")
    doc = _get_or_create_crm_settings()
    return _envelope(
        {
            "auto_create_guest_profile_from_reservation": doc.auto_create_guest_profile_from_reservation,
            "require_approval_for_profile_merge": doc.require_approval_for_profile_merge,
            "require_consent_for_marketing": doc.require_consent_for_marketing,
            "loyalty_enabled": doc.loyalty_enabled,
            "default_loyalty_program": doc.default_loyalty_program,
            "default_feedback_follow_up_score": doc.default_feedback_follow_up_score,
        }
    )


@frappe.whitelist()
def update_crm_settings(settings):
    """Update writable fields on the global CRM Settings record."""
    _require_permission("CRM Settings", "write")
    if isinstance(settings, str):
        import json

        settings = json.loads(settings)
    doc = _get_or_create_crm_settings()
    _updatable = frozenset(
        [
            "auto_create_guest_profile_from_reservation",
            "require_approval_for_profile_merge",
            "require_consent_for_marketing",
            "loyalty_enabled",
            "default_loyalty_program",
            "default_feedback_follow_up_score",
        ]
    )
    for field, value in settings.items():
        if field in _updatable:
            doc.set(field, value)
    doc.save(ignore_permissions=True)
    return _envelope({"status": "updated"})


# ---------------------------------------------------------------------------
# Guest 360
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_guest_360(guest_profile, include_sensitive=False):
    """Aggregate the full 360-degree view for a guest.

    Defensive doctype-exists guards for sibling modules (loyalty, feedback)
    that may not be installed yet.
    """
    _require_permission("Guest Profile", "read")

    if not frappe.db.exists("Guest Profile", guest_profile):
        frappe.throw(_("Guest Profile {0} not found.").format(guest_profile), frappe.DoesNotExistError)

    gp = frappe.get_doc("Guest Profile", guest_profile)

    # -- Reservations (guest links via staying_guest_profile / booker_guest_profile) --
    reservations = []
    reservation_names = []
    if frappe.db.exists("DocType", "Reservation"):
        raw_res = frappe.get_all(
            "Reservation",
            or_filters={"staying_guest_profile": guest_profile, "booker_guest_profile": guest_profile},
            fields=["name", "resort_property", "status", "arrival_date", "departure_date"],
            limit=50,
        )
        reservations = [dict(r) for r in raw_res]
        reservation_names = [r["name"] for r in raw_res]

    # -- Stays (no guest_profile link — reached via the guest's reservations) --
    stays = []
    stay_names = []
    if frappe.db.exists("DocType", "Stay") and reservation_names:
        raw_stays = frappe.get_all(
            "Stay",
            filters={"reservation": ["in", reservation_names]},
            fields=["name", "resort_property", "current_room", "arrival_date", "departure_date", "stay_status", "reservation"],
            limit=50,
        )
        stays = [dict(s) for s in raw_stays]
        stay_names = [s["name"] for s in raw_stays]

    # -- Guest Folios (link via stay / reservation) --
    folios = []
    if frappe.db.exists("DocType", "Guest Folio") and (stay_names or reservation_names):
        folio_or = {}
        if stay_names:
            folio_or["stay"] = ["in", stay_names]
        if reservation_names:
            folio_or["reservation"] = ["in", reservation_names]
        raw_folios = frappe.get_all(
            "Guest Folio",
            or_filters=folio_or,
            fields=["name", "folio_status", "balance_status", "total_charges", "outstanding_amount"],
            limit=50,
        )
        folios = [dict(f) for f in raw_folios]

    # -- Guest Requests --
    requests = []
    if frappe.db.exists("DocType", "Guest Request"):
        raw_reqs = frappe.get_all(
            "Guest Request",
            filters={"guest_profile": guest_profile},
            fields=["name", "request_type", "status", "subject", "creation"],
            limit=50,
        )
        requests = [dict(r) for r in raw_reqs]

    # -- Guest Complaints (summary field is complaint_summary, not subject) --
    complaints = []
    if frappe.db.exists("DocType", "Guest Complaint"):
        raw_cmps = frappe.get_all(
            "Guest Complaint",
            filters={"guest_profile": guest_profile},
            fields=["name", "status", "complaint_summary", "severity", "creation"],
            limit=50,
        )
        complaints = [dict(c) for c in raw_cmps]

    # -- Feedback --
    feedback = []
    if frappe.db.exists("DocType", "Guest Feedback"):
        fb_fields = ["name", "context", "status", "nps_score", "rating", "sentiment", "submitted_at"]
        raw_fb = frappe.get_all(
            "Guest Feedback", filters={"guest_profile": guest_profile}, fields=fb_fields, limit=50
        )
        feedback = [dict(f) for f in raw_fb]

    # -- Loyalty --
    loyalty = None
    loyalty_transactions = []
    if frappe.db.exists("DocType", "Loyalty Membership"):
        mem = frappe.db.get_value(
            "Loyalty Membership",
            {"guest_profile": guest_profile, "status": "Active"},
            ["name", "loyalty_program", "membership_number", "tier", "points_balance", "value_balance", "status"],
            as_dict=True,
        )
        if mem:
            loyalty = dict(mem)
            if frappe.db.exists("DocType", "Loyalty Transaction"):
                txn_fields = ["name", "transaction_type", "status", "points", "value_amount", "creation"]
                raw_txns = frappe.get_all(
                    "Loyalty Transaction",
                    filters={"loyalty_membership": mem["name"]},
                    fields=txn_fields,
                    order_by="creation desc",
                    limit=20,
                )
                loyalty_transactions = [dict(t) for t in raw_txns]

    # -- Preferences --
    preferences = frappe.get_all(
        "Guest Preference",
        filters={"guest_profile": guest_profile, "is_active": 1},
        fields=["name", "preference_type", "preference_value", "sensitivity", "source", "verified"],
    )
    preferences = [dict(p) for p in preferences]

    # -- Consents --
    consents = frappe.get_all(
        "Guest Consent",
        filters={"guest_profile": guest_profile},
        fields=["name", "purpose", "channel", "status", "source", "captured_at", "expires_at"],
        order_by="captured_at desc",
    )
    consents = [dict(c) for c in consents]

    # -- Derived stats (may differ from stored values if not yet refreshed) --
    derived_lifetime_stays = len(stays)
    derived_last_stay_date = None
    if stays:
        dates = [s.get("departure_date") or s.get("arrival_date") for s in stays if s.get("departure_date") or s.get("arrival_date")]
        if dates:
            derived_last_stay_date = str(max(dates))

    payload = {
        "guest_profile": gp.name,
        "full_name": gp.full_name or gp.guest_full_name,
        "status": gp.status,
        "vip_level": gp.vip_level,
        "privacy_level": gp.privacy_level,
        "guest_type": gp.guest_type,
        "do_not_contact": bool(gp.do_not_contact),
        "primary_email": gp.primary_email or gp.email,
        "primary_phone": gp.primary_phone or gp.phone,
        "preferred_language": gp.preferred_language,
        "nationality": gp.nationality,
        "last_stay_date": str(gp.last_stay_date) if gp.last_stay_date else derived_last_stay_date,
        "lifetime_stays": gp.lifetime_stays or derived_lifetime_stays,
        "lifetime_revenue": gp.lifetime_revenue,
        "erpnext_customer": gp.erpnext_customer,
        "stays": stays,
        "reservations": reservations,
        "folios": folios,
        "requests": requests,
        "complaints": complaints,
        "feedback": feedback,
        "loyalty": loyalty,
        "loyalty_transactions": loyalty_transactions,
        "preferences": preferences,
        "consents": consents,
    }

    # Mask sensitive fields if include_sensitive is falsy
    if not include_sensitive:
        payload.pop("private_notes", None)

    return _envelope(payload)


# ---------------------------------------------------------------------------
# Profile upsert
# ---------------------------------------------------------------------------


@frappe.whitelist()
def create_or_update_guest_profile(full_name=None, email=None, phone=None, source=None, **kwargs):
    """Upsert a guest profile by email or phone.

    Matches on primary_email/email first, then primary_phone/phone.
    Sets status to Active.
    """
    _require_permission("Guest Profile", "create")

    if isinstance(full_name, str) and not full_name:
        full_name = None

    # Try to find existing by email
    existing_name = None
    if email:
        existing_name = frappe.db.get_value(
            "Guest Profile",
            [["primary_email", "=", email], ["status", "!=", "Merged"]],
            "name",
        )
        if not existing_name:
            existing_name = frappe.db.get_value(
                "Guest Profile",
                [["email", "=", email], ["status", "!=", "Merged"]],
                "name",
            )

    # Fallback to phone
    if not existing_name and phone:
        existing_name = frappe.db.get_value(
            "Guest Profile",
            [["primary_phone", "=", phone], ["status", "!=", "Merged"]],
            "name",
        )
        if not existing_name:
            existing_name = frappe.db.get_value(
                "Guest Profile",
                [["phone", "=", phone], ["status", "!=", "Merged"]],
                "name",
            )

    if existing_name:
        doc = frappe.get_doc("Guest Profile", existing_name)
        if full_name:
            doc.guest_full_name = full_name
            doc.full_name = full_name
        if email:
            doc.primary_email = email
            if not doc.email:
                doc.email = email
        if phone:
            doc.primary_phone = phone
            if not doc.phone:
                doc.phone = phone
        doc.status = "Active"
        doc.save(ignore_permissions=True)
    else:
        if not full_name:
            frappe.throw(_("full_name is required to create a new Guest Profile."))
        doc = frappe.get_doc(
            {
                "doctype": "Guest Profile",
                "guest_full_name": full_name,
                "full_name": full_name,
                "primary_email": email or "",
                "email": email or "",
                "primary_phone": phone or "",
                "phone": phone or "",
                "status": "Active",
            }
        )
        doc.insert(ignore_permissions=True)

    return _envelope(
        {
            "guest_profile": doc.name,
            "status": doc.status,
            "duplicate_candidates": [],
        }
    )


# ---------------------------------------------------------------------------
# Consent recording
# ---------------------------------------------------------------------------


def _recompute_do_not_contact(guest_profile_name):
    """Recompute do_not_contact on the Guest Profile from its consent records.

    Rule: do_not_contact = True when:
    - any Marketing/Any-channel consent is Withdrawn, OR
    - there is no Granted marketing consent at all (i.e., marketing not opted in)
    """
    marketing_consents = frappe.get_all(
        "Guest Consent",
        filters={"guest_profile": guest_profile_name, "purpose": "Marketing"},
        fields=["status"],
    )

    if not marketing_consents:
        # No marketing consent on record — treat as do_not_contact
        do_not_contact = 1
    else:
        has_granted = any(c["status"] == "Granted" for c in marketing_consents)
        has_withdrawn = any(c["status"] == "Withdrawn" for c in marketing_consents)
        # If any withdrawn and none granted → do not contact
        do_not_contact = 1 if (has_withdrawn or not has_granted) else 0

    frappe.db.set_value("Guest Profile", guest_profile_name, "do_not_contact", do_not_contact, update_modified=False)


@frappe.whitelist()
def record_guest_consent(guest_profile, purpose, channel, status, source=None, evidence_reference=None, expires_at=None):
    """Create a Guest Consent record and recompute Guest Profile.do_not_contact."""
    _require_permission("Guest Consent", "create")

    if not frappe.db.exists("Guest Profile", guest_profile):
        frappe.throw(_("Guest Profile {0} not found.").format(guest_profile), frappe.DoesNotExistError)

    now = now_datetime()
    doc = frappe.get_doc(
        {
            "doctype": "Guest Consent",
            "guest_profile": guest_profile,
            "purpose": purpose,
            "channel": channel,
            "status": status,
            "source": source or "",
            "captured_at": now,
            "expires_at": expires_at or None,
            "withdrawn_at": now if status == "Withdrawn" else None,
            "evidence_reference": evidence_reference or "",
        }
    )
    doc.insert(ignore_permissions=True)

    # Recompute do_not_contact on the profile
    _recompute_do_not_contact(guest_profile)

    return _envelope({"guest_consent": doc.name, "status": doc.status})


# ---------------------------------------------------------------------------
# Preference upsert
# ---------------------------------------------------------------------------


@frappe.whitelist()
def update_guest_preference(guest_profile, preference_type, preference_value, sensitivity=None, source=None, notes=None):
    """Upsert a Guest Preference for (guest_profile, preference_type, preference_value).

    If an active preference of the same type and value already exists, it is
    returned unchanged. Otherwise a new record is created.
    """
    _require_permission("Guest Preference", "create")

    if not frappe.db.exists("Guest Profile", guest_profile):
        frappe.throw(_("Guest Profile {0} not found.").format(guest_profile), frappe.DoesNotExistError)

    existing_name = frappe.db.get_value(
        "Guest Preference",
        {
            "guest_profile": guest_profile,
            "preference_type": preference_type,
            "preference_value": preference_value,
            "is_active": 1,
        },
        "name",
    )

    if existing_name:
        doc = frappe.get_doc("Guest Preference", existing_name)
        if sensitivity:
            doc.sensitivity = sensitivity
        if source:
            doc.source = source
        if notes is not None:
            doc.notes = notes
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc(
            {
                "doctype": "Guest Preference",
                "guest_profile": guest_profile,
                "preference_type": preference_type,
                "preference_value": preference_value,
                "sensitivity": sensitivity or "Normal",
                "source": source or "",
                "notes": notes or "",
                "verified": 0,
                "is_active": 1,
            }
        )
        doc.insert(ignore_permissions=True)

    return _envelope({"guest_preference": doc.name, "is_active": bool(doc.is_active)})


@frappe.whitelist()
def list_guest_profiles(search=None, limit=50):
	"""Searchable guest directory for the CRM console. Matches name / email /
	phone. Returns the fields the Guests list + Guest 360 deep-link need."""
	_require_permission("Guest Profile", "read")
	filters = {}
	or_filters = None
	if search:
		s = "%{0}%".format(search.strip())
		or_filters = {
			"full_name": ["like", s],
			"guest_full_name": ["like", s],
			"primary_email": ["like", s],
			"email": ["like", s],
			"primary_phone": ["like", s],
			"phone": ["like", s],
		}
	rows = frappe.get_all(
		"Guest Profile",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "full_name", "guest_full_name", "primary_email", "email",
		        "primary_phone", "phone", "vip_level", "status", "do_not_contact",
		        "lifetime_stays", "last_stay_date"],
		order_by="modified desc",
		limit=int(limit),
	)
	for r in rows:
		# Two parallel field pairs exist on Guest Profile (full_name/
		# guest_full_name, primary_email/email, primary_phone/phone) because
		# different creation paths populate different ones — always fall back
		# across both so the directory never shows a blank row for a real guest.
		r["display_name"] = r.get("full_name") or r.get("guest_full_name") or r["name"]
		r["display_contact"] = r.get("primary_email") or r.get("email") or r.get("primary_phone") or r.get("phone")
	return _envelope({"guests": rows, "total": len(rows)})
