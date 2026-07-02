"""F&B inventory operations API — spec 006 · Slice 2.

Everything a stock manager needs to run kitchen operations against the
same ERPNext Item / Warehouse / BOM / Stock Ledger surface that Finance
already uses. No parallel doctypes, no mirror tables — every read looks at
`Bin` / `Stock Ledger Entry`, every write is a submitted Stock Entry.

Endpoints (all under `the_reezort.fnb.inventory.*`):

  Reads
  · list_warehouses(company)               → outlet warehouses under F&B Store
  · stock_by_outlet(outlet)                → per-raw-item stock levels + valuation
  · low_stock_alerts(outlet, threshold?)   → raw items below par
  · item_movement(item_code, from, to)     → Stock Ledger for one raw item
  · list_ingredients(search?, group?)      → raw ingredient catalog with images
  · bom_for_menu_item(menu_item)           → drilled-down recipe with cost

  Writes (all elevated — kitchen staff don't hold Stock Entry role directly)
  · receive_stock(warehouse, items[], supplier?)  → Material Receipt (opening PO stand-in)
  · transfer_stock(from_wh, to_wh, items[])       → Material Transfer between outlets
  · wastage_entry(warehouse, items[], reason)     → Material Issue with wastage remark

Roles: reads are open to Restaurant + Resort Manager + Accounts. Writes
are Kitchen Staff (`Restaurant` role including line cooks) but the
whitelisted endpoint is the trusted boundary — inside, we elevate to
Administrator so ERPNext accepts the Stock Entry submission.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any

import frappe
from frappe import _
from frappe.utils import flt, get_datetime, now_datetime, today

from the_reezort.fnb.warehouse_seed import PER_OUTLET_WAREHOUSES, warehouse_for_outlet
from the_reezort.staff.api import _envelope

DEFAULT_LOW_STOCK_THRESHOLD = 5.0


# ---------------------------------------------------------------------------
# Permissions / elevation
# ---------------------------------------------------------------------------


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _require_inventory_role():
	"""Reads are open to anyone who touches F&B — cooks + managers + accounts."""
	_require_login()
	roles = set(frappe.get_roles(frappe.session.user))
	if not roles & {"System Manager", "Resort Manager", "Restaurant", "Accounts Manager", "Accounts User"}:
		frappe.throw(_("F&B inventory access denied."), frappe.PermissionError)


def _require_write_role():
	_require_login()
	roles = set(frappe.get_roles(frappe.session.user))
	if not roles & {"System Manager", "Resort Manager", "Restaurant"}:
		frappe.throw(_("F&B inventory writes are limited to Restaurant + Resort Manager."), frappe.PermissionError)


@contextmanager
def _as_admin():
	"""Same pattern as restaurant.py — Stock Entry submits touch GL Entry etc.
	that operational roles don't hold. Whitelisted endpoint above is the trust
	boundary; behind it, elevate."""
	original = frappe.session.user
	try:
		frappe.set_user("Administrator")
		yield
	finally:
		frappe.set_user(original)


def _company() -> str | None:
	return frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
		"Company", {}, "name"
	)


def _abbr(company: str) -> str:
	return frappe.db.get_value("Company", company, "abbr") or "TRZ"


def _resolve_warehouse(outlet_or_warehouse: str | None) -> str | None:
	"""Accept either an FnB Outlet name or a Warehouse name — outlet name gets
	resolved via warehouse_seed.warehouse_for_outlet."""
	if not outlet_or_warehouse:
		return None
	if frappe.db.exists("Warehouse", outlet_or_warehouse):
		return outlet_or_warehouse
	if frappe.db.exists("FnB Outlet", outlet_or_warehouse):
		return warehouse_for_outlet(outlet_or_warehouse)
	return None


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


@frappe.whitelist()
def list_warehouses(company: str | None = None) -> dict:
	"""Outlet warehouses under F&B Store, plus their parent and totals."""
	_require_inventory_role()
	company = company or _company()
	abbr = _abbr(company) if company else "TRZ"
	parent = frappe.db.get_value("Warehouse", f"F&B Store - {abbr}", "name")
	if not parent:
		return _envelope({"parent": None, "warehouses": []})
	rows = frappe.get_all(
		"Warehouse",
		filters={"parent_warehouse": parent, "company": company} if company else {"parent_warehouse": parent},
		fields=["name", "warehouse_name", "is_group", "disabled"],
		order_by="warehouse_name",
	)
	# Attach a raw-material item count per warehouse.
	for r in rows:
		r["item_count"] = frappe.db.count("Bin", {"warehouse": r["name"], "actual_qty": [">", 0]})
	return _envelope({"parent": parent, "warehouses": rows})


@frappe.whitelist()
def list_ingredients(search: str | None = None, item_group: str | None = None) -> dict:
	"""Raw ingredient catalog — image + valuation + UOM. Used by the receive/
	transfer/wastage sheets and the BOM viewer."""
	_require_inventory_role()
	filters: dict = {"item_code": ["like", "RAW-%"]}
	if item_group:
		filters["item_group"] = item_group
	rows = frappe.get_all(
		"Item",
		filters=filters,
		fields=[
			"name", "item_code", "item_name", "item_group",
			"stock_uom", "valuation_rate", "standard_rate", "image",
			"disabled",
		],
		order_by="item_group, item_name",
		limit_page_length=500,
	)
	if search:
		needle = search.strip().lower()
		rows = [r for r in rows if needle in (r["item_name"] or "").lower() or needle in (r["item_code"] or "").lower()]
	# Group breakdown for filter chips.
	groups = sorted({r["item_group"] for r in rows if r["item_group"]})
	return _envelope({"items": rows, "groups": groups})


@frappe.whitelist()
def stock_by_outlet(outlet: str) -> dict:
	"""Per-raw-item stock levels + valuation for one outlet's warehouse.

	Returned rows are the intersection of (raw materials) and (Bin rows on
	this warehouse) so items never received yet are omitted."""
	_require_inventory_role()
	warehouse = _resolve_warehouse(outlet)
	if not warehouse:
		frappe.throw(_("Unknown outlet or warehouse: {0}").format(outlet))
	rows = frappe.db.sql(
		"""
		SELECT
			b.item_code, i.item_name, i.image, i.stock_uom, i.item_group,
			b.actual_qty, b.projected_qty, b.reserved_qty,
			b.valuation_rate, (b.actual_qty * b.valuation_rate) AS stock_value
		FROM `tabBin` b
		INNER JOIN `tabItem` i ON i.name = b.item_code
		WHERE b.warehouse = %s
		  AND b.item_code LIKE 'RAW-%%'
		ORDER BY i.item_group, i.item_name
		""",
		(warehouse,),
		as_dict=True,
	)
	total_value = sum(flt(r.stock_value) for r in rows)
	item_count = len(rows)
	return _envelope(
		{
			"outlet": outlet,
			"warehouse": warehouse,
			"total_value": total_value,
			"item_count": item_count,
			"items": rows,
		}
	)


@frappe.whitelist()
def low_stock_alerts(outlet: str, threshold: float | None = None) -> dict:
	"""Raw items whose actual_qty is <= threshold (default 5 units — for the
	demo the UOMs are Kg/Litre/Nos which is a sensible reorder trigger)."""
	_require_inventory_role()
	warehouse = _resolve_warehouse(outlet)
	if not warehouse:
		frappe.throw(_("Unknown outlet or warehouse: {0}").format(outlet))
	threshold = flt(threshold) if threshold else DEFAULT_LOW_STOCK_THRESHOLD
	rows = frappe.db.sql(
		"""
		SELECT
			b.item_code, i.item_name, i.image, i.stock_uom,
			b.actual_qty, b.valuation_rate
		FROM `tabBin` b
		INNER JOIN `tabItem` i ON i.name = b.item_code
		WHERE b.warehouse = %s
		  AND b.item_code LIKE 'RAW-%%'
		  AND b.actual_qty <= %s
		ORDER BY b.actual_qty ASC
		""",
		(warehouse, threshold),
		as_dict=True,
	)
	return _envelope({"outlet": outlet, "warehouse": warehouse, "threshold": threshold, "items": rows})


@frappe.whitelist()
def item_movement(item_code: str, warehouse: str | None = None, from_date: str | None = None, to_date: str | None = None, limit: int = 100) -> dict:
	"""Stock Ledger movements for one raw item — powers the "why is stock
	low?" drill-down. Optional filter by warehouse and date range."""
	_require_inventory_role()
	filters: dict = {"item_code": item_code}
	if warehouse:
		wh = _resolve_warehouse(warehouse)
		if wh:
			filters["warehouse"] = wh
	if from_date:
		filters["posting_date"] = [">=", from_date]
	if to_date:
		filters.setdefault("posting_date", [">=", "1900-01-01"])
		# Widen the existing filter into a between if a to_date was given.
		if isinstance(filters["posting_date"], list) and len(filters["posting_date"]) == 2 and filters["posting_date"][0] == ">=":
			filters["posting_date"] = ["between", [filters["posting_date"][1], to_date]]

	rows = frappe.get_all(
		"Stock Ledger Entry",
		filters=filters,
		fields=[
			"name", "posting_date", "posting_time", "warehouse",
			"voucher_type", "voucher_no", "actual_qty", "qty_after_transaction",
			"valuation_rate", "stock_value", "is_cancelled",
		],
		order_by="posting_date desc, posting_time desc",
		limit_page_length=limit,
	)
	return _envelope({"item_code": item_code, "movements": rows})


