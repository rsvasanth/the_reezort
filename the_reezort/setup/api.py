"""Property Setup — guided onboarding APIs.

Drives the resort-app "Property Setup" wizard through the master-data chain:

    Resort Property -> Resort Building -> Resort Floor -> Room Type -> Room

Every create is idempotent on its natural key (the same key Frappe uses to
autoname the record), so re-running a step is safe. Responses use the shared
envelope shape {ok, data, warnings, blockers, next_actions}.
"""

import json

import frappe
from frappe import _
from frappe.utils import flt


# ---------- helpers ----------

def _resort_company():
	return frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")


def ensure_room_item(item_code, item_name, nightly_rate, company=None):
	"""Ensure an ERPNext sellable service Item + its selling Item Price for a room type.

	This is what makes a console-created room type actually price (availability,
	estimates, folio room charges all read the Item Price via reservation._room_rate).
	"""
	company = company or _resort_company()
	if not frappe.db.exists("Item", item_code):
		item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": item_code,
				"item_name": item_name,
				"item_group": "Services",
				"stock_uom": "Nos",
				"is_stock_item": 0,
				"include_item_in_manufacturing": 0,
			}
		)
		gst = frappe.db.get_value("Item Tax Template", {"title": "GST 18%", "company": company}, "name") or frappe.db.get_value(
			"Item Tax Template", {"title": ["like", "GST 18%%"]}, "name"
		)
		if gst:
			item.set("taxes", [{"item_tax_template": gst}])
		item.insert(ignore_permissions=True)

	rate = flt(nightly_rate)
	if rate > 0:
		price_list = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name") or "Standard Selling"
		existing = frappe.db.get_value(
			"Item Price", {"item_code": item_code, "price_list": price_list, "selling": 1}, "name"
		)
		if existing:
			frappe.db.set_value("Item Price", existing, "price_list_rate", rate)
		else:
			frappe.get_doc(
				{
					"doctype": "Item Price",
					"item_code": item_code,
					"price_list": price_list,
					"selling": 1,
					"price_list_rate": rate,
				}
			).insert(ignore_permissions=True)
	return item_code


def _attach_room_rate(room_type_name, code, name, nightly_rate):
	"""Create/link the room type's ERPNext item + price so it actually prices."""
	item_code = f"ROOM-{code}"
	ensure_room_item(item_code, f"{name} (Room)", nightly_rate)
	frappe.db.set_value("Room Type", room_type_name, "erpnext_item", item_code)
	return item_code


def _room_type_rate(erpnext_item):
	"""The selling nightly rate for a room type's linked item (0 if unpriced)."""
	if not erpnext_item:
		return 0
	price_list = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
	return flt(
		frappe.db.get_value(
			"Item Price", {"item_code": erpnext_item, "price_list": price_list, "selling": 1}, "price_list_rate"
		)
	)


def _as_dict(value):
	if isinstance(value, str):
		return json.loads(value) if value else {}
	return value or {}


def _as_list(value):
	if isinstance(value, str):
		return json.loads(value) if value else []
	return value or []


def _envelope(data, warnings=None, blockers=None, next_actions=None):
	return {
		"ok": True,
		"data": data,
		"warnings": warnings or [],
		"blockers": blockers or [],
		"next_actions": next_actions or [],
	}


def _require_permission(doctype, permission_type="read"):
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)

	if not frappe.has_permission(doctype, permission_type):
		frappe.throw(
			_("You do not have {0} permission for {1}.").format(permission_type, doctype),
			frappe.PermissionError,
		)


def _clean(value):
	return (value or "").strip() if isinstance(value, str) else value


def _exists(doctype, filters):
	return frappe.db.get_value(doctype, filters, "name")


# ---------- serializers ----------

def _property_data(doc):
	return {
		"name": doc.name,
		"property_name": doc.property_name,
		"property_code": doc.property_code,
		"company": doc.company,
		"default_currency": doc.default_currency,
		"timezone": doc.timezone,
		"is_active": doc.is_active,
	}


def _building_data(doc):
	return {
		"name": doc.name,
		"resort_property": doc.resort_property,
		"building_name": doc.building_name,
		"building_code": doc.building_code,
	}


