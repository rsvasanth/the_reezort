"""Property Management — full CRUD for the property/room hierarchy + equipment.

Complements setup/api.py (which owns the guided create path). This module adds
update, soft-deactivate, dependency-guarded delete, the amenity/equipment
catalog, and per-room equipment tracking (WiFi / TV / AC … with condition).

Soft delete is the default: flip is_active. Hard delete is allowed only when no
other record links the row (Frappe's LinkExistsError is the guard).
"""

import frappe
from frappe import _

from the_reezort.setup.api import (
	_as_dict,
	_as_list,
	_clean,
	_envelope,
	_require_permission,
	_building_data,
	_floor_data,
	_property_data,
	_room_type_data,
)

# Doctypes this module is allowed to mutate — never trust an arbitrary doctype from the client.
_MANAGED = {
	"Resort Property",
	"Resort Building",
	"Resort Floor",
	"Room Type",
	"Room",
	"Room Amenity",
}

# Editable fields per doctype (identity/code fields are intentionally excluded).
_EDITABLE = {
	"Resort Property": [
		"property_name", "company", "default_currency", "timezone", "address",
		"phone", "email", "tax_region", "default_check_in_time", "default_check_out_time",
	],
	"Resort Building": ["building_name", "operational_zone", "display_order"],
	"Resort Floor": ["floor_label", "housekeeping_zone", "maintenance_zone", "display_order"],
	"Room Type": [
		"room_type_name", "description", "standard_adults", "standard_children",
		"max_occupancy", "bed_configuration",
	],
	"Room": [
		"room_name", "room_type", "smoking_policy", "is_accessible", "display_order",
		"occupancy_status", "housekeeping_status", "maintenance_status", "sellable_status",
	],
	"Room Amenity": ["amenity_name", "amenity_type", "is_guest_visible", "icon"],
}


def _assert_managed(doctype):
	if doctype not in _MANAGED:
		frappe.throw(_("{0} is not a managed property doctype.").format(doctype))


def _amenity_data(doc):
	return {
		"name": doc.name,
		"amenity_name": doc.amenity_name,
		"amenity_code": doc.amenity_code,
		"amenity_type": doc.amenity_type,
		"is_guest_visible": doc.is_guest_visible,
		"icon": doc.icon,
		"is_active": doc.is_active,
	}


def _room_data(doc):
	return {
		"name": doc.name,
		"resort_property": doc.resort_property,
		"building": doc.building,
		"floor": doc.floor,
		"room_type": doc.room_type,
		"room_number": doc.room_number,
		"room_name": doc.room_name,
		"smoking_policy": doc.smoking_policy,
		"is_accessible": doc.is_accessible,
		"occupancy_status": doc.occupancy_status,
		"housekeeping_status": doc.housekeeping_status,
		"maintenance_status": doc.maintenance_status,
		"sellable_status": doc.sellable_status,
		"is_active": doc.is_active,
	}


_SERIALIZERS = {
	"Resort Property": _property_data,
	"Resort Building": _building_data,
	"Resort Floor": _floor_data,
	"Room Type": _room_type_data,
	"Room": _room_data,
	"Room Amenity": _amenity_data,
}


# ---------- generic update / activate / delete ----------

@frappe.whitelist()
def update_record(doctype, name, payload):
	"""Apply whitelisted editable fields to a managed record."""
	_assert_managed(doctype)
	_require_permission(doctype, "write")
	payload = _as_dict(payload)

	doc = frappe.get_doc(doctype, name)
	editable = _EDITABLE.get(doctype, [])
	changed = []
	for field in editable:
		if field in payload:
			value = payload[field]
			doc.set(field, _clean(value) if isinstance(value, str) else value)
			changed.append(field)
	doc.save(ignore_permissions=True)
	serializer = _SERIALIZERS.get(doctype, lambda d: {"name": d.name})
	return _envelope({"record": serializer(doc), "changed": changed})


