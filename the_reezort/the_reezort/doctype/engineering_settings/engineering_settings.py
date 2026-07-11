"""Engineering Settings — per-property singleton configuration for module 009.

Named by resort_property (autoname: field:resort_property) so
frappe.get_doc("Engineering Settings", "PROP-CODE") resolves directly.

Provides get_engineering_settings(property) / update_engineering_settings(property, settings)
as whitelisted API functions.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document

from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission

DEFAULTS: dict = {
    "default_sla_low_minutes": 480,
    "default_sla_normal_minutes": 240,
    "default_sla_high_minutes": 60,
    "default_sla_urgent_minutes": 30,
    "require_supervisor_for_ooo": 1,
    "require_supervisor_for_release": 1,
    "require_housekeeping_after_repair": 1,
    "spare_posting_policy": "Request Approval",
    "preventive_generation_days_ahead": 7,
    "repeat_defect_window_days": 30,
}

_UPDATABLE_FIELDS = frozenset(DEFAULTS.keys())


class EngineeringSettings(Document):
    def validate(self):
        self._validate_one_per_property()

    def _validate_one_per_property(self):
        existing = frappe.db.get_value(
            "Engineering Settings",
            {"resort_property": self.resort_property},
            "name",
        )
        if existing and existing != self.name:
            frappe.throw(
                _("Engineering Settings for {0} already exists ({1}).").format(
                    frappe.bold(self.resort_property), existing
                ),
                title=_("Duplicate Settings"),
            )


# ---------- internal helper ----------


def _get_or_create(resort_property: str) -> "EngineeringSettings":
    existing = frappe.db.get_value(
        "Engineering Settings", {"resort_property": resort_property}, "name"
    )
    if existing:
        return frappe.get_doc("Engineering Settings", existing)

    doc = frappe.get_doc(
        {"doctype": "Engineering Settings", "resort_property": resort_property, **DEFAULTS}
    )
    doc.insert(ignore_permissions=True)
    return doc


def _settings_payload(doc) -> dict:
    return {
        "name": doc.name,
        "resort_property": doc.resort_property,
        **{field: doc.get(field) for field in _UPDATABLE_FIELDS},
    }


# ---------- whitelisted API ----------


@frappe.whitelist()
def get_engineering_settings(property: str) -> dict:
    _require_permission("Engineering Settings", "read")
    if not frappe.db.exists("Resort Property", property):
        frappe.throw(_("Resort Property {0} does not exist.").format(property))
    doc = _get_or_create(property)
    return _envelope(_settings_payload(doc))


@frappe.whitelist()
def update_engineering_settings(property: str, settings) -> dict:
    _require_permission("Engineering Settings", "write")
    settings = _as_dict(settings)
    if not frappe.db.exists("Resort Property", property):
        frappe.throw(_("Resort Property {0} does not exist.").format(property))
    doc = _get_or_create(property)
    for field, value in settings.items():
        if field in _UPDATABLE_FIELDS:
            doc.set(field, value)
    doc.save(ignore_permissions=True)
    return _envelope(_settings_payload(doc))