def _floor_data(doc):
	return {
		"name": doc.name,
		"resort_property": doc.resort_property,
		"building": doc.building,
		"floor_label": doc.floor_label,
		"floor_code": doc.floor_code,
	}


def _room_type_data(doc):
	return {
		"name": doc.name,
		"resort_property": doc.resort_property,
		"room_type_name": doc.room_type_name,
		"room_type_code": doc.room_type_code,
		"standard_adults": doc.standard_adults,
		"max_occupancy": doc.max_occupancy,
	}


# ---------- read endpoints ----------

@frappe.whitelist()
def list_setup_options():
	"""Dropdown data for the wizard: companies, enabled currencies, existing properties."""
	_require_permission("Resort Property", "read")
	return _envelope(
		{
			"companies": frappe.get_all(
				"Company", fields=["name", "default_currency"], order_by="name"
			),
			"currencies": [
				c.name
				for c in frappe.get_all(
					"Currency", filters={"enabled": 1}, fields=["name"], order_by="name"
				)
			],
			"properties": frappe.get_all(
				"Resort Property",
				fields=["name", "property_name", "property_code", "company"],
				order_by="property_name",
			),
		}
	)


@frappe.whitelist()
def get_property_tree(resort_property):
	"""Buildings, floors, room types, rooms + counts for a property (wizard context + review)."""
	_require_permission("Resort Property", "read")
	if not frappe.db.exists("Resort Property", resort_property):
		frappe.throw(_("Resort Property {0} does not exist.").format(resort_property))

	buildings = frappe.get_all(
		"Resort Building",
		filters={"resort_property": resort_property},
		fields=["name", "building_name", "building_code", "is_active"],
		order_by="display_order asc, building_name asc",
	)
	floors = frappe.get_all(
		"Resort Floor",
		filters={"resort_property": resort_property},
		fields=["name", "building", "floor_label", "floor_code", "is_active"],
		order_by="display_order asc, floor_label asc",
	)
	room_types = frappe.get_all(
		"Room Type",
		filters={"resort_property": resort_property},
		fields=["name", "room_type_name", "room_type_code", "max_occupancy", "is_active", "erpnext_item"],
		order_by="room_type_name asc",
	)
	for rt in room_types:
		rt["nightly_rate"] = _room_type_rate(rt.get("erpnext_item"))
	rooms = frappe.get_all(
		"Room",
		filters={"resort_property": resort_property},
		fields=[
			"name", "room_number", "room_name", "building", "floor", "room_type",
			"occupancy_status", "housekeeping_status", "maintenance_status",
			"sellable_status", "smoking_policy", "is_accessible", "is_active",
			"image",
		],
		order_by="room_number asc",
	)
	# Fall back to Room Type.image so every row has a thumb even before per-room
	# uploads land.
	rt_image = {rt["name"]: frappe.db.get_value("Room Type", rt["name"], "image") for rt in room_types}
	for r in rooms:
		if not r.get("image") and r.get("room_type"):
			r["image"] = rt_image.get(r["room_type"])
	return _envelope(
		{
			"resort_property": resort_property,
			"buildings": buildings,
			"floors": floors,
			"room_types": room_types,
			"rooms": rooms,
			"counts": {
				"buildings": len(buildings),
				"floors": len(floors),
				"room_types": len(room_types),
				"rooms": len(rooms),
			},
		}
	)


# ---------- create endpoints (one per chain step) ----------

