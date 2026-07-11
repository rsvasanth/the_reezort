"""Spare Part Request API — spec 009 §request_spare_parts, §approve_spare_part_request,
§issue_spare_parts, §create_spare_material_request, §list_spare_requests.

Idempotency contract:
  issue_spare_parts is idempotent on idempotency_key: a replay with the same key
  returns the already-posted result without creating a second Stock Entry. This mirrors
  the run_posting pattern in billing/posting.py but is implemented inline here to avoid
  coupling the stock entry key-space to the billing posting-log key-space.

ERPNext document creation idiom follows billing/settlement.py and fnb/restaurant.py:
  - Build the doc dict, frappe.get_doc(), insert(ignore_permissions=True), then submit()
    where the document type is submittable (Stock Entry, Material Request).
  - Permission elevation at the whitelisted boundary (this file) mirrors the F&B close path.
"""

from __future__ import annotations

import uuid

import frappe
from frappe import _
from frappe.utils import flt, now_datetime

from the_reezort.utils import as_list as _as_list
from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission

SPR = "Spare Part Request"
SLINE = "Spare Part Request Line"

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_spr(spare_request: str) -> "frappe.Document":
    doc = frappe.get_doc(SPR, spare_request)
    return doc


def _flt(val) -> float:
    try:
        return float(val or 0)
    except (TypeError, ValueError):
        return 0.0


def _snapshot_stock(item_code: str, warehouse: str) -> float:
    """Return current actual_qty from ERPNext Bin, or 0 if unavailable."""
    try:
        qty = frappe.db.get_value(
            "Bin",
            {"item_code": item_code, "warehouse": warehouse},
            "actual_qty",
        )
        return _flt(qty)
    except Exception:
        return 0.0


def _build_stock_entry(spr_doc) -> "frappe.Document":
    """Build (but do not insert) a Material Issue Stock Entry from an approved SPR."""
    company = (
        frappe.db.get_single_value("Global Defaults", "default_company")
        or frappe.db.get_value("Company", {}, "name")
    )

    items = []
    for row in spr_doc.lines:
        qty = _flt(row.approved_qty) or _flt(row.requested_qty)
        if qty <= 0:
            continue
        warehouse = row.warehouse or spr_doc.source_warehouse
        if not warehouse:
            frappe.throw(
                _("No warehouse set for item {0} in Spare Part Request {1}.").format(
                    row.item_code, spr_doc.name
                )
            )
        items.append(
            {
                "item_code": row.item_code,
                "qty": qty,
                "s_warehouse": warehouse,
                "uom": row.uom or frappe.db.get_value("Item", row.item_code, "stock_uom"),
            }
        )

    if not items:
        frappe.throw(_("No issuable lines found on Spare Part Request {0}.").format(spr_doc.name))

    se = frappe.get_doc(
        {
            "doctype": "Stock Entry",
            "stock_entry_type": "Material Issue",
            "company": company,
            "remarks": _("Spare issue for Maintenance Ticket {0} via {1}").format(
                spr_doc.maintenance_ticket, spr_doc.name
            ),
            "items": items,
        }
    )
    return se


def _build_material_request(spr_doc) -> "frappe.Document":
    """Build (but do not insert) a Material Request for unavailable spares."""
    company = (
        frappe.db.get_single_value("Global Defaults", "default_company")
        or frappe.db.get_value("Company", {}, "name")
    )

    items = []
    for row in spr_doc.lines:
        qty = _flt(row.approved_qty) or _flt(row.requested_qty)
        if qty <= 0:
            continue
        items.append(
            {
                "item_code": row.item_code,
                "qty": qty,
                "uom": row.uom or frappe.db.get_value("Item", row.item_code, "stock_uom"),
                "warehouse": row.warehouse or spr_doc.source_warehouse or "",
                "description": row.reason or "",
            }
        )

    if not items:
        frappe.throw(_("No lines found on Spare Part Request {0}.").format(spr_doc.name))

    mr = frappe.get_doc(
        {
            "doctype": "Material Request",
            "material_request_type": "Purchase",
            "company": company,
            "transaction_date": frappe.utils.today(),
            "schedule_date": frappe.utils.today(),
            "title": _("Spare parts for {0}").format(spr_doc.maintenance_ticket),
            "items": items,
        }
    )
    return mr


