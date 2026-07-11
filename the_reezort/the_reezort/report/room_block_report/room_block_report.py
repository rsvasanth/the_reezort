"""
Room Block Report — Script Report
Spec: 001-property-setup-room-inventory / Phase 5

Reports on Room Inventory Block records — temporary blocks placed on rooms or
room types for maintenance, VIP hold, owner hold, group hold, or operational
reasons.

Expected fields on Room Inventory Block (doctype built in parallel):
  resort_property, block_type, room, room_type,
  from_datetime, to_datetime, inventory_blocking, status, reason,
  source_doctype, source_name.

The report degrades gracefully: if the doctype does not yet exist (e.g. during
initial deploy before migration) it returns an empty result with a notice row
rather than raising an exception.

Columns: Block, Property, Block Type, Room, Room Type, From, To,
         Inventory Blocking, Status, Reason, Source.

Filters:
  - resort_property  (optional)
  - block_type       (optional)
  - room             (optional)
  - room_type        (optional)
  - status           (optional, e.g. Active / Released / Expired)
  - from_date        (optional — lower bound on from_datetime)
  - to_date          (optional — upper bound on to_datetime)
  - inventory_blocking (optional checkbox)
"""

import frappe
from frappe import _


_DOCTYPE = "Room Inventory Block"


def execute(filters=None):
    filters = filters or {}
    columns = _get_columns()

    if not frappe.db.table_exists(_DOCTYPE):
        # Doctype not yet migrated — return empty result with a notice.
        notice = {col["fieldname"]: None for col in columns}
        notice["block"] = _("Room Inventory Block doctype not yet installed — run bench migrate.")
        return columns, [notice]

    data = _get_data(filters)
    return columns, data


def _get_columns():
    return [
        {
            "fieldname": "block",
            "label": _("Block"),
            "fieldtype": "Link",
            "options": _DOCTYPE,
            "width": 160,
        },
        {
            "fieldname": "resort_property",
            "label": _("Property"),
            "fieldtype": "Link",
            "options": "Resort Property",
            "width": 130,
        },
        {
            "fieldname": "block_type",
            "label": _("Block Type"),
            "fieldtype": "Data",
            "width": 130,
        },
        {
            "fieldname": "room",
            "label": _("Room"),
            "fieldtype": "Link",
            "options": "Room",
            "width": 100,
        },
        {
            "fieldname": "room_type",
            "label": _("Room Type"),
            "fieldtype": "Link",
            "options": "Room Type",
            "width": 140,
        },
        {
            "fieldname": "from_datetime",
            "label": _("From"),
            "fieldtype": "Datetime",
            "width": 150,
        },
        {
            "fieldname": "to_datetime",
            "label": _("To"),
            "fieldtype": "Datetime",
            "width": 150,
        },
        {
            "fieldname": "inventory_blocking",
            "label": _("Inventory Blocking"),
            "fieldtype": "Check",
            "width": 140,
        },
        {
            "fieldname": "status",
            "label": _("Status"),
            "fieldtype": "Data",
            "width": 100,
        },
        {
            "fieldname": "reason",
            "label": _("Reason"),
            "fieldtype": "Data",
            "width": 200,
        },
        {
            "fieldname": "source",
            "label": _("Source"),
            "fieldtype": "Data",
            "width": 180,
        },
    ]


def _build_filters(filters):
    db_filters = {}

    for field in ("resort_property", "block_type", "room", "room_type", "status"):
        if filters.get(field):
            db_filters[field] = filters[field]

    if filters.get("inventory_blocking"):
        db_filters["inventory_blocking"] = 1

    # Date range: from_date <= to_datetime AND to_date >= from_datetime
    # (any block that overlaps the chosen window).
    if filters.get("from_date"):
        db_filters["to_datetime"] = [">=", filters["from_date"]]
    if filters.get("to_date"):
        db_filters["from_datetime"] = ["<=", filters["to_date"]]

    return db_filters


def _get_data(filters):
    db_filters = _build_filters(filters)

    # Collect field names defensively — only request fields that exist.
    requested_fields = [
        "name",
        "resort_property",
        "block_type",
        "room",
        "room_type",
        "from_datetime",
        "to_datetime",
        "inventory_blocking",
        "status",
        "reason",
        "source_doctype",
        "source_name",
    ]

    existing_fields = {
        f.fieldname
        for f in frappe.get_meta(_DOCTYPE).fields
    }
    # Always include name even if not in meta fields list.
    fields_to_fetch = ["name"] + [f for f in requested_fields[1:] if f in existing_fields]

    blocks = frappe.get_all(
        _DOCTYPE,
        filters=db_filters,
        fields=fields_to_fetch,
        order_by="from_datetime desc",
    )

    rows = []
    for blk in blocks:
        src_doctype = blk.get("source_doctype") or ""
        src_name = blk.get("source_name") or ""
        source = f"{src_doctype}: {src_name}" if src_doctype and src_name else (src_doctype or src_name or "")

        rows.append(
            {
                "block": blk.name,
                "resort_property": blk.get("resort_property"),
                "block_type": blk.get("block_type"),
                "room": blk.get("room"),
                "room_type": blk.get("room_type"),
                "from_datetime": blk.get("from_datetime"),
                "to_datetime": blk.get("to_datetime"),
                "inventory_blocking": blk.get("inventory_blocking", 0),
                "status": blk.get("status"),
                "reason": blk.get("reason"),
                "source": source,
            }
        )

    return rows
