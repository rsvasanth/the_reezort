"""Raw-material consumption on F&B order settle — spec 006 · Slice 2.

Every time an F&B order transitions to Settled (walk-in) or Posted
(room-charge), the raw ingredients used are consumed from the outlet's
warehouse via an ERPNext Stock Entry of type 'Material Issue'.

For each order item with a submitted default BOM:
  · scale the BOM to the ordered quantity
  · emit stock_entry_detail rows for the source warehouse

If a Menu Item has no BOM (e.g. Slice-1 items we haven't modeled yet),
the item is skipped silently — the invoice still posts. `dropped_items`
in the return dict tells callers which items were not consumed so the
Restaurant Order audit trail records the gap.

This module runs elevated (see `_as_admin` at call site) so operational
roles can settle orders without holding Stock Entry / GL Entry rights.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt, now_datetime, today


def _bom_for(finished_item: str) -> str | None:
	return frappe.db.get_value(
		"BOM",
		{"item": finished_item, "is_active": 1, "is_default": 1, "docstatus": 1},
		"name",
	)


def _bom_lines(bom_name: str) -> list[dict]:
	return frappe.get_all(
		"BOM Item",
		filters={"parent": bom_name},
		fields=["item_code", "qty", "uom", "rate", "stock_uom"],
	)


def _resolve_finished_item(menu_item_name: str) -> str | None:
	"""Menu Item → ERPNext Item that carries the BOM."""
	return frappe.db.get_value("Menu Item", menu_item_name, "erpnext_item")


def consume_for_order(
	warehouse: str,
	order_items: list[dict],
	remarks: str | None = None,
	company: str | None = None,
) -> dict:
	"""Emit a submitted Stock Entry for the raw materials consumed by the
	given order items. Returns the SE name + per-menu-item consumption
	summary.

	`order_items`: list of {menu_item, quantity, item_name}
	"""
	company = company or frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
		"Company", {}, "name"
	)
	if not company:
		return {"stock_entry": None, "dropped_items": [i.get("menu_item") for i in order_items]}
	if not warehouse:
		return {"stock_entry": None, "dropped_items": [i.get("menu_item") for i in order_items]}

	entries: list[dict] = []
	dropped: list[str] = []
	consumed_by_menu: dict[str, list[dict]] = {}

	for row in order_items:
		menu_item = row.get("menu_item")
		qty = flt(row.get("quantity") or row.get("qty") or 1)
		finished = _resolve_finished_item(menu_item)
		bom = _bom_for(finished) if finished else None
		if not bom:
			dropped.append(menu_item)
			continue

		lines = _bom_lines(bom)
		if not lines:
			dropped.append(menu_item)
			continue

		summary: list[dict] = []
		for line in lines:
			consumption_qty = flt(line.qty) * qty
			entries.append(
				{
					"s_warehouse": warehouse,
					"item_code": line.item_code,
					"qty": consumption_qty,
					"uom": line.uom or line.stock_uom,
					"basic_rate": flt(line.rate),
				}
			)
			summary.append(
				{
					"raw_item": line.item_code,
					"qty": consumption_qty,
					"uom": line.uom or line.stock_uom,
				}
			)
		consumed_by_menu[menu_item] = summary

	if not entries:
		return {"stock_entry": None, "dropped_items": dropped, "consumed_by_menu": consumed_by_menu}

	# Merge duplicate (item_code, s_warehouse) rows so ERPNext doesn't reject
	# the SE for "duplicate row" complaints — different order items sharing
	# the same raw ingredient collapse into a single consumed row.
	merged: dict[tuple[str, str], dict] = {}
	for e in entries:
		key = (e["item_code"], e["s_warehouse"])
		if key in merged:
			merged[key]["qty"] = flt(merged[key]["qty"]) + flt(e["qty"])
		else:
			merged[key] = e
	entries = list(merged.values())

	se = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"company": company,
			"stock_entry_type": "Material Issue",
			"posting_date": today(),
			"posting_time": now_datetime().strftime("%H:%M:%S"),
			"purpose": "Material Issue",
			"remarks": remarks or _("F&B order consumption"),
			"items": entries,
		}
	)
	se.flags.ignore_permissions = True
	try:
		se.insert()
		se.submit()
	except Exception as exc:
		# Roll back silently for the caller — a stock shortage shouldn't block
		# invoice submission. Return a note that consumption failed so the
		# order carries a flag for kitchen ops to reconcile manually.
		frappe.log_error(f"F&B consumption failed: {exc}", "F&B consumption")
		return {
			"stock_entry": None,
			"error": str(exc),
			"dropped_items": [i.get("menu_item") for i in order_items],
			"consumed_by_menu": consumed_by_menu,
		}

	return {
		"stock_entry": se.name,
		"dropped_items": dropped,
		"consumed_by_menu": consumed_by_menu,
	}
