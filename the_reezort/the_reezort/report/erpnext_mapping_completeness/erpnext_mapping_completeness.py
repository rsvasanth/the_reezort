"""
ERPNext Mapping Completeness — Script Report
Spec: 001-property-setup-room-inventory / Phase 5

Audits ERPNext linkage health across Room Types and Service Locations.

Room Types need: erpnext_item or erpnext_item_group (for billing/package)
                 and optionally a cost_center at room level (checked via Room).
Service Locations need: default_cost_center (for department P&L)
                        and default_warehouse (for stock movement outlets).

The report also validates that linked ERPNext records actually exist and
are not disabled (soft-validation: warns when the linked doc is disabled
but does not exclude the row from results).

Columns: Entity Type, Entity Name, Property, Active,
         ERPNext Item, Item Group (Room Type only),
         Cost Center, Warehouse (Service Location only),
         Item Linked, Cost Center Linked, Warehouse Linked,
         Mapping Status, Issues.

Filters:
  - resort_property  (optional)
  - entity_type      (optional: "Room Type" | "Service Location" | blank = both)
  - mapping_status   (optional: "Complete" | "Incomplete" | blank = all)
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
            "fieldname": "entity_type",
            "label": _("Entity Type"),
            "fieldtype": "Data",
            "width": 140,
        },
        {
            "fieldname": "entity_name",
            "label": _("Name"),
            "fieldtype": "Data",
            "width": 180,
        },
        {
            "fieldname": "entity_code",
            "label": _("Code"),
            "fieldtype": "Data",
            "width": 90,
        },
        {
            "fieldname": "resort_property",
            "label": _("Property"),
            "fieldtype": "Link",
            "options": "Resort Property",
            "width": 130,
        },
        {
            "fieldname": "is_active",
            "label": _("Active"),
            "fieldtype": "Check",
            "width": 70,
        },
        {
            "fieldname": "erpnext_item",
            "label": _("ERPNext Item"),
            "fieldtype": "Link",
            "options": "Item",
            "width": 140,
        },
        {
            "fieldname": "erpnext_item_group",
            "label": _("Item Group"),
            "fieldtype": "Link",
            "options": "Item Group",
            "width": 140,
        },
        {
            "fieldname": "cost_center",
            "label": _("Cost Center"),
            "fieldtype": "Link",
            "options": "Cost Center",
            "width": 160,
        },
        {
            "fieldname": "warehouse",
            "label": _("Warehouse"),
            "fieldtype": "Link",
            "options": "Warehouse",
            "width": 160,
        },
        {
            "fieldname": "item_linked",
            "label": _("Item Linked"),
            "fieldtype": "Check",
            "width": 100,
        },
        {
            "fieldname": "cost_center_linked",
            "label": _("Cost Center Linked"),
            "fieldtype": "Check",
            "width": 140,
        },
        {
            "fieldname": "warehouse_linked",
            "label": _("Warehouse Linked"),
            "fieldtype": "Check",
            "width": 130,
        },
        {
            "fieldname": "mapping_status",
            "label": _("Mapping Status"),
            "fieldtype": "Data",
            "width": 130,
        },
        {
            "fieldname": "issues",
            "label": _("Issues"),
            "fieldtype": "Small Text",
            "width": 320,
        },
    ]


# ---------------------------------------------------------------------------
# Data assembly
# ---------------------------------------------------------------------------

def _get_data(filters):
    entity_type_filter = filters.get("entity_type", "")
    mapping_status_filter = filters.get("mapping_status", "")

    rows = []

    if not entity_type_filter or entity_type_filter == "Room Type":
        rows.extend(_room_type_rows(filters))

    if not entity_type_filter or entity_type_filter == "Service Location":
        rows.extend(_service_location_rows(filters))

    if mapping_status_filter:
        rows = [r for r in rows if r["mapping_status"] == mapping_status_filter]

    return rows


def _room_type_rows(filters):
    rt_filters = {}
    if filters.get("resort_property"):
        rt_filters["resort_property"] = filters["resort_property"]

    room_types = frappe.get_all(
        "Room Type",
        filters=rt_filters,
        fields=[
            "name",
            "room_type_name",
            "room_type_code",
            "resort_property",
            "is_active",
            "erpnext_item",
            "erpnext_item_group",
        ],
        order_by="room_type_name asc",
    )

    # Collect all linked Item names for a single existence/disabled check.
    all_items = {rt.erpnext_item for rt in room_types if rt.erpnext_item}
    all_item_groups = {rt.erpnext_item_group for rt in room_types if rt.erpnext_item_group}

    item_status = _check_linked_docs("Item", "disabled", all_items)
    item_group_status = _check_linked_docs("Item Group", "disabled", all_item_groups)

    rows = []
    for rt in room_types:
        issues = []

        has_item = bool(rt.erpnext_item or rt.erpnext_item_group)
        if not has_item:
            issues.append("no ERPNext Item or Item Group linked")

        if rt.erpnext_item:
            state = item_status.get(rt.erpnext_item)
            if state is None:
                issues.append(f"Item '{rt.erpnext_item}' does not exist")
                has_item = False
            elif state == 1:
                issues.append(f"Item '{rt.erpnext_item}' is disabled")

        if rt.erpnext_item_group:
            state = item_group_status.get(rt.erpnext_item_group)
            if state is None:
                issues.append(f"Item Group '{rt.erpnext_item_group}' does not exist")

        mapping_status = "Complete" if not issues else "Incomplete"

        rows.append(
            {
                "entity_type": "Room Type",
                "entity_name": rt.room_type_name or rt.name,
                "entity_code": rt.room_type_code,
                "resort_property": rt.resort_property,
                "is_active": rt.is_active,
                "erpnext_item": rt.erpnext_item,
                "erpnext_item_group": rt.erpnext_item_group,
                "cost_center": None,
                "warehouse": None,
                "item_linked": 1 if has_item else 0,
                "cost_center_linked": 0,
                "warehouse_linked": 0,
                "mapping_status": mapping_status,
                "issues": "; ".join(issues) if issues else "",
            }
        )

    return rows


def _service_location_rows(filters):
    sl_filters = {}
    if filters.get("resort_property"):
        sl_filters["resort_property"] = filters["resort_property"]

    locations = frappe.get_all(
        "Service Location",
        filters=sl_filters,
        fields=[
            "name",
            "location_name",
            "location_code",
            "resort_property",
            "is_active",
            "default_cost_center",
            "default_warehouse",
            "can_bill_direct",
            "can_post_to_folio",
        ],
        order_by="location_name asc",
    )

    all_cost_centers = {sl.default_cost_center for sl in locations if sl.default_cost_center}
    all_warehouses = {sl.default_warehouse for sl in locations if sl.default_warehouse}

    cc_status = _check_linked_docs("Cost Center", "disabled", all_cost_centers)
    wh_status = _check_linked_docs("Warehouse", "disabled", all_warehouses)

    rows = []
    for sl in locations:
        issues = []

        has_cost_center = bool(sl.default_cost_center)
        has_warehouse = bool(sl.default_warehouse)

        # Cost center is required when the location bills to a department.
        if not has_cost_center:
            issues.append("no Cost Center linked (required for department P&L)")

        # Warehouse required when the location can perform stock movements
        # (stock-movement outlets are assumed to be those with can_post_to_folio
        # or can_bill_direct; adjust if business rule differs).
        if not has_warehouse and (sl.can_post_to_folio or sl.can_bill_direct):
            issues.append("no Warehouse linked (required for stock movement outlet)")

        if sl.default_cost_center:
            state = cc_status.get(sl.default_cost_center)
            if state is None:
                issues.append(f"Cost Center '{sl.default_cost_center}' does not exist")
                has_cost_center = False
            elif state == 1:
                issues.append(f"Cost Center '{sl.default_cost_center}' is disabled")

        if sl.default_warehouse:
            state = wh_status.get(sl.default_warehouse)
            if state is None:
                issues.append(f"Warehouse '{sl.default_warehouse}' does not exist")
                has_warehouse = False
            elif state == 1:
                issues.append(f"Warehouse '{sl.default_warehouse}' is disabled")

        mapping_status = "Complete" if not issues else "Incomplete"

        rows.append(
            {
                "entity_type": "Service Location",
                "entity_name": sl.location_name or sl.name,
                "entity_code": sl.location_code,
                "resort_property": sl.resort_property,
                "is_active": sl.is_active,
                "erpnext_item": None,
                "erpnext_item_group": None,
                "cost_center": sl.default_cost_center,
                "warehouse": sl.default_warehouse,
                "item_linked": 0,
                "cost_center_linked": 1 if has_cost_center else 0,
                "warehouse_linked": 1 if has_warehouse else 0,
                "mapping_status": mapping_status,
                "issues": "; ".join(issues) if issues else "",
            }
        )

    return rows


def _check_linked_docs(doctype, disabled_field, names):
    """Return {name: disabled_value} for existing docs; absent key = not found."""
    if not names:
        return {}
    rows = frappe.get_all(
        doctype,
        filters=[["name", "in", list(names)]],
        fields=["name", disabled_field],
    )
    return {r.name: r.get(disabled_field) for r in rows}
