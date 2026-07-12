"""Property Management — full CRUD for the property/room hierarchy + equipment.

Complements setup/api.py (which owns the guided create path). This module adds
update, soft-deactivate, dependency-guarded delete, the amenity/equipment
catalog, and per-room equipment tracking (WiFi / TV / AC … with condition).

Soft delete is the default: flip is_active. Hard delete is allowed only when no
other record links the row (Frappe's LinkExistsError is the guard).
"""

import frappe
from frappe import _
from frappe.utils import flt

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
	"Service Location",
}

# Status fields on Room that require an explicit reason when changed via a
# manual override (i.e. through update_record).
_ROOM_STATUS_FIELDS = frozenset(
    {"occupancy_status", "housekeeping_status", "maintenance_status", "sellable_status"}
)

# Editable fields per doctype (identity/code fields are intentionally excluded).
_EDITABLE = {
	"Resort Property": [
		"property_name", "company", "default_currency", "timezone", "address",
		"phone", "email", "tax_region", "default_check_in_time", "default_check_out_time",
		"image",
	],
	"Resort Building": ["building_name", "operational_zone", "display_order"],
	"Resort Floor": ["floor_label", "housekeeping_zone", "maintenance_zone", "display_order"],
	"Room Type": [
		"room_type_name", "description", "standard_adults", "standard_children",
		"max_occupancy", "bed_configuration", "image",
	],
	"Room": [
		"room_name", "room_type", "smoking_policy", "is_accessible", "display_order",
		"occupancy_status", "housekeeping_status", "maintenance_status", "sellable_status",
		"image",
	],
	"Room Amenity": ["amenity_name", "amenity_type", "is_guest_visible", "icon"],
	"Service Location": [
		"location_name", "location_type", "building", "floor",
		"can_bill_direct", "can_post_to_folio",
		"default_cost_center", "default_warehouse",
	],
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


def _service_location_data(doc):
	return {
		"name": doc.name,
		"resort_property": doc.resort_property,
		"location_name": doc.location_name,
		"location_code": doc.location_code,
		"location_type": doc.location_type,
		"building": doc.building,
		"floor": doc.floor,
		"can_bill_direct": doc.can_bill_direct,
		"can_post_to_folio": doc.can_post_to_folio,
		"default_cost_center": doc.default_cost_center,
		"default_warehouse": doc.default_warehouse,
		"is_active": doc.is_active,
		"operating_hours": [
			{
				"day_of_week": row.day_of_week,
				"is_closed": row.is_closed,
				"opens_at": str(row.opens_at or ""),
				"closes_at": str(row.closes_at or ""),
			}
			for row in (doc.get("operating_hours") or [])
		],
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
	"Service Location": _service_location_data,
}


# ---------- generic update / activate / delete ----------

@frappe.whitelist()
def update_record(doctype, name, payload):
	"""Apply whitelisted editable fields to a managed record.

	When doctype is "Room" and any status field (occupancy_status,
	housekeeping_status, maintenance_status, sellable_status) is present in
	the payload, a non-empty ``reason`` must also be provided. This enforces
	the spec requirement that manual status overrides are always explained.

	The reason is forwarded to the Room controller via
	doc.flags.status_change_reason so that Room Status Event records are
	populated with it.
	"""
	_assert_managed(doctype)
	_require_permission(doctype, "write")
	payload = _as_dict(payload)

	# Extract reason before iterating editable fields (it is not itself an
	# editable field — it passes through flags, not the doctype record).
	reason = _clean(payload.get("reason") or "")

	# Enforce reason when any Room status field is being manually changed.
	if doctype == "Room":
		changing_status = _ROOM_STATUS_FIELDS.intersection(payload.keys())
		if changing_status and not reason:
			frappe.throw(
				_(
					"A reason is required when changing room status fields ({0})."
					" Pass 'reason' in the payload."
				).format(", ".join(sorted(changing_status))),
				frappe.ValidationError,
			)

	doc = frappe.get_doc(doctype, name)
	editable = _EDITABLE.get(doctype, [])
	changed = []
	for field in editable:
		if field in payload:
			value = payload[field]
			doc.set(field, _clean(value) if isinstance(value, str) else value)
			changed.append(field)

	if reason:
		doc.flags.status_change_reason = reason

	doc.save(ignore_permissions=True)

	# Room Type nightly rate lives in an ERPNext Item Price, not on the doctype.
	if doctype == "Room Type" and "nightly_rate" in payload:
		from the_reezort.setup.api import _attach_room_rate

		_attach_room_rate(doc.name, doc.room_type_code, doc.room_type_name, flt(payload.get("nightly_rate")))
		changed.append("nightly_rate")

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


# ---------- room connections ----------

_VALID_CONNECTION_TYPES = {"Connecting", "Adjacent", "Nearby"}


@frappe.whitelist()
def get_room_connections(room):
	_require_permission("Room", "read")
	doc = frappe.get_doc("Room", room)
	return _envelope({
		"room": doc.name,
		"connections": [
			{
				"connected_room": row.connected_room,
				"connection_type": row.connection_type,
				"notes": row.notes,
			}
			for row in (doc.get("connecting_rooms") or [])
		],
	})


@frappe.whitelist()
def set_room_connections(room, connections):
	"""Replace a room's connecting_rooms child table."""
	_require_permission("Room", "write")
	connections = _as_list(connections)
	doc = frappe.get_doc("Room", room)
	doc.set("connecting_rooms", [])
	for item in connections:
		item = _as_dict(item)
		connected_room = item.get("connected_room")
		if not connected_room:
			continue
		if not frappe.db.exists("Room", connected_room):
			frappe.throw(_("Room {0} does not exist.").format(connected_room))
		connection_type = item.get("connection_type") or "Connecting"
		if connection_type not in _VALID_CONNECTION_TYPES:
			frappe.throw(_("Invalid connection type: {0}.").format(connection_type))
		doc.append("connecting_rooms", {
			"connected_room": connected_room,
			"connection_type": connection_type,
			"notes": _clean(item.get("notes") or ""),
		})
	doc.save(ignore_permissions=True)
	return _envelope({"room": doc.name, "count": len(doc.get("connecting_rooms"))})


# ---------- service locations ----------

_VALID_LOCATION_TYPES = {
	"Restaurant", "Bar", "Cafe", "Room Service", "Spa",
	"Gym", "Pool", "Retail", "Activity", "Other",
}

_VALID_DAYS = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}