@frappe.whitelist()
def create_property(payload):
	_require_permission("Resort Property", "create")
	payload = _as_dict(payload)

	name = _clean(payload.get("property_name"))
	code = _clean(payload.get("property_code"))
	company = payload.get("company")
	timezone = _clean(payload.get("timezone"))

	if not name:
		frappe.throw(_("Property name is required."))
	if not code:
		frappe.throw(_("Property code is required."))
	if not company:
		frappe.throw(_("Company is required."))
	if not frappe.db.exists("Company", company):
		frappe.throw(_("Company {0} does not exist.").format(company))
	if not timezone:
		frappe.throw(_("Timezone is required."))

	existing = _exists("Resort Property", {"property_code": code})
	if existing:
		return _envelope(
			{"property": _property_data(frappe.get_doc("Resort Property", existing)), "reused": True}
		)

	doc = frappe.get_doc(
		{
			"doctype": "Resort Property",
			"property_name": name,
			"property_code": code,
			"company": company,
			"timezone": timezone,
			"default_currency": payload.get("default_currency"),
			"address": payload.get("address"),
			"phone": payload.get("phone"),
			"email": payload.get("email"),
			"tax_region": payload.get("tax_region"),
			"default_check_in_time": payload.get("default_check_in_time"),
			"default_check_out_time": payload.get("default_check_out_time"),
			"is_active": 1,
		}
	)
	doc.insert(ignore_permissions=True)
	return _envelope({"property": _property_data(doc), "reused": False}, next_actions=["create_building"])


@frappe.whitelist()
def create_building(payload):
	_require_permission("Resort Building", "create")
	payload = _as_dict(payload)

	resort_property = payload.get("resort_property")
	name = _clean(payload.get("building_name"))
	code = _clean(payload.get("building_code"))

	if not resort_property or not frappe.db.exists("Resort Property", resort_property):
		frappe.throw(_("A valid resort property is required."))
	if not name:
		frappe.throw(_("Building name is required."))
	if not code:
		frappe.throw(_("Building code is required."))

	existing = _exists(
		"Resort Building", {"resort_property": resort_property, "building_code": code}
	)
	if existing:
		return _envelope(
			{"building": _building_data(frappe.get_doc("Resort Building", existing)), "reused": True}
		)

	doc = frappe.get_doc(
		{
			"doctype": "Resort Building",
			"resort_property": resort_property,
			"building_name": name,
			"building_code": code,
			"operational_zone": payload.get("operational_zone"),
			"display_order": payload.get("display_order") or 0,
			"is_active": 1,
		}
	)
	doc.insert(ignore_permissions=True)
	return _envelope({"building": _building_data(doc), "reused": False}, next_actions=["create_floor"])


@frappe.whitelist()
def create_floor(payload):
	_require_permission("Resort Floor", "create")
	payload = _as_dict(payload)

	resort_property = payload.get("resort_property")
	building = payload.get("building")
	label = _clean(payload.get("floor_label"))
	code = _clean(payload.get("floor_code"))

	if not resort_property or not frappe.db.exists("Resort Property", resort_property):
		frappe.throw(_("A valid resort property is required."))
	if not building or not frappe.db.exists("Resort Building", building):
		frappe.throw(_("A valid building is required."))
	if frappe.db.get_value("Resort Building", building, "resort_property") != resort_property:
		frappe.throw(_("Building {0} does not belong to property {1}.").format(building, resort_property))
	if not label:
		frappe.throw(_("Floor label is required."))
	if not code:
		frappe.throw(_("Floor code is required."))

	existing = _exists("Resort Floor", {"building": building, "floor_code": code})
	if existing:
		return _envelope(
			{"floor": _floor_data(frappe.get_doc("Resort Floor", existing)), "reused": True}
		)

	doc = frappe.get_doc(
		{
			"doctype": "Resort Floor",
			"resort_property": resort_property,
			"building": building,
			"floor_label": label,
			"floor_code": code,
			"display_order": payload.get("display_order") or 0,
			"housekeeping_zone": payload.get("housekeeping_zone"),
			"maintenance_zone": payload.get("maintenance_zone"),
			"is_active": 1,
		}
	)
	doc.insert(ignore_permissions=True)
	return _envelope({"floor": _floor_data(doc), "reused": False}, next_actions=["create_room_type"])


