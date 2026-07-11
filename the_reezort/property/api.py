import json
from collections import Counter

import frappe
from the_reezort.permissions import system_manager_only
from frappe import _
from frappe.utils import getdate, now_datetime

from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import as_list as _as_list
from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission

ROOM_FIELDS = [
	"name",
	"room_number",
	"room_name",
	"resort_property",
	"building",
	"floor",
	"room_type",
	"occupancy_status",
	"housekeeping_status",
	"maintenance_status",
	"sellable_status",
	"display_status",
	"is_accessible",
	"is_connecting_room",
	"is_active",
	"image",
]

BLOCKING_MAINTENANCE_STATUSES = ("Under Maintenance", "Out of Order", "Out of Service")
READY_HOUSEKEEPING_STATUSES = ("Clean", "Inspected")




def _validate_date_range(start_date=None, end_date=None):
	if not start_date and not end_date:
		return None, None

	if not start_date or not end_date:
		frappe.throw(_("Both start_date and end_date are required."))

	start = getdate(start_date)
	end = getdate(end_date)

	if end < start:
		frappe.throw(_("End date cannot be before start date."))

	return start, end


def _room_filters(property=None, building=None, floor=None, room_type=None, statuses=None):
	filters = {"is_active": 1}

	if property:
		filters["resort_property"] = property
	if building:
		filters["building"] = building
	if floor:
		filters["floor"] = floor
	if room_type:
		filters["room_type"] = room_type

	statuses = _as_dict(statuses)

	if statuses.get("occupancy"):
		filters["occupancy_status"] = ["in", statuses["occupancy"]]
	if statuses.get("housekeeping"):
		filters["housekeeping_status"] = ["in", statuses["housekeeping"]]
	if statuses.get("maintenance"):
		filters["maintenance_status"] = ["in", statuses["maintenance"]]
	if statuses.get("sellable"):
		filters["sellable_status"] = ["in", statuses["sellable"]]

	return filters


def _decorate_room(row):
	row["building_name"] = frappe.db.get_value("Resort Building", row.building, "building_name")
	row["floor_label"] = frappe.db.get_value("Resort Floor", row.floor, "floor_label")
	row["room_type_name"] = frappe.db.get_value("Room Type", row.room_type, "room_type_name")
	# Fall back to Room Type image when the room hasn't been shot yet.
	if not row.get("image") and row.get("room_type"):
		row["image"] = frappe.db.get_value("Room Type", row.room_type, "image")
	return row


@frappe.whitelist()
def get_room_status_board(property=None, building=None, floor=None, room_type=None, statuses=None):
	_require_permission("Room", "read")

	rooms = frappe.get_all(
		"Room",
		filters=_room_filters(property, building, floor, room_type, statuses),
		fields=ROOM_FIELDS,
		order_by="building asc, floor asc, display_order asc, room_number asc",
	)

	return {"rooms": [_decorate_room(room) for room in rooms]}


@frappe.whitelist()
def get_room_type_availability(property=None, start_date=None, end_date=None, room_types=None, include_restricted=False):
	_require_permission("Room", "read")
	start, end = _validate_date_range(start_date, end_date)

	room_types = _as_list(room_types)
	filters = {"is_active": 1}

	if property:
		filters["resort_property"] = property
	if room_types:
		filters["name"] = ["in", room_types]

	types = frappe.get_all(
		"Room Type",
		filters=filters,
		fields=["name", "room_type_name", "room_type_code"],
		order_by="room_type_name asc",
	)
	availability = []

	for room_type_doc in types:
		room_filters = {"room_type": room_type_doc.name, "is_active": 1}
		if property:
			room_filters["resort_property"] = property

		rooms = frappe.get_all(
			"Room",
			filters=room_filters,
			fields=["name", "sellable_status", "maintenance_status"],
		)
		physical_rooms = len(rooms)

		status_blocked_names = {
			room.name
			for room in rooms
			if room.maintenance_status in BLOCKING_MAINTENANCE_STATUSES
			or room.sellable_status == "Not Sellable"
			or (not include_restricted and room.sellable_status in ("Restricted", "Temporarily Blocked"))
		}
		blocked_rooms = len(status_blocked_names)

		if start and end:
			all_room_names = [r.name for r in rooms]
			not_status_blocked = [r for r in all_room_names if r not in status_blocked_names]
			inv_blocked = _inventory_block_room_names(not_status_blocked, start, end)
			rt_block_count = _inventory_block_count_for_room_type(room_type_doc.name, start, end)
			blocked_rooms += len(inv_blocked) + rt_block_count

		availability.append(
			{
				"room_type": room_type_doc.name,
				"room_type_code": room_type_doc.room_type_code,
				"room_type_name": room_type_doc.room_type_name,
				"physical_rooms": physical_rooms,
				"blocked_rooms": blocked_rooms,
				"available_rooms": max(physical_rooms - blocked_rooms, 0),
			}
		)

	return {"availability": availability, "calculation_basis": "property_inventory_only"}


