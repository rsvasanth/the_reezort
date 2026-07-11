"""
Setup Completeness — Script Report
Spec: 001-property-setup-room-inventory / Phase 5

One row per Resort Property (all, not just active) showing the structural
setup state: buildings, floors, room types, rooms, service locations, and
ERPNext mandatory links.

Columns: Property, Code, Company, Active, Buildings, Floors, Room Types,
         Rooms, Service Locations, Company Linked, Cost Center, Warehouse,
         Completeness Status, Missing Items.

Filters:
  - resort_property (optional — filter to a single property)
"""

import frappe
from frappe import _

_REQUIRED_ENTITIES = (
    ("buildings", "Resort Building", "resort_property"),
    ("floors", "Resort Floor", "resort_property"),
    ("room_types", "Room Type", "resort_property"),
    ("rooms", "Room", "resort_property"),
    ("service_locations", "Service Location", "resort_property"),
)


def execute(filters=None):
    filters = filters or {}
    columns = _get_columns()
    data = _get_data(filters)
    return columns, data


def _get_columns():
    return [
        {
            "fieldname": "resort_property",
            "label": _("Property"),
            "fieldtype": "Link",
            "options": "Resort Property",
            "width": 160,
        },
        {
            "fieldname": "property_code",
            "label": _("Code"),
            "fieldtype": "Data",
            "width": 90,
        },
        {
            "fieldname": "company",
            "label": _("Company"),
            "fieldtype": "Link",
            "options": "Company",
            "width": 150,
        },
        {
            "fieldname": "is_active",
            "label": _("Active"),
            "fieldtype": "Check",
            "width": 70,
        },
        {
            "fieldname": "buildings",
            "label": _("Buildings"),
            "fieldtype": "Int",
            "width": 90,
        },
        {
            "fieldname": "floors",
            "label": _("Floors"),
            "fieldtype": "Int",
            "width": 80,
        },
        {
            "fieldname": "room_types",
            "label": _("Room Types"),
            "fieldtype": "Int",
            "width": 100,
        },
        {
            "fieldname": "rooms",
            "label": _("Rooms"),
            "fieldtype": "Int",
            "width": 80,
        },
        {
            "fieldname": "service_locations",
            "label": _("Service Locations"),
            "fieldtype": "Int",
            "width": 140,
        },
        {
            "fieldname": "company_linked",
            "label": _("Company Linked"),
            "fieldtype": "Check",
            "width": 120,
        },
        {
            "fieldname": "cost_center",
            "label": _("Cost Center"),
            "fieldtype": "Link",
            "options": "Cost Center",
            "width": 150,
        },
        {
            "fieldname": "warehouse",
            "label": _("Warehouse"),
            "fieldtype": "Link",
            "options": "Warehouse",
            "width": 150,
        },
        {
            "fieldname": "completeness_status",
            "label": _("Status"),
            "fieldtype": "Data",
            "width": 120,
        },
        {
            "fieldname": "missing_items",
            "label": _("Missing"),
            "fieldtype": "Small Text",
            "width": 280,
        },
    ]


def _get_data(filters):
    prop_filters = {}
    if filters.get("resort_property"):
        prop_filters["name"] = filters["resort_property"]

    properties = frappe.get_all(
        "Resort Property",
        filters=prop_filters,
        fields=[
            "name",
            "property_code",
            "company",
            "is_active",
            "default_cost_center",
            "default_warehouse",
        ],
        order_by="property_name asc",
    )

    # Batch count active child records per property.
    property_names = [p.name for p in properties]
    if not property_names:
        return []

    counts = _batch_counts(property_names)

    rows = []
    for prop in properties:
        pname = prop.name
        prop_counts = counts.get(pname, {})

        missing = []
        if not prop.company:
            missing.append("company link")
        if not prop_counts.get("buildings"):
            missing.append("buildings")
        if not prop_counts.get("floors"):
            missing.append("floors")
        if not prop_counts.get("room_types"):
            missing.append("room types")
        if not prop_counts.get("rooms"):
            missing.append("rooms")
        if not prop_counts.get("service_locations"):
            missing.append("service locations")

        completeness_status = "Complete" if not missing else "Incomplete"

        rows.append(
            {
                "resort_property": pname,
                "property_code": prop.property_code,
                "company": prop.company,
                "is_active": prop.is_active,
                "buildings": prop_counts.get("buildings", 0),
                "floors": prop_counts.get("floors", 0),
                "room_types": prop_counts.get("room_types", 0),
                "rooms": prop_counts.get("rooms", 0),
                "service_locations": prop_counts.get("service_locations", 0),
                "company_linked": 1 if prop.company else 0,
                "cost_center": prop.default_cost_center,
                "warehouse": prop.default_warehouse,
                "completeness_status": completeness_status,
                "missing_items": ", ".join(missing) if missing else "",
            }
        )

    return rows


def _batch_counts(property_names):
    """Return {property_name: {entity_key: count}} using one SQL query per entity type."""
    from collections import defaultdict

    result = defaultdict(lambda: defaultdict(int))

    for entity_key, doctype, link_field in _REQUIRED_ENTITIES:
        rows = frappe.db.get_all(
            doctype,
            filters={link_field: ["in", property_names], "is_active": 1},
            fields=[link_field, "count(*) as cnt"],
            group_by=link_field,
            as_list=False,
        )
        for row in rows:
            result[row[link_field]][entity_key] = row.cnt

    return result