@frappe.whitelist()
def create_room_type(payload):
	_require_permission("Room Type", "create")
	payload = _as_dict(payload)

	resort_property = payload.get("resort_property")
	name = _clean(payload.get("room_type_name"))
	code = _clean(payload.get("room_type_code"))
	standard_adults = int(payload.get("standard_adults") or 2)
	max_occupancy = int(payload.get("max_occupancy") or standard_adults)
	nightly_rate = flt(payload.get("nightly_rate"))

	if not resort_property or not frappe.db.exists("Resort Property", resort_property):
		frappe.throw(_("A valid resort property is required."))
	if not name:
		frappe.throw(_("Room type name is required."))
	if not code:
		frappe.throw(_("Room type code is required."))
	if max_occupancy < standard_adults:
		frappe.throw(_("Max occupancy cannot be less than standard adults."))

	existing = _exists("Room Type", {"resort_property": resort_property, "room_type_code": code})
	if existing:
		if nightly_rate > 0:
			_attach_room_rate(existing, code, name, nightly_rate)
		return _envelope(
			{"room_type": _room_type_data(frappe.get_doc("Room Type", existing)), "reused": True}
		)

	doc = frappe.get_doc(
		{
			"doctype": "Room Type",
			"resort_property": resort_property,
			"room_type_name": name,
			"room_type_code": code,
			"description": payload.get("description"),
			"standard_adults": standard_adults,
			"standard_children": int(payload.get("standard_children") or 0),
			"max_occupancy": max_occupancy,
			"bed_configuration": payload.get("bed_configuration"),
			"is_active": 1,
		}
	)
	doc.insert(ignore_permissions=True)
	if nightly_rate > 0:
		_attach_room_rate(doc.name, code, name, nightly_rate)
	return _envelope(
		{"room_type": _room_type_data(frappe.get_doc("Room Type", doc.name)), "reused": False},
		next_actions=["create_rooms"],
	)


@frappe.whitelist()
def create_rooms_bulk(payload):
	"""Create many rooms at once under one building/floor/room-type. Idempotent per room_number."""
	_require_permission("Room", "create")
	payload = _as_dict(payload)

	resort_property = payload.get("resort_property")
	building = payload.get("building")
	floor = payload.get("floor")
	room_type = payload.get("room_type")
	room_numbers = [str(n).strip() for n in _as_list(payload.get("room_numbers")) if str(n).strip()]
	smoking_policy = payload.get("smoking_policy") or "Non-Smoking"

	if not resort_property or not frappe.db.exists("Resort Property", resort_property):
		frappe.throw(_("A valid resort property is required."))
	if not building or not frappe.db.exists("Resort Building", building):
		frappe.throw(_("A valid building is required."))
	if not floor or not frappe.db.exists("Resort Floor", floor):
		frappe.throw(_("A valid floor is required."))
	if not room_type or not frappe.db.exists("Room Type", room_type):
		frappe.throw(_("A valid room type is required."))
	if not room_numbers:
		frappe.throw(_("At least one room number is required."))

	# Integrity: building/floor/room-type must all belong to the property; floor under building.
	if frappe.db.get_value("Resort Building", building, "resort_property") != resort_property:
		frappe.throw(_("Building does not belong to the selected property."))
	if frappe.db.get_value("Resort Floor", floor, "building") != building:
		frappe.throw(_("Floor does not belong to the selected building."))
	if frappe.db.get_value("Room Type", room_type, "resort_property") != resort_property:
		frappe.throw(_("Room type does not belong to the selected property."))
	if smoking_policy not in ("Non-Smoking", "Smoking", "Flexible"):
		frappe.throw(_("Invalid smoking policy."))

	created = []
	skipped = []
	for number in room_numbers:
		if _exists("Room", {"resort_property": resort_property, "room_number": number}):
			skipped.append(number)
			continue
		room = frappe.get_doc(
			{
				"doctype": "Room",
				"resort_property": resort_property,
				"building": building,
				"floor": floor,
				"room_type": room_type,
				"room_number": number,
				"smoking_policy": smoking_policy,
				"occupancy_status": "Vacant",
				"housekeeping_status": "Clean",
				"maintenance_status": "Available",
				"sellable_status": "Sellable",
				"is_active": 1,
			}
		)
		room.insert(ignore_permissions=True)
		created.append(room.room_number)

	warnings = []
	if skipped:
		warnings.append(
			_("{0} room(s) already existed and were skipped: {1}").format(
				len(skipped), ", ".join(skipped)
			)
		)
	return _envelope(
		{
			"created": created,
			"skipped": skipped,
			"created_count": len(created),
			"skipped_count": len(skipped),
		},
		warnings=warnings,
		next_actions=["review"],
	)