@frappe.whitelist()
def find_allocatable_rooms(property=None, room_type=None, start_date=None, end_date=None, preferences=None):
	_require_permission("Room", "read")
	start, end = _validate_date_range(start_date, end_date)

	preferences = _as_dict(preferences)
	filters = {
		"is_active": 1,
		"sellable_status": "Sellable",
		"maintenance_status": ["not in", BLOCKING_MAINTENANCE_STATUSES],
		"housekeeping_status": ["in", READY_HOUSEKEEPING_STATUSES],
	}

	if property:
		filters["resort_property"] = property
	if room_type:
		filters["room_type"] = room_type
	if preferences.get("floor"):
		filters["floor"] = preferences["floor"]
	if preferences.get("accessible") is True:
		filters["is_accessible"] = 1
	if preferences.get("connecting_room_required") is True:
		filters["is_connecting_room"] = 1

	rooms = frappe.get_all(
		"Room",
		filters=filters,
		fields=ROOM_FIELDS,
		order_by="display_order asc, room_number asc",
	)

	if start and end:
		all_room_names = [r.name for r in rooms]
		inv_blocked = _inventory_block_room_names(all_room_names, start, end)
		if inv_blocked:
			rooms = [r for r in rooms if r.name not in inv_blocked]

	return {"rooms": [_score_allocatable_room(room, preferences) for room in rooms]}


def _score_allocatable_room(room, preferences):
	score = 70
	reasons = ["room_type_match", "sellable", "maintenance_available"]

	if room.housekeeping_status == "Inspected":
		score += 15
		reasons.append("inspected")
	elif room.housekeeping_status == "Clean":
		score += 10
		reasons.append("clean")

	if preferences.get("floor") and preferences["floor"] == room.floor:
		score += 5
		reasons.append("floor_match")
	if preferences.get("accessible") is True and room.is_accessible:
		score += 5
		reasons.append("accessible")
	if preferences.get("connecting_room_required") is True and room.is_connecting_room:
		score += 5
		reasons.append("connecting_room")

	row = _decorate_room(room)
	row["room"] = room.name
	row["score"] = min(score, 100)
	row["reasons"] = reasons
	return row


# ------------------------------------------------------------------ #
# Room Inventory Block helpers                                          #
# ------------------------------------------------------------------ #


def _inventory_block_room_names(room_names, start_date, end_date):
	"""Return a set of room names that have an active, inventory-blocking
	Room Inventory Block (Room scope) overlapping [start_date, end_date).

	Only checks the rooms supplied in room_names; returns the subset that
	are blocked, as a set of names."""
	if not room_names or not start_date or not end_date:
		return set()
	rows = frappe.get_all(
		"Room Inventory Block",
		filters={
			"scope": "Room",
			"room": ["in", room_names],
			"inventory_blocking": 1,
			"status": "Active",
			"start_date": ["<", end_date],
			"end_date": [">", start_date],
		},
		pluck="room",
	)
	return set(rows)


def _inventory_block_count_for_room_type(room_type_name, start_date, end_date):
	"""Count active Room Type-scope inventory blocks overlapping [start_date, end_date)."""
	if not room_type_name or not start_date or not end_date:
		return 0
	return frappe.db.count(
		"Room Inventory Block",
		{
			"scope": "Room Type",
			"room_type": room_type_name,
			"inventory_blocking": 1,
			"status": "Active",
			"start_date": ["<", end_date],
			"end_date": [">", start_date],
		},
	)