@frappe.whitelist()
def bom_for_menu_item(menu_item: str) -> dict:
	"""Drilled-down recipe with images + per-ingredient cost + total cost.
	Feeds the BOM viewer sheet on the sibling's UI."""
	_require_inventory_role()
	finished = frappe.db.get_value("Menu Item", menu_item, "erpnext_item")
	if not finished:
		frappe.throw(_("Menu Item {0} has no linked ERPNext Item.").format(menu_item))
	bom_name = frappe.db.get_value(
		"BOM",
		{"item": finished, "is_active": 1, "is_default": 1, "docstatus": 1},
		"name",
	)
	if not bom_name:
		return _envelope({"menu_item": menu_item, "bom": None, "ingredients": [], "cost": 0})
	rows = frappe.db.sql(
		"""
		SELECT bi.item_code, bi.qty, bi.uom, bi.rate, (bi.qty * bi.rate) AS amount,
			i.item_name, i.image, i.item_group
		FROM `tabBOM Item` bi
		INNER JOIN `tabItem` i ON i.name = bi.item_code
		WHERE bi.parent = %s
		ORDER BY bi.idx
		""",
		(bom_name,),
		as_dict=True,
	)
	total_cost = sum(flt(r.amount) for r in rows)
	price = frappe.db.get_value("Menu Item", menu_item, "price")
	margin_pct = round(((flt(price) - total_cost) / flt(price)) * 100, 1) if price else None
	return _envelope(
		{
			"menu_item": menu_item,
			"bom": bom_name,
			"ingredients": rows,
			"cost": total_cost,
			"menu_price": flt(price),
			"margin_pct": margin_pct,
		}
	)


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