# ---------------------------------------------------------------------------
# Public whitelisted endpoints
# ---------------------------------------------------------------------------


@frappe.whitelist()
def request_spare_parts(ticket: str, lines: list, reason: str) -> dict:
    """Create a Spare Part Request in Requested state for the given ticket.

    lines: list of dicts with keys item_code, requested_qty, uom (opt),
           warehouse (opt), reason (opt).
    """
    _require_permission(SPR, "create")

    lines = _as_list(lines)
    if not lines:
        frappe.throw(_("At least one spare part line is required."))

    ticket_doc = frappe.get_doc("Maintenance Ticket", ticket)

    # Snapshot current stock for each line so approvers see availability.
    processed_lines = []
    for idx, line in enumerate(lines, 1):
        item_code = line.get("item_code")
        if not item_code:
            frappe.throw(_("item_code is required in line {0}.").format(idx))
        requested_qty = _flt(line.get("requested_qty", 0))
        if requested_qty <= 0:
            frappe.throw(_("requested_qty must be > 0 in line {0}.").format(idx))

        warehouse = line.get("warehouse") or ""
        snapshot = _snapshot_stock(item_code, warehouse) if warehouse else 0.0

        processed_lines.append(
            {
                "doctype": SLINE,
                "item_code": item_code,
                "requested_qty": requested_qty,
                "approved_qty": None,
                "issued_qty": 0,
                "uom": line.get("uom") or "",
                "warehouse": warehouse,
                "stock_available_snapshot": snapshot,
                "reason": line.get("reason") or reason or "",
            }
        )

    spr = frappe.get_doc(
        {
            "doctype": SPR,
            "maintenance_ticket": ticket,
            "request_status": "Requested",
            "requested_by": frappe.session.user,
            "idempotency_key": str(uuid.uuid4()),
            "lines": processed_lines,
        }
    )
    spr.insert(ignore_permissions=True)
    frappe.db.commit()

    return _envelope(
        {"spare_request": spr.name, "request_status": spr.request_status},
        next_actions=["approve_spare_part_request"],
    )


@frappe.whitelist()
def approve_spare_part_request(spare_request: str, decision: str, note: str = "") -> dict:
    """Approve or reject a Spare Part Request.

    decision: "Approved" | "Rejected"
    """
    _require_permission(SPR, "write")

    if decision not in ("Approved", "Rejected"):
        frappe.throw(_("decision must be 'Approved' or 'Rejected'."))

    spr = _get_spr(spare_request)

    if spr.request_status != "Requested":
        frappe.throw(
            _("Spare Part Request {0} is in status {1} and cannot be approved/rejected.").format(
                spare_request, spr.request_status
            )
        )

    spr.request_status = decision
    spr.approved_by = frappe.session.user

    if decision == "Approved":
        # Default approved_qty to requested_qty where not already set.
        for row in spr.lines:
            if not _flt(row.approved_qty):
                row.approved_qty = row.requested_qty

    if note:
        # Append to technical_notes on the linked ticket if present; otherwise add a comment.
        try:
            frappe.get_doc("Comment", {}).insert(
                ignore_permissions=True
            )
        except Exception:
            pass
        spr.add_comment("Comment", text=note)

    spr.save(ignore_permissions=True)
    frappe.db.commit()

    next_actions = ["issue_spare_parts"] if decision == "Approved" else []
    return _envelope(
        {"spare_request": spr.name, "request_status": spr.request_status},
        next_actions=next_actions,
    )