@frappe.whitelist()
def list_service_locations(resort_property, include_inactive=0):
	_require_permission("Service Location", "read")
	filters = {"resort_property": resort_property}
	if not str(include_inactive) in ("1", "true", "True"):
		filters["is_active"] = 1
	rows = frappe.get_all(
		"Service Location",
		filters=filters,
		fields=[
			"name", "resort_property", "location_name", "location_code",
			"location_type", "building", "floor",
			"can_bill_direct", "can_post_to_folio",
			"default_cost_center", "default_warehouse", "is_active",
		],
		order_by="location_name asc",
	)
	# Attach operating_hours child rows per location.
	for row in rows:
		hours = frappe.get_all(
			"Operating Hours",
			filters={"parent": row["name"], "parenttype": "Service Location"},
			fields=["day_of_week", "is_closed", "opens_at", "closes_at"],
			order_by="idx asc",
		)
		row["operating_hours"] = [
			{
				"day_of_week": h["day_of_week"],
				"is_closed": h["is_closed"],
				"opens_at": str(h["opens_at"] or ""),
				"closes_at": str(h["closes_at"] or ""),
			}
			for h in hours
		]
	return _envelope({"locations": rows})


@frappe.whitelist()
def create_service_location(payload):
	_require_permission("Service Location", "create")
	payload = _as_dict(payload)
	resort_property = _clean(payload.get("resort_property"))
	location_name = _clean(payload.get("location_name"))
	location_code = _clean(payload.get("location_code"))
	location_type = _clean(payload.get("location_type") or "Other")
	if not resort_property:
		frappe.throw(_("resort_property is required."))
	if not location_name:
		frappe.throw(_("location_name is required."))
	if not location_code:
		frappe.throw(_("location_code is required."))
	if location_type not in _VALID_LOCATION_TYPES:
		frappe.throw(_("Invalid location_type: {0}.").format(location_type))
	doc = frappe.get_doc({
		"doctype": "Service Location",
		"resort_property": resort_property,
		"location_name": location_name,
		"location_code": location_code,
		"location_type": location_type,
		"building": payload.get("building"),
		"floor": payload.get("floor"),
		"can_bill_direct": 1 if payload.get("can_bill_direct") else 0,
		"can_post_to_folio": 1 if payload.get("can_post_to_folio") else 0,
		"default_cost_center": payload.get("default_cost_center"),
		"default_warehouse": payload.get("default_warehouse"),
		"is_active": 1,
	})
	_apply_operating_hours(doc, payload.get("operating_hours"))
	doc.insert(ignore_permissions=True)
	return _envelope({"location": _service_location_data(doc)})


@frappe.whitelist()
def update_service_location(name, payload):
	"""Update a Service Location including its operating_hours child table."""
	_require_permission("Service Location", "write")
	payload = _as_dict(payload)
	doc = frappe.get_doc("Service Location", name)
	editable = _EDITABLE["Service Location"]
	for field in editable:
		if field in payload:
			value = payload[field]
			doc.set(field, _clean(value) if isinstance(value, str) else value)
	if "operating_hours" in payload:
		doc.set("operating_hours", [])
		_apply_operating_hours(doc, payload.get("operating_hours"))
	doc.save(ignore_permissions=True)
	return _envelope({"location": _service_location_data(doc)})


def _apply_operating_hours(doc, hours_payload):
	if not hours_payload:
		return
	hours_list = _as_list(hours_payload)
	for h in hours_list:
		h = _as_dict(h)
		day = h.get("day_of_week")
		if day not in _VALID_DAYS:
			continue
		doc.append("operating_hours", {
			"day_of_week": day,
			"is_closed": 1 if h.get("is_closed") else 0,
			"opens_at": h.get("opens_at") or None,
			"closes_at": h.get("closes_at") or None,
		})