def _as_list(value: Any) -> list[dict]:
	if isinstance(value, str):
		value = json.loads(value)
	return value or []


@frappe.whitelist()
def receive_stock(warehouse: str, items: list[dict] | str, supplier: str | None = None, remarks: str | None = None) -> dict:
	"""Kitchen stock receipt — mints a Material Receipt Stock Entry.

	items: [{item_code, qty, uom?, rate?}]
	"""
	_require_write_role()
	warehouse = _resolve_warehouse(warehouse)
	if not warehouse:
		frappe.throw(_("Unknown warehouse."))
	items = _as_list(items)
	if not items:
		frappe.throw(_("At least one item required."))

	with _as_admin():
		se_items = []
		for row in items:
			item_code = row.get("item_code")
			if not item_code or not frappe.db.exists("Item", item_code):
				frappe.throw(_("Unknown item: {0}").format(item_code))
			qty = flt(row.get("qty"))
			if qty <= 0:
				frappe.throw(_("Quantity for {0} must be > 0").format(item_code))
			rate = flt(row.get("rate") or frappe.db.get_value("Item", item_code, "valuation_rate") or 0)
			uom = row.get("uom") or frappe.db.get_value("Item", item_code, "stock_uom")
			se_items.append(
				{
					"t_warehouse": warehouse,
					"item_code": item_code,
					"qty": qty,
					"uom": uom,
					"basic_rate": rate,
				}
			)
		se = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Material Receipt",
				"purpose": "Material Receipt",
				"posting_date": today(),
				"posting_time": now_datetime().strftime("%H:%M:%S"),
				"remarks": remarks or (f"Kitchen receipt from {supplier}" if supplier else "Kitchen receipt"),
				"items": se_items,
			}
		)
		se.flags.ignore_permissions = True
		se.insert()
		se.submit()
	return _envelope({"stock_entry": se.name, "warehouse": warehouse, "items": len(se_items)})


