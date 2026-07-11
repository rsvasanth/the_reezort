"""CRUD API for Event Space, Event Space Combination, and Activity Area.

These are module-001 schema records consumed eventually by the Banquets (011)
and Spa (007) modules. This file owns create / list / update / soft-delete for
all three doctypes. Hard delete is guarded by Frappe's LinkExistsError.

Import conventions match the codebase standard established in the 2026-07-10
audit: envelope and require_permission are imported once from the_reezort.utils
and locally aliased — never redefined.
"""

import frappe
from frappe import _

from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import as_list as _as_list
from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission


# ---------- serialisers ----------

def _event_space_data(doc):
	return {
		"name": doc.name,
		"resort_property": doc.resort_property,
		"space_name": doc.space_name,
		"space_code": doc.space_code,
		"building": doc.building,
		"floor": doc.floor,
		"capacity": doc.capacity,
		"area_sqft": doc.area_sqft,
		"divisible": doc.divisible,
		"default_cost_center": doc.default_cost_center,
		"equipment_notes": doc.equipment_notes,
		"operating_status": doc.operating_status,
		"is_active": doc.is_active,
		"combined_with": [
			{"event_space": row.event_space, "notes": row.notes}
			for row in doc.get("combined_with") or []
		],
	}


def _activity_area_data(doc):
	return {
		"name": doc.name,
		"resort_property": doc.resort_property,
		"area_name": doc.area_name,
		"area_code": doc.area_code,
		"area_type": doc.area_type,
		"linked_service_location": doc.linked_service_location,
		"capacity": doc.capacity,
		"operating_status": doc.operating_status,
		"is_active": doc.is_active,
	}


# ---------- Event Space ----------

@frappe.whitelist()
def create_event_space(payload):
	"""Create a new Event Space master record."""
	_require_permission("Event Space", "create")
	payload = _as_dict(payload)

	resort_property = (payload.get("resort_property") or "").strip()
	space_name = (payload.get("space_name") or "").strip()
	space_code = (payload.get("space_code") or "").strip()

	if not resort_property:
		frappe.throw(_("resort_property is required."))
	if not space_name:
		frappe.throw(_("space_name is required."))
	if not space_code:
		frappe.throw(_("space_code is required."))

	doc = frappe.get_doc(
		{
			"doctype": "Event Space",
			"resort_property": resort_property,
			"space_name": space_name,
			"space_code": space_code,
			"building": payload.get("building"),
			"floor": payload.get("floor"),
			"capacity": payload.get("capacity"),
			"area_sqft": payload.get("area_sqft"),
			"divisible": 1 if payload.get("divisible") else 0,
			"default_cost_center": payload.get("default_cost_center"),
			"equipment_notes": payload.get("equipment_notes"),
			"operating_status": payload.get("operating_status") or "Available",
			"is_active": 1,
		}
	)

	for row in _as_list(payload.get("combined_with") or []):
		row = _as_dict(row)
		if row.get("event_space"):
			doc.append("combined_with", {"event_space": row["event_space"], "notes": row.get("notes")})

	doc.insert(ignore_permissions=True)
	return _envelope({"event_space": _event_space_data(doc)})


@frappe.whitelist()
def list_event_spaces(resort_property=None, include_inactive=0):
	"""List Event Spaces, optionally filtered by property."""
	_require_permission("Event Space", "read")
	filters = {}
	if resort_property:
		filters["resort_property"] = resort_property
	if not str(include_inactive) in ("1", "true", "True"):
		filters["is_active"] = 1

	rows = frappe.get_all(
		"Event Space",
		filters=filters,
		fields=[
			"name", "resort_property", "space_name", "space_code",
			"building", "floor", "capacity", "area_sqft", "divisible",
			"operating_status", "is_active",
		],
		order_by="space_name asc",
	)
	return _envelope({"event_spaces": rows, "total": len(rows)})


@frappe.whitelist()
def update_event_space(name, payload):
	"""Update editable fields on an Event Space record."""
	_require_permission("Event Space", "write")
	payload = _as_dict(payload)

	_EDITABLE = [
		"space_name", "building", "floor", "capacity", "area_sqft",
		"divisible", "default_cost_center", "equipment_notes", "operating_status",
	]

	doc = frappe.get_doc("Event Space", name)
	changed = []
	for field in _EDITABLE:
		if field in payload:
			value = payload[field]
			if isinstance(value, str):
				value = value.strip()
			doc.set(field, value)
			changed.append(field)

	if "combined_with" in payload:
		doc.set("combined_with", [])
		for row in _as_list(payload["combined_with"]):
			row = _as_dict(row)
			if row.get("event_space"):
				doc.append("combined_with", {"event_space": row["event_space"], "notes": row.get("notes")})
		changed.append("combined_with")

	doc.save(ignore_permissions=True)
	return _envelope({"event_space": _event_space_data(doc), "changed": changed})


