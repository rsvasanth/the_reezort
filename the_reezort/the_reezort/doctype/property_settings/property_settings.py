"""Property Settings — per-property policy configuration (one record per property).

Named by resort_property (autoname: field:resort_property), so
frappe.get_doc("Property Settings", "PROP-CODE") resolves directly.

Internal helpers (_get_setting_or_none, _room_uniqueness_filters) are imported
by setup/api.py, pms/api.py, and room/room.py; keep them fast (single db.get_value).
"""

import frappe
from frappe import _
from frappe.model.document import Document

from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission

DEFAULTS = {
    "allow_dirty_allocation_default": 0,
    "room_identifier_uniqueness": "Property",
    "hard_block_overlap_policy": "Strict",
    "default_room_naming_series": "",
}

_UPDATABLE_FIELDS = frozenset(DEFAULTS.keys())


# ---------- internal helpers (imported by sibling modules) ----------


def _get_setting_or_none(resort_property, field):
    """Return the setting value for this property, or None if no settings record exists.

    Callers use None to detect "no settings yet" and fall back to legacy behaviour.
    """
    if not resort_property:
        return None
    name = frappe.db.get_value("Property Settings", {"resort_property": resort_property}, "name")
    if not name:
        return None
    return frappe.db.get_value("Property Settings", name, field)


def _room_uniqueness_filters(resort_property, building):
    """Return the filter dict for room number uniqueness checks.

    Reads room_identifier_uniqueness from Property Settings; when no settings
    record exists yet the behaviour matches setup/api.py's historical default
    (property-scoped, i.e. uniqueness across the whole property).
    """
    scope = _get_setting_or_none(resort_property, "room_identifier_uniqueness") or "Property"
    if scope == "Building":
        return {"resort_property": resort_property, "building": building}
    return {"resort_property": resort_property}


# ---------- controller ----------


class PropertySettings(Document):
    def validate(self):
        self._validate_one_per_property()
        self._validate_select_values()

    def _validate_one_per_property(self):
        """Enforce one settings record per property at the controller level
        (the autoname already enforces DB uniqueness; this gives a clean error)."""
        existing = frappe.db.get_value(
            "Property Settings",
            {"resort_property": self.resort_property},
            "name",
        )
        if existing and existing != self.name:
            frappe.throw(
                _("Property Settings for {0} already exists ({1}).").format(
                    frappe.bold(self.resort_property), existing
                ),
                title=_("Duplicate Settings"),
            )

    def _validate_select_values(self):
        valid_scope = {"Property", "Building"}
        if self.room_identifier_uniqueness not in valid_scope:
            frappe.throw(
                _("Room Number Uniqueness Scope must be one of: {0}.").format(
                    ", ".join(sorted(valid_scope))
                )
            )
        valid_overlap = {"Strict", "Allow Same Source", "Manual Approval"}
        if self.hard_block_overlap_policy not in valid_overlap:
            frappe.throw(
                _("Hard Block Overlap Policy must be one of: {0}.").format(
                    ", ".join(sorted(valid_overlap))
                )
            )


# ---------- whitelisted API ----------


def _settings_payload(doc):
    return {
        "name": doc.name,
        "resort_property": doc.resort_property,
        "allow_dirty_allocation_default": doc.allow_dirty_allocation_default,
        "room_identifier_uniqueness": doc.room_identifier_uniqueness,
        "hard_block_overlap_policy": doc.hard_block_overlap_policy,
        "default_room_naming_series": doc.default_room_naming_series,
    }


def _get_or_create(resort_property):
    """Return the Property Settings doc for a property, creating it with sane
    defaults if it does not exist yet (seeded from Resort Property's current flags)."""
    existing = frappe.db.get_value(
        "Property Settings", {"resort_property": resort_property}, "name"
    )
    if existing:
        return frappe.get_doc("Property Settings", existing)

    # Seed allow_dirty_allocation_default from the Resort Property's legacy flag so
    # existing properties that already set allow_dirty_room_allocation = 1 keep that
    # behaviour after the first call to get_property_settings.
    rp_dirty = (
        frappe.db.get_value("Resort Property", resort_property, "allow_dirty_room_allocation") or 0
    )
    doc = frappe.get_doc(
        {
            "doctype": "Property Settings",
            "resort_property": resort_property,
            "allow_dirty_allocation_default": rp_dirty,
            "room_identifier_uniqueness": "Property",
            "hard_block_overlap_policy": "Strict",
            "default_room_naming_series": "",
        }
    )
    doc.insert(ignore_permissions=True)
    return doc


@frappe.whitelist()
def get_property_settings(resort_property):
    """Return (and auto-create) the Property Settings record for a property.

    Safe to call for any existing property — creates with sane defaults on first
    access so callers never receive a 404.
    """
    _require_permission("Property Settings", "read")
    if not frappe.db.exists("Resort Property", resort_property):
        frappe.throw(_("Resort Property {0} does not exist.").format(resort_property))
    doc = _get_or_create(resort_property)
    return _envelope(_settings_payload(doc))


@frappe.whitelist()
def update_property_settings(resort_property, settings):
    """Update writable fields on the Property Settings record for a property.

    Creates the record with sane defaults first if it does not exist yet.
    Only fields in the UPDATABLE_FIELDS set are accepted; unknown keys are ignored.
    """
    _require_permission("Property Settings", "write")
    settings = _as_dict(settings)
    if not frappe.db.exists("Resort Property", resort_property):
        frappe.throw(_("Resort Property {0} does not exist.").format(resort_property))

    doc = _get_or_create(resort_property)
    for field, value in settings.items():
        if field in _UPDATABLE_FIELDS:
            doc.set(field, value)
    doc.save(ignore_permissions=True)
    return _envelope(_settings_payload(doc))