@frappe.whitelist()
def transfer_stock(from_warehouse: str, to_warehouse: str, items: list[dict] | str, remarks: str | None = None) -> dict:
	"""Cross-outlet raw-material transfer — Material Transfer Stock Entry."""
	_require_write_role()
	src = _resolve_warehouse(from_warehouse)
	dst = _resolve_warehouse(to_warehouse)
	if not src or not dst:
		frappe.throw(_("Both warehouses must resolve."))
	if src == dst:
		frappe.throw(_("Source and destination warehouses must differ."))
	items = _as_list(items)
	if not items:
		frappe.throw(_("At least one item required."))

	with _as_admin():
		se_items = []
		for row in items:
			item_code = row.get("item_code")
			if not item_code or not frappe.db.exists("Item", item_code):
				frappe.throw(_("Unknown item: {0}").format(item_code))
			qty = flt(row.get("qty"))
			if qty <= 0:
				frappe.throw(_("Quantity for {0} must be > 0").format(item_code))
			uom = row.get("uom") or frappe.db.get_value("Item", item_code, "stock_uom")
			se_items.append(
				{
					"s_warehouse": src,
					"t_warehouse": dst,
					"item_code": item_code,
					"qty": qty,
					"uom": uom,
				}
			)
		se = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Material Transfer",
				"purpose": "Material Transfer",
				"posting_date": today(),
				"posting_time": now_datetime().strftime("%H:%M:%S"),
				"remarks": remarks or f"F&B transfer {src} → {dst}",
				"items": se_items,
			}
		)
		se.flags.ignore_permissions = True
		se.insert()
		se.submit()
	return _envelope({"stock_entry": se.name, "from_warehouse": src, "to_warehouse": dst, "items": len(se_items)})


@frappe.whitelist()
def wastage_entry(warehouse: str, items: list[dict] | str, reason: str) -> dict:
	"""Log a wastage — Material Issue with the reason on the remarks."""
	_require_write_role()
	if not reason or not str(reason).strip():
		frappe.throw(_("A wastage reason is required."))
	warehouse = _resolve_warehouse(warehouse)
	if not warehouse:
		frappe.throw(_("Unknown warehouse."))
	items = _as_list(items)
	if not items:
		frappe.throw(_("At least one item required."))

	with _as_admin():
		se_items = []
		for row in items:
			item_code = row.get("item_code")
			if not item_code or not frappe.db.exists("Item", item_code):
				frappe.throw(_("Unknown item: {0}").format(item_code))
			qty = flt(row.get("qty"))
			if qty <= 0:
				frappe.throw(_("Quantity for {0} must be > 0").format(item_code))
			uom = row.get("uom") or frappe.db.get_value("Item", item_code, "stock_uom")
			se_items.append(
				{
					"s_warehouse": warehouse,
					"item_code": item_code,
					"qty": qty,
					"uom": uom,
				}
			)
		se = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Material Issue",
				"purpose": "Material Issue",
				"posting_date": today(),
				"posting_time": now_datetime().strftime("%H:%M:%S"),
				"remarks": f"F&B wastage — {reason}",
				"items": se_items,
			}
		)
		se.flags.ignore_permissions = True
		se.insert()
		se.submit()
	return _envelope({"stock_entry": se.name, "warehouse": warehouse, "reason": reason, "items": len(se_items)})