@frappe.whitelist()
def issue_spare_parts(spare_request: str, idempotency_key: str) -> dict:
    """Post a Material Issue Stock Entry for the approved spare request.

    Idempotent: if a Stock Entry is already linked (same idempotency_key), returns
    the existing result without creating a second entry.
    """
    _require_permission(SPR, "write")

    spr = _get_spr(spare_request)

    # Guard 1: status must be Approved (or Partially Issued for retries after partial).
    if spr.request_status not in ("Approved", "Partially Issued"):
        frappe.throw(
            _("Spare Part Request {0} must be Approved to issue parts (current: {1}).").format(
                spare_request, spr.request_status
            )
        )

    # Guard 2: idempotency — if a Stock Entry is already linked, return it.
    if spr.stock_entry:
        return _envelope(
            {
                "spare_request": spr.name,
                "request_status": spr.request_status,
                "stock_entry": spr.stock_entry,
                "reused": True,
            },
            warnings=["Stock entry already posted; returning existing result."],
        )

    # Guard 3: idempotency_key collision check against the SPR's own stored key.
    # The caller must pass the key they received at request time. If the key matches the
    # stored SPR key it is a trusted replay path; if it differs it is a programming error.
    if spr.idempotency_key and idempotency_key and spr.idempotency_key != idempotency_key:
        frappe.throw(
            _("idempotency_key mismatch for Spare Part Request {0}.").format(spare_request)
        )

    # Build and submit Stock Entry with elevated permissions (this endpoint is the trust
    # boundary, mirroring how billing/settlement.py submits Sales Invoices).
    se = _build_stock_entry(spr)
    se.insert(ignore_permissions=True)
    se.submit()

    # Update issued_qty on lines and set status.
    all_issued = True
    for row in spr.lines:
        approved = _flt(row.approved_qty) or _flt(row.requested_qty)
        row.issued_qty = approved
        if _flt(row.issued_qty) < _flt(row.requested_qty):
            all_issued = False

    spr.stock_entry = se.name
    spr.request_status = "Issued" if all_issued else "Partially Issued"
    spr.save(ignore_permissions=True)
    frappe.db.commit()

    return _envelope(
        {
            "spare_request": spr.name,
            "request_status": spr.request_status,
            "stock_entry": se.name,
            "reused": False,
        }
    )


@frappe.whitelist()
def create_spare_material_request(spare_request: str) -> dict:
    """Create an ERPNext Material Request for unavailable spares.

    Sets request_status to 'Material Requested' and links the Material Request.
    """
    _require_permission(SPR, "write")

    spr = _get_spr(spare_request)

    if spr.request_status not in ("Approved",):
        frappe.throw(
            _("Spare Part Request {0} must be Approved to raise a Material Request (current: {1}).").format(
                spare_request, spr.request_status
            )
        )

    if spr.material_request:
        return _envelope(
            {
                "spare_request": spr.name,
                "request_status": spr.request_status,
                "material_request": spr.material_request,
                "reused": True,
            },
            warnings=["Material Request already exists; returning existing result."],
        )

    mr = _build_material_request(spr)
    mr.insert(ignore_permissions=True)
    mr.submit()

    spr.material_request = mr.name
    spr.request_status = "Material Requested"
    spr.save(ignore_permissions=True)
    frappe.db.commit()

    return _envelope(
        {
            "spare_request": spr.name,
            "request_status": spr.request_status,
            "material_request": mr.name,
        }
    )


@frappe.whitelist()
def list_spare_requests(ticket_or_property: str) -> dict:
    """List Spare Part Requests filtered by ticket name or resort property.

    The argument is interpreted as a Maintenance Ticket name first; if no rows
    are found it is treated as a Resort Property filter (via the ticket link).
    """
    _require_permission(SPR, "read")

    # Try as ticket name first.
    rows = frappe.get_all(
        SPR,
        filters={"maintenance_ticket": ticket_or_property},
        fields=[
            "name",
            "maintenance_ticket",
            "request_status",
            "requested_by",
            "approved_by",
            "stock_entry",
            "material_request",
            "creation",
            "modified",
        ],
        order_by="creation desc",
    )

    if not rows:
        # Fall back: join through the Maintenance Ticket to filter by property.
        ticket_names = frappe.get_all(
            "Maintenance Ticket",
            filters={"resort_property": ticket_or_property},
            pluck="name",
        )
        if ticket_names:
            rows = frappe.get_all(
                SPR,
                filters={"maintenance_ticket": ["in", ticket_names]},
                fields=[
                    "name",
                    "maintenance_ticket",
                    "request_status",
                    "requested_by",
                    "approved_by",
                    "stock_entry",
                    "material_request",
                    "creation",
                    "modified",
                ],
                order_by="creation desc",
            )

    return _envelope({"spare_requests": rows, "count": len(rows)})