@frappe.whitelist()
def set_event_space_active(name, is_active):
	"""Soft activate or deactivate an Event Space."""
	_require_permission("Event Space", "write")
	active = 1 if str(is_active) in ("1", "true", "True") else 0
	frappe.db.set_value("Event Space", name, "is_active", active)
	return _envelope({"name": name, "is_active": active})


@frappe.whitelist()
def delete_event_space(name):
	"""Hard delete an Event Space, refused if other records still reference it."""
	_require_permission("Event Space", "delete")
	try:
		frappe.delete_doc("Event Space", name)
	except frappe.LinkExistsError:
		frappe.throw(
			_("Cannot delete Event Space {0} — other records still reference it. Deactivate it instead.").format(name)
		)
	return _envelope({"deleted": name})


# ---------- Activity Area ----------

@frappe.whitelist()
def create_activity_area(payload):
	"""Create a new Activity Area master record."""
	_require_permission("Activity Area", "create")
	payload = _as_dict(payload)

	resort_property = (payload.get("resort_property") or "").strip()
	area_name = (payload.get("area_name") or "").strip()
	area_code = (payload.get("area_code") or "").strip()

	if not resort_property:
		frappe.throw(_("resort_property is required."))
	if not area_name:
		frappe.throw(_("area_name is required."))
	if not area_code:
		frappe.throw(_("area_code is required."))

	doc = frappe.get_doc(
		{
			"doctype": "Activity Area",
			"resort_property": resort_property,
			"area_name": area_name,
			"area_code": area_code,
			"area_type": payload.get("area_type") or "Other",
			"linked_service_location": payload.get("linked_service_location"),
			"capacity": payload.get("capacity"),
			"operating_status": payload.get("operating_status") or "Available",
			"is_active": 1,
		}
	)
	doc.insert(ignore_permissions=True)
	return _envelope({"activity_area": _activity_area_data(doc)})


@frappe.whitelist()
def list_activity_areas(resort_property=None, area_type=None, include_inactive=0):
	"""List Activity Areas, optionally filtered by property and/or type."""
	_require_permission("Activity Area", "read")
	filters = {}
	if resort_property:
		filters["resort_property"] = resort_property
	if area_type:
		filters["area_type"] = area_type
	if not str(include_inactive) in ("1", "true", "True"):
		filters["is_active"] = 1

	rows = frappe.get_all(
		"Activity Area",
		filters=filters,
		fields=[
			"name", "resort_property", "area_name", "area_code",
			"area_type", "linked_service_location", "capacity",
			"operating_status", "is_active",
		],
		order_by="area_name asc",
	)
	return _envelope({"activity_areas": rows, "total": len(rows)})


@frappe.whitelist()
def update_activity_area(name, payload):
	"""Update editable fields on an Activity Area record."""
	_require_permission("Activity Area", "write")
	payload = _as_dict(payload)

	_EDITABLE = [
		"area_name", "area_type", "linked_service_location",
		"capacity", "operating_status",
	]

	doc = frappe.get_doc("Activity Area", name)
	changed = []
	for field in _EDITABLE:
		if field in payload:
			value = payload[field]
			if isinstance(value, str):
				value = value.strip()
			doc.set(field, value)
			changed.append(field)

	doc.save(ignore_permissions=True)
	return _envelope({"activity_area": _activity_area_data(doc), "changed": changed})


@frappe.whitelist()
def set_activity_area_active(name, is_active):
	"""Soft activate or deactivate an Activity Area."""
	_require_permission("Activity Area", "write")
	active = 1 if str(is_active) in ("1", "true", "True") else 0
	frappe.db.set_value("Activity Area", name, "is_active", active)
	return _envelope({"name": name, "is_active": active})


@frappe.whitelist()
def delete_activity_area(name):
	"""Hard delete an Activity Area, refused if other records still reference it."""
	_require_permission("Activity Area", "delete")
	try:
		frappe.delete_doc("Activity Area", name)
	except frappe.LinkExistsError:
		frappe.throw(
			_("Cannot delete Activity Area {0} — other records still reference it. Deactivate it instead.").format(name)
		)
	return _envelope({"deleted": name})
