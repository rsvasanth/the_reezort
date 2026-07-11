"""
Room Inventory Status — Script Report
Spec: 001-property-setup-room-inventory / Phase 5

Columns: Room, Room Name, Property, Building, Floor, Room Type,
         Occupancy Status, Housekeeping Status, Maintenance Status,
         Sellable Status, Display Status, Active, Accessible.

Filters:
  - resort_property (optional)
  - building        (optional)
  - floor           (optional)
  - room_type       (optional)
  - occupancy_status (optional, multi-select via comma-separated string)
  - housekeeping_status (optional)
  - maintenance_status  (optional)
  - sellable_status     (optional)
  - include_inactive    (checkbox, default 0)
"""

import frappe
from frappe import _


def execute(filters=None):
    filters = filters or {}
    columns = _get_columns()
    data = _get_data(filters)
    return columns, data


def _get_columns():
    return [
        {
            "fieldname": "room",
            "label": _("Room"),
            "fieldtype": "Link",
            "options": "Room",
            "width": 120,
        },
        {
            "fieldname": "room_number",
            "label": _("Room Number"),
            "fieldtype": "Data",
            "width": 110,
        },
        {
            "fieldname": "room_name",
            "label": _("Room Name"),
            "fieldtype": "Data",
            "width": 140,
        },
        {
            "fieldname": "resort_property",
            "label": _("Property"),
            "fieldtype": "Link",
            "options": "Resort Property",
            "width": 130,
        },
        {
            "fieldname": "building_name",
            "label": _("Building"),
            "fieldtype": "Data",
            "width": 130,
        },
        {
            "fieldname": "floor_label",
            "label": _("Floor"),
            "fieldtype": "Data",
            "width": 100,
        },
        {
            "fieldname": "room_type_name",
            "label": _("Room Type"),
            "fieldtype": "Data",
            "width": 150,
        },
        {
            "fieldname": "occupancy_status",
            "label": _("Occupancy"),
            "fieldtype": "Data",
            "width": 120,
        },
        {
            "fieldname": "housekeeping_status",
            "label": _("Housekeeping"),
            "fieldtype": "Data",
            "width": 140,
        },
        {
            "fieldname": "maintenance_status",
            "label": _("Maintenance"),
            "fieldtype": "Data",
            "width": 140,
        },
        {
            "fieldname": "sellable_status",
            "label": _("Sellable"),
            "fieldtype": "Data",
            "width": 120,
        },
        {
            "fieldname": "display_status",
            "label": _("Display Status"),
            "fieldtype": "Data",
            "width": 160,
        },
        {
            "fieldname": "is_active",
            "label": _("Active"),
            "fieldtype": "Check",
            "width": 70,
        },
        {
            "fieldname": "is_accessible",
            "label": _("Accessible"),
            "fieldtype": "Check",
            "width": 90,
        },
    ]


def _build_filters(filters):
    db_filters = {}

    if not filters.get("include_inactive"):
        db_filters["is_active"] = 1

    for field in ("resort_property", "building", "floor", "room_type"):
        if filters.get(field):
            db_filters[field] = filters[field]

    for status_field in (
        "occupancy_status",
        "housekeeping_status",
        "maintenance_status",
        "sellable_status",
    ):
        raw = filters.get(status_field)
        if raw:
            values = [v.strip() for v in raw.split(",") if v.strip()]
            if len(values) == 1:
                db_filters[status_field] = values[0]
            elif values:
                db_filters[status_field] = ["in", values]

    return db_filters


def _get_data(filters):
    db_filters = _build_filters(filters)

    rooms = frappe.get_all(
        "Room",
        filters=db_filters,
        fields=[
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
            "is_active",
            "is_accessible",
        ],
        order_by="building asc, floor asc, display_order asc, room_number asc",
    )

    # Resolve human-readable labels via single batch queries keyed by name.
    building_names = _batch_get("Resort Building", "building_name", {r.building for r in rooms if r.building})
    floor_labels = _batch_get("Resort Floor", "floor_label", {r.floor for r in rooms if r.floor})
    rt_names = _batch_get("Room Type", "room_type_name", {r.room_type for r in rooms if r.room_type})

    rows = []
    for room in rooms:
        rows.append(
            {
                "room": room.name,
                "room_number": room.room_number,
                "room_name": room.room_name,
                "resort_property": room.resort_property,
                "building_name": building_names.get(room.building, room.building),
                "floor_label": floor_labels.get(room.floor, room.floor),
                "room_type_name": rt_names.get(room.room_type, room.room_type),
                "occupancy_status": room.occupancy_status,
                "housekeeping_status": room.housekeeping_status,
                "maintenance_status": room.maintenance_status,
                "sellable_status": room.sellable_status,
                "display_status": room.display_status,
                "is_active": room.is_active,
                "is_accessible": room.is_accessible,
            }
        )
    return rows


def _batch_get(doctype, value_field, names):
    """Return {name: value_field} for every name in the set."""
    if not names:
        return {}
    rows = frappe.get_all(
        doctype,
        filters=[["name", "in", list(names)]],
        fields=["name", value_field],
    )
    return {r.name: r.get(value_field) for r in rows}