# ------------------------------------------------------------------ #
# Room Inventory Block API endpoints                                    #
# ------------------------------------------------------------------ #


@frappe.whitelist()
def create_room_block(
	property=None,
	scope=None,
	room=None,
	room_type=None,
	block_type=None,
	start_date=None,
	end_date=None,
	is_hard_block=True,
	inventory_blocking=True,
	reason=None,
	source_doctype=None,
	source_name=None,
):
	"""Create an authorized Room Inventory Block.

	Hard blocks are validated for overlap in the controller.
	Returns the new document name and its status.
	"""
	_require_permission("Room Inventory Block", "create")

	if not property:
		frappe.throw(_("Resort Property is required."), frappe.MandatoryError)
	if not scope or scope not in ("Room", "Room Type"):
		frappe.throw(_("Scope must be 'Room' or 'Room Type'."), frappe.ValidationError)
	if not block_type:
		frappe.throw(_("Block Type is required."), frappe.MandatoryError)
	if not reason or not str(reason).strip():
		frappe.throw(_("Reason is required."), frappe.MandatoryError)
	_validate_date_range(start_date, end_date)

	is_hard_block = bool(int(is_hard_block)) if str(is_hard_block).isdigit() else bool(is_hard_block)
	inventory_blocking = bool(int(inventory_blocking)) if str(inventory_blocking).isdigit() else bool(inventory_blocking)

	doc = frappe.get_doc(
		{
			"doctype": "Room Inventory Block",
			"resort_property": property,
			"scope": scope,
			"room": room if scope == "Room" else None,
			"room_type": room_type if scope == "Room Type" else None,
			"block_type": block_type,
			"start_date": start_date,
			"end_date": end_date,
			"is_hard_block": 1 if is_hard_block else 0,
			"inventory_blocking": 1 if inventory_blocking else 0,
			"reason": reason,
			"source_doctype": source_doctype,
			"source_name": source_name,
			"status": "Active",
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()

	return _envelope(
		{"room_inventory_block": doc.name, "status": doc.status},
	)


@frappe.whitelist()
def release_room_block(room_inventory_block=None, reason=None):
	"""Release an active Room Inventory Block.

	Idempotent: if the block is already Released or Cancelled,
	returns the current state without error.
	"""
	_require_permission("Room Inventory Block", "write")

	if not room_inventory_block:
		frappe.throw(_("Room Inventory Block name is required."), frappe.MandatoryError)

	doc = frappe.get_doc("Room Inventory Block", room_inventory_block)

	if doc.status in ("Released", "Cancelled"):
		return _envelope(
			{"room_inventory_block": doc.name, "status": doc.status},
		)

	doc.status = "Released"
	doc.released_by = frappe.session.user
	doc.released_at = now_datetime()
	if reason:
		doc.reason = "\n".join(filter(None, [doc.reason, f"Released: {reason}"]))

	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return _envelope(
		{"room_inventory_block": doc.name, "status": doc.status},
	)


@frappe.whitelist()
def list_room_blocks(
	property=None,
	room=None,
	room_type=None,
	start_date=None,
	end_date=None,
	status=None,
	scope=None,
	page=1,
	page_length=50,
):
	"""List Room Inventory Blocks with optional filters.

	Date filters (start_date / end_date) return blocks whose period
	overlaps the requested range — the same semantics used by
	availability calculations.
	"""
	_require_permission("Room Inventory Block", "read")

	filters = {}
	if property:
		filters["resort_property"] = property
	if room:
		filters["room"] = room
	if room_type:
		filters["room_type"] = room_type
	if scope:
		filters["scope"] = scope
	if status:
		status_list = _as_list(status) if isinstance(status, str) and status.strip().startswith("[") else (
			status if isinstance(status, list) else [s.strip() for s in str(status).split(",") if s.strip()]
		)
		filters["status"] = ["in", status_list]
	if start_date and end_date:
		# Overlap: block's start < query end AND block's end > query start
		filters["start_date"] = ["<", end_date]
		filters["end_date"] = [">", start_date]
	elif start_date:
		filters["end_date"] = [">=", start_date]
	elif end_date:
		filters["start_date"] = ["<=", end_date]

	page = max(int(page or 1), 1)
	page_length = max(int(page_length or 50), 1)
	total_count = frappe.db.count("Room Inventory Block", filters)

	rows = frappe.get_all(
		"Room Inventory Block",
		filters=filters,
		fields=[
			"name",
			"resort_property",
			"scope",
			"block_type",
			"room",
			"room_type",
			"start_date",
			"end_date",
			"is_hard_block",
			"inventory_blocking",
			"reason",
			"status",
			"created_by",
			"released_by",
			"released_at",
		],
		order_by="start_date desc",
		limit_start=(page - 1) * page_length,
		limit_page_length=page_length,
	)

	return _envelope(
		{
			"blocks": rows,
			"total_count": total_count,
			"page": page,
			"page_length": page_length,
		}
	)


@frappe.whitelist()
def run_setup_completeness_check(property=None):
	_require_permission("Resort Property", "read")

	counts = {
		"properties": frappe.db.count("Resort Property", {"is_active": 1}),
		"buildings": frappe.db.count("Resort Building", {"is_active": 1}),
		"floors": frappe.db.count("Resort Floor", {"is_active": 1}),
		"room_types": frappe.db.count("Room Type", {"is_active": 1}),
		"rooms": frappe.db.count("Room", {"is_active": 1}),
		"service_locations": frappe.db.count("Service Location", {"is_active": 1}),
	}

	if property:
		counts.update(
			{
				"properties": frappe.db.count("Resort Property", {"name": property, "is_active": 1}),
				"buildings": frappe.db.count("Resort Building", {"resort_property": property, "is_active": 1}),
				"floors": frappe.db.count("Resort Floor", {"resort_property": property, "is_active": 1}),
				"room_types": frappe.db.count("Room Type", {"resort_property": property, "is_active": 1}),
				"rooms": frappe.db.count("Room", {"resort_property": property, "is_active": 1}),
				"service_locations": frappe.db.count(
					"Service Location", {"resort_property": property, "is_active": 1}
				),
			}
		)

	missing = [key for key, count in counts.items() if not count]
	issues = _check_erpnext_link_integrity(property)

	return {
		"complete": not missing and not issues,
		"counts": counts,
		"missing": missing,
		"issues": issues,
		"next_action": _next_setup_action(missing, issues),
	}


def _next_setup_action(missing, issues=None):
	actions = {
		"properties": "Create a Resort Property linked to an ERPNext Company.",
		"buildings": "Create at least one Resort Building.",
		"floors": "Create floors or operational levels.",
		"room_types": "Create sellable Room Types.",
		"rooms": "Create physical Room records.",
		"service_locations": "Create service locations for restaurant, room service, or outlets.",
	}
	if missing:
		return actions.get(missing[0], "Complete missing setup steps.")
	if issues:
		return "Fix ERPNext link integrity issues: {0}".format(issues[0]["message"])
	return "Property setup is ready for room inventory operations."


def _check_erpnext_link_integrity(property=None):
	"""Check active Service Locations and other records for missing ERPNext links.

	Returns a list of issue dicts matching the run_setup_completeness_check
	API response shape: {doctype, name, severity, message}.
	"""
	issues = []
	loc_filters = {"is_active": 1}
	if property:
		loc_filters["resort_property"] = property

	locations = frappe.get_all(
		"Service Location",
		filters=loc_filters,
		fields=["name", "location_name", "location_type", "default_warehouse", "default_cost_center", "can_bill_direct", "can_post_to_folio"],
	)

	# Revenue-generating outlet types that typically require stock tracking.
	warehouse_required_types = {"Restaurant", "Bar", "Cafe", "Room Service", "Spa", "Retail"}

	for loc in locations:
		if not loc.default_warehouse:
			severity = "Error" if loc.location_type in warehouse_required_types else "Warning"
			issues.append(
				{
					"doctype": "Service Location",
					"name": loc.name,
					"severity": severity,
					"message": "Default Warehouse is missing for {0} ({1}).".format(
						loc.location_name, loc.location_type
					),
				}
			)
		if not loc.default_cost_center:
			issues.append(
				{
					"doctype": "Service Location",
					"name": loc.name,
					"severity": "Warning",
					"message": "Default Cost Center is missing for {0} ({1}).".format(
						loc.location_name, loc.location_type
					),
				}
			)

	# Check active Resort Properties for missing Company link.
	prop_filters = {"is_active": 1}
	if property:
		prop_filters["name"] = property
	properties = frappe.get_all(
		"Resort Property",
		filters=prop_filters,
		fields=["name", "property_name", "company"],
	)
	for prop in properties:
		if not prop.company:
			issues.append(
				{
					"doctype": "Resort Property",
					"name": prop.name,
					"severity": "Error",
					"message": "Resort Property {0} is not linked to an ERPNext Company.".format(
						prop.property_name
					),
				}
			)

	return issues


@frappe.whitelist()
@system_manager_only
def seed_demo_property(company=None):
	_require_permission("Resort Property", "create")

	company = company or frappe.db.get_value("Company", {}, "name")

	if not company:
		frappe.throw(_("Create an ERPNext Company before seeding THE REEZORT demo property."))

	property_doc = _upsert(
		"Resort Property",
		"RZ-DEMO",
		property_name="THE REEZORT Demo Property",
		property_code="RZ-DEMO",
		company=company,
		default_currency=frappe.db.get_value("Company", company, "default_currency"),
		timezone="Asia/Kolkata",
		address="Demo beachfront resort",
		phone="+91 00000 00000",
		email="operations@thereezort.com",
		default_check_in_time="14:00:00",
		default_check_out_time="11:00:00",
	)

	amenities = _seed_amenities()
	buildings = _seed_buildings(property_doc.name)
	floors = _seed_floors(property_doc.name, buildings)
	room_types = _seed_room_types(property_doc.name, amenities)
	rooms = _seed_rooms(property_doc.name, buildings, floors, room_types)
	service_locations = _seed_service_locations(property_doc.name, buildings, floors)

	return {
		"property": property_doc.name,
		"company": company,
		"amenities": len(amenities),
		"buildings": len(buildings),
		"floors": len(floors),
		"room_types": len(room_types),
		"rooms": len(rooms),
		"service_locations": len(service_locations),
	}


def _upsert(doctype: str, name: str, **values):
	if frappe.db.exists(doctype, name):
		doc = frappe.get_doc(doctype, name)
		for key, value in values.items():
			doc.set(key, value)
		doc.save(ignore_permissions=True)
		return doc

	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True)
	return doc


def _seed_amenities():
	rows = [
		("WIFI", "High Speed Wi-Fi", "Room"),
		("BALCONY", "Private Balcony", "Room"),
		("SEA-VIEW", "Sea View", "Internal Attribute"),
		("MINIBAR", "Minibar", "Room"),
	]

	return [
		_upsert(
			"Room Amenity",
			code,
			amenity_name=name,
			amenity_code=code,
			amenity_type=amenity_type,
			is_guest_visible=1,
		)
		for code, name, amenity_type in rows
	]


def _seed_buildings(property_name):
	rows = [("MAIN", "Main Wing"), ("VILLA", "Villa Enclave")]
	return [
		_upsert(
			"Resort Building",
			f"{property_name}-{code}",
			resort_property=property_name,
			building_name=name,
			building_code=code,
			display_order=index + 1,
		)
		for index, (code, name) in enumerate(rows)
	]


def _seed_floors(property_name, buildings):
	rows = []
	for building in buildings:
		if building.building_code == "MAIN":
			rows.extend([(building, "G", "Ground"), (building, "1", "Level 1"), (building, "2", "Level 2")])
		else:
			rows.append((building, "V", "Villa Zone"))

	return [
		_upsert(
			"Resort Floor",
			f"{building.name}-{code}",
			resort_property=property_name,
			building=building.name,
			floor_label=label,
			floor_code=code,
			display_order=index + 1,
		)
		for index, (building, code, label) in enumerate(rows)
	]


def _seed_room_types(property_name, amenities):
	amenity_rows = [{"amenity": amenity.name, "is_guest_visible": amenity.is_guest_visible} for amenity in amenities[:3]]
	rows = [
		("DLX", "Deluxe Sea View", 2, 1, 3),
		("STE", "Executive Suite", 2, 2, 4),
		("VIL", "Beachfront Villa", 4, 2, 6),
	]
	room_types = []

	for code, name, adults, children, max_occupancy in rows:
		doc = _upsert(
			"Room Type",
			f"{property_name}-{code}",
			resort_property=property_name,
			room_type_name=name,
			room_type_code=code,
			standard_adults=adults,
			standard_children=children,
			max_occupancy=max_occupancy,
			bed_configuration="King",
			view_tags="Sea View",
		)
		doc.set("default_amenities", amenity_rows)
		doc.save(ignore_permissions=True)
		room_types.append(doc)

	return room_types


def _seed_rooms(property_name, buildings, floors, room_types):
	building_by_code = {building.building_code: building for building in buildings}
	floors_by_code = {floor.floor_code: floor for floor in floors}
	room_type_by_code = {room_type.room_type_code: room_type for room_type in room_types}
	room_rows = []

	for floor_code, number_start in [("1", 101), ("2", 201)]:
		for offset in range(1, 7):
			room_rows.append(
				{
					"number": str(number_start + offset),
					"building": building_by_code["MAIN"],
					"floor": floors_by_code[floor_code],
					"type": room_type_by_code["DLX" if offset <= 4 else "STE"],
				}
			)

	for offset in range(1, 5):
		room_rows.append(
			{
				"number": f"V{offset:02d}",
				"building": building_by_code["VILLA"],
				"floor": floors_by_code["V"],
				"type": room_type_by_code["VIL"],
			}
		)

	status_cycle = [
		("Vacant", "Inspected", "Available", "Sellable"),
		("Occupied", "Clean", "Available", "Sellable"),
		("Due In", "Clean", "Available", "Sellable"),
		("Vacant", "Dirty", "Available", "Restricted"),
		("Vacant", "Clean", "Out of Order", "Sellable"),
	]
	rooms = []

	for index, row in enumerate(room_rows):
		occupancy, housekeeping, maintenance, sellable = status_cycle[index % len(status_cycle)]
		rooms.append(
			_upsert(
				"Room",
				f"{property_name}-{row['number']}",
				resort_property=property_name,
				building=row["building"].name,
				floor=row["floor"].name,
				room_type=row["type"].name,
				room_number=row["number"],
				display_order=index + 1,
				occupancy_status=occupancy,
				housekeeping_status=housekeeping,
				maintenance_status=maintenance,
				sellable_status=sellable,
				is_accessible=1 if index in (0, 6) else 0,
				is_connecting_room=1 if index in (1, 2) else 0,
			)
		)

	return rooms


def _seed_service_locations(property_name, buildings, floors):
	building = buildings[0]
	floor = floors[0]
	rows = [
		("ADD", "All Day Dining", "Restaurant", 1, 1),
		("POOL", "Pool Bar", "Bar", 1, 1),
		("RSVC", "Room Service", "Room Service", 0, 1),
	]

	return [
		_upsert(
			"Service Location",
			f"{property_name}-{code}",
			resort_property=property_name,
			location_name=name,
			location_code=code,
			location_type=location_type,
			building=building.name,
			floor=floor.name,
			can_bill_direct=can_bill_direct,
			can_post_to_folio=can_post_to_folio,
		)
		for code, name, location_type, can_bill_direct, can_post_to_folio in rows
	]


@frappe.whitelist()
def get_management_dashboard_snapshot(property=None):
	_require_permission("Room", "read")

	board = get_room_status_board(property=property)["rooms"]
	availability = get_room_type_availability(property=property)["availability"]
	status_counts = Counter(room.display_status for room in board)
	occupancy_count = sum(1 for room in board if room.occupancy_status in ("Occupied", "Due In", "Due Out"))
	sellable_rooms = sum(1 for room in board if room.sellable_status == "Sellable")

	return {
		"property": property,
		"kpis": {
			"total_rooms": len(board),
			"sellable_rooms": sellable_rooms,
			"occupied_or_due_rooms": occupancy_count,
			"occupancy_percent": round((occupancy_count / len(board)) * 100) if board else 0,
			"out_of_order_rooms": sum(1 for room in board if room.maintenance_status in BLOCKING_MAINTENANCE_STATUSES),
		},
		"status_counts": dict(status_counts),
		"availability": availability,
		"rooms": board,
	}
