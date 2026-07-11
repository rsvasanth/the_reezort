"""
Room Type Inventory Summary — Script Report
Spec: 001-property-setup-room-inventory / Phase 5

One row per active Room Type showing physical room counts broken down by
maintenance status, sellable status, and housekeeping readiness.

Columns: Room Type, Code, Property, Total Rooms, Active Rooms,
         Sellable, Not Sellable, Restricted, Temporarily Blocked,
         Out of Order, Out of Service, Under Maintenance,
         Dirty, Available (sellable + not blocked).

Filters:
  - resort_property (optional)
  - include_inactive_types (checkbox, default 0)
"""

import frappe
from frappe import _

_BLOCKING_MAINTENANCE = {"Under Maintenance", "Out of Order", "Out of Service"}
_BLOCKING_SELLABLE = {"Not Sellable"}
_RESTRICTED_SELLABLE = {"Restricted", "Temporarily Blocked"}


def execute(filters=None):
    filters = filters or {}
    columns = _get_columns()
    data = _get_data(filters)
    return columns, data


def _get_columns():
    return [
        {
            "fieldname": "room_type",
            "label": _("Room Type"),
            "fieldtype": "Link",
            "options": "Room Type",
            "width": 160,
        },
        {
            "fieldname": "room_type_code",
            "label": _("Code"),
            "fieldtype": "Data",
            "width": 80,
        },
        {
            "fieldname": "resort_property",
            "label": _("Property"),
            "fieldtype": "Link",
            "options": "Resort Property",
            "width": 130,
        },
        {
            "fieldname": "total_rooms",
            "label": _("Total Rooms"),
            "fieldtype": "Int",
            "width": 100,
        },
        {
            "fieldname": "active_rooms",
            "label": _("Active Rooms"),
            "fieldtype": "Int",
            "width": 100,
        },
        {
            "fieldname": "sellable",
            "label": _("Sellable"),
            "fieldtype": "Int",
            "width": 90,
        },
        {
            "fieldname": "not_sellable",
            "label": _("Not Sellable"),
            "fieldtype": "Int",
            "width": 100,
        },
        {
            "fieldname": "restricted",
            "label": _("Restricted"),
            "fieldtype": "Int",
            "width": 90,
        },
        {
            "fieldname": "temporarily_blocked",
            "label": _("Temp Blocked"),
            "fieldtype": "Int",
            "width": 110,
        },
        {
            "fieldname": "out_of_order",
            "label": _("Out of Order"),
            "fieldtype": "Int",
            "width": 110,
        },
        {
            "fieldname": "out_of_service",
            "label": _("Out of Service"),
            "fieldtype": "Int",
            "width": 120,
        },
        {
            "fieldname": "under_maintenance",
            "label": _("Under Maintenance"),
            "fieldtype": "Int",
            "width": 140,
        },
        {
            "fieldname": "dirty",
            "label": _("Dirty"),
            "fieldtype": "Int",
            "width": 80,
        },
        {
            "fieldname": "available",
            "label": _("Available (net)"),
            "fieldtype": "Int",
            "width": 120,
        },
    ]


def _get_data(filters):
    rt_filters = {}
    if not filters.get("include_inactive_types"):
        rt_filters["is_active"] = 1
    if filters.get("resort_property"):
        rt_filters["resort_property"] = filters["resort_property"]

    room_types = frappe.get_all(
        "Room Type",
        filters=rt_filters,
        fields=["name", "room_type_name", "room_type_code", "resort_property"],
        order_by="room_type_name asc",
    )

    # Load all rooms for the selected property in one query, then group in Python.
    room_q_filters = {}
    if filters.get("resort_property"):
        room_q_filters["resort_property"] = filters["resort_property"]

    all_rooms = frappe.get_all(
        "Room",
        filters=room_q_filters,
        fields=["room_type", "is_active", "sellable_status", "maintenance_status", "housekeeping_status"],
    )

    # Group rooms by room_type name for O(1) lookup.
    from collections import defaultdict

    rooms_by_type = defaultdict(list)
    for room in all_rooms:
        rooms_by_type[room.room_type].append(room)

    rows = []
    for rt in room_types:
        bucket = rooms_by_type.get(rt.name, [])
        active = [r for r in bucket if r.is_active]

        sellable = sum(1 for r in active if r.sellable_status == "Sellable")
        not_sellable = sum(1 for r in active if r.sellable_status == "Not Sellable")
        restricted = sum(1 for r in active if r.sellable_status == "Restricted")
        temp_blocked = sum(1 for r in active if r.sellable_status == "Temporarily Blocked")
        out_of_order = sum(1 for r in active if r.maintenance_status == "Out of Order")
        out_of_service = sum(1 for r in active if r.maintenance_status == "Out of Service")
        under_maint = sum(1 for r in active if r.maintenance_status == "Under Maintenance")
        dirty = sum(
            1 for r in active
            if r.housekeeping_status in ("Dirty", "In Progress", "Pickup", "Turndown Required")
        )
        # Net available: sellable minus inventory-blocking maintenance rooms.
        blocked_by_maint = sum(1 for r in active if r.maintenance_status in _BLOCKING_MAINTENANCE)
        available = max(sellable - blocked_by_maint, 0)

        rows.append(
            {
                "room_type": rt.name,
                "room_type_code": rt.room_type_code,
                "resort_property": rt.resort_property,
                "total_rooms": len(bucket),
                "active_rooms": len(active),
                "sellable": sellable,
                "not_sellable": not_sellable,
                "restricted": restricted,
                "temporarily_blocked": temp_blocked,
                "out_of_order": out_of_order,
                "out_of_service": out_of_service,
                "under_maintenance": under_maint,
                "dirty": dirty,
                "available": available,
            }
        )

    return rows
