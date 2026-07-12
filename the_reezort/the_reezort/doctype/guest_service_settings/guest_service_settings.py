"""Guest Service Settings — per-property singleton for guest service policy.

Named by resort_property (autoname: field:resort_property) so
frappe.get_doc("Guest Service Settings", "PROP-CODE") resolves directly.
"""

import frappe
from frappe import _
from frappe.model.document import Document

from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission

_DEFAULTS = {
    "default_request_sla_minutes": 60,
    "default_complaint_sla_minutes": 120,
    "require_guest_verification_for_close": 0,
    "allow_guest_portal_requests": 0,
    "auto_generate_vip_preparation": 0,
    "default_recovery_approval_role": None,
}

_UPDATABLE_FIELDS = frozenset(_DEFAULTS.keys())


def _get_or_create(resort_property):
    existing = frappe.db.get_value(
        "Guest Service Settings", {"resort_property": resort_property}, "name"
    )
    if existing:
        return frappe.get_doc("Guest Service Settings", existing)

    doc = frappe.get_doc(
        {
            "doctype": "Guest Service Settings",
            "resort_property": resort_property,
            **_DEFAULTS,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc


def _settings_payload(doc):
    return {
        "name": doc.name,
        "resort_property": doc.resort_property,
        "default_request_sla_minutes": doc.default_request_sla_minutes,
        "default_complaint_sla_minutes": doc.default_complaint_sla_minutes,
        "require_guest_verification_for_close": doc.require_guest_verification_for_close,
        "allow_guest_portal_requests": doc.allow_guest_portal_requests,
        "auto_generate_vip_preparation": doc.auto_generate_vip_preparation,
        "default_recovery_approval_role": doc.default_recovery_approval_role,
    }


class GuestServiceSettings(Document):
    def validate(self):
        if (self.default_request_sla_minutes or 0) <= 0:
            frappe.throw(_("Default Request SLA minutes must be greater than zero."))
        if (self.default_complaint_sla_minutes or 0) <= 0:
            frappe.throw(_("Default Complaint SLA minutes must be greater than zero."))


@frappe.whitelist()
def get_guest_service_settings(property):
    _require_permission("Guest Service Settings", "read")
    if not frappe.db.exists("Resort Property", property):
        frappe.throw(_("Resort Property {0} does not exist.").format(property))
    doc = _get_or_create(property)
    return _envelope(_settings_payload(doc))


@frappe.whitelist()
def update_guest_service_settings(property, settings):
    _require_permission("Guest Service Settings", "write")
    settings = _as_dict(settings)
    if not frappe.db.exists("Resort Property", property):
        frappe.throw(_("Resort Property {0} does not exist.").format(property))
    doc = _get_or_create(property)
    for field, value in settings.items():
        if field in _UPDATABLE_FIELDS:
            doc.set(field, value)
    doc.save(ignore_permissions=True)
    return _envelope(_settings_payload(doc))