@frappe.whitelist()
def set_active(doctype, name, is_active):
	"""Soft activate/deactivate — the default 'delete' for records with history."""
	_assert_managed(doctype)
	_require_permission(doctype, "write")
	active = 1 if str(is_active) in ("1", "true", "True") else 0
	frappe.db.set_value(doctype, name, "is_active", active)
	return _envelope({"name": name, "is_active": active})


@frappe.whitelist()
def delete_record(doctype, name):
	"""Hard delete, guarded: refused (not crashed) if anything still links the row."""
	_assert_managed(doctype)
	_require_permission(doctype, "delete")
	try:
		frappe.delete_doc(doctype, name)
	except frappe.LinkExistsError:
		frappe.throw(
			_("Cannot delete {0} — other records still reference it. Deactivate it instead.").format(name)
		)
	return _envelope({"deleted": name})


# ---------- amenity / equipment catalog ----------

@frappe.whitelist()
def list_amenities(include_inactive=0):
	_require_permission("Room Amenity", "read")
	filters = {} if str(include_inactive) in ("1", "true", "True") else {"is_active": 1}
	rows = frappe.get_all(
		"Room Amenity",
		filters=filters,
		fields=["name", "amenity_name", "amenity_code", "amenity_type", "is_guest_visible", "icon", "is_active"],
		order_by="amenity_name asc",
	)
	return _envelope({"amenities": rows})


@frappe.whitelist()
def create_amenity(payload):
	_require_permission("Room Amenity", "create")
	payload = _as_dict(payload)
	name = _clean(payload.get("amenity_name"))
	code = _clean(payload.get("amenity_code"))
	if not name:
		frappe.throw(_("Amenity name is required."))
	if not code:
		frappe.throw(_("Amenity code is required."))

	existing = frappe.db.get_value("Room Amenity", {"amenity_code": code}, "name")
	if existing:
		return _envelope(
			{"amenity": _amenity_data(frappe.get_doc("Room Amenity", existing)), "reused": True}
		)

	doc = frappe.get_doc(
		{
			"doctype": "Room Amenity",
			"amenity_name": name,
			"amenity_code": code,
			"amenity_type": payload.get("amenity_type") or "Room",
			"is_guest_visible": 1 if payload.get("is_guest_visible") else 0,
			"icon": payload.get("icon"),
			"is_active": 1,
		}
	)
	doc.insert(ignore_permissions=True)
	return _envelope({"amenity": _amenity_data(doc), "reused": False})


# ---------- per-room equipment ----------

_CONDITIONS = {"Working", "Faulty", "Under Repair", "Missing", "Not Installed"}


@frappe.whitelist()
def get_room_equipment(room):
	_require_permission("Room", "read")
	doc = frappe.get_doc("Room", room)
	return _envelope(
		{
			"room": doc.name,
			"room_number": doc.room_number,
			"items": [
				{
					"amenity": row.amenity,
					"label": row.label,
					"condition": row.condition,
					"quantity": row.quantity,
					"asset": row.asset,
					"notes": row.notes,
				}
				for row in doc.get("equipment")
			],
		}
	)


@frappe.whitelist()
def set_room_equipment(room, items):
	"""Replace a room's equipment list (WiFi / TV / AC …, each with a condition)."""
	_require_permission("Room", "write")
	items = _as_list(items)

	doc = frappe.get_doc("Room", room)
	doc.set("equipment", [])
	for item in items:
		item = _as_dict(item)
		amenity = item.get("amenity")
		if not amenity:
			continue
		if not frappe.db.exists("Room Amenity", amenity):
			frappe.throw(_("Equipment type {0} does not exist in the catalog.").format(amenity))
		condition = item.get("condition") or "Working"
		if condition not in _CONDITIONS:
			frappe.throw(_("Invalid condition {0}.").format(condition))
		doc.append(
			"equipment",
			{
				"amenity": amenity,
				"label": _clean(item.get("label")),
				"condition": condition,
				"quantity": int(item.get("quantity") or 1),
				"asset": item.get("asset"),
				"notes": item.get("notes"),
			},
		)
	doc.save(ignore_permissions=True)
	return _envelope({"room": doc.name, "count": len(doc.get("equipment"))})
