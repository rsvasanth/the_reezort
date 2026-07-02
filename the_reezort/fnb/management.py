"""F&B management surface — spec 006 · Slice 5.

Six operator concerns collapsed into one Python module — every read runs
against Restaurant Order / Sales Invoice / Stock Entry / Audit Event, no
parallel storage. Every write is a whitelisted endpoint that role-gates
at the entry.

Modules:
  · Sales analytics       — get_sales_summary, get_daily_sales, top_dishes, sales_by_waiter
  · Sales calendar        — get_sales_calendar (per-day rollup for a month)
  · Waste report          — get_waste_report (bucket wastage Stock Entries)
  · Dish performance      — get_dish_performance (velocity + revenue + margin + trend)
  · Waiter assignment     — assign_waiter, list_waiter_assignments, unassign_waiter
  · Restaurant audit trail — list_order_audit_trail (per Restaurant Order)

All numbers come from real data — Restaurant Order.grand_total,
Restaurant Order Item.amount, Stock Entry line amounts (for waste), and
join Menu Item.erpnext_item → BOM → BOM Item.rate for cost/margin. No
mocks, no snapshot doctypes for this slice — cheap enough at the current
demo scale that on-the-fly SQL is fine.
"""

from __future__ import annotations

import json
from calendar import monthrange
from datetime import date

import frappe
from frappe import _
from frappe.utils import add_days, add_to_date, flt, get_datetime, getdate, now_datetime, today

from the_reezort.audit.api import record_audit_event
from the_reezort.staff.api import _envelope


# ---------- permission gates ----------


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _require_analytics():
	_require_login()
	roles = set(frappe.get_roles(frappe.session.user))
	if not roles & {"System Manager", "Resort Manager", "Restaurant", "Accounts Manager", "Accounts User"}:
		frappe.throw(_("F&B analytics access denied."), frappe.PermissionError)


def _require_management():
	_require_login()
	roles = set(frappe.get_roles(frappe.session.user))
	if not roles & {"System Manager", "Resort Manager", "Restaurant"}:
		frappe.throw(_("Only Restaurant + Resort Manager can manage F&B operations."), frappe.PermissionError)


# ---------- range helpers ----------


def _resolve_range(from_date: str | None, to_date: str | None) -> tuple[str, str]:
	"""Default window = last 30 days ending yesterday, same as analytics."""
	end = getdate(to_date) if to_date else add_days(getdate(today()), -1)
	start = getdate(from_date) if from_date else add_days(end, -29)
	return str(start), str(end)


def _outlet_clause(outlet: str | None) -> tuple[str, list]:
	if outlet:
		return " AND ro.outlet = %s", [outlet]
	return "", []


# ---------- sales ----------


@frappe.whitelist()
def get_sales_summary(from_date: str | None = None, to_date: str | None = None, outlet: str | None = None) -> dict:
	"""Headline KPIs for the given window: orders, revenue, avg check size,
	Δ vs same-length prior period. Only Settled orders count toward revenue.

	Cancelled + Draft are counted separately for the ops screen (cancel rate).
	"""
	_require_analytics()
	start, end = _resolve_range(from_date, to_date)

	def _rollup(start_str: str, end_str: str) -> dict:
		outlet_clause, outlet_args = _outlet_clause(outlet)
		row = frappe.db.sql(
			f"""
			SELECT
				COUNT(*) AS total_orders,
				SUM(CASE WHEN ro.state = 'Settled' THEN 1 ELSE 0 END) AS settled_orders,
				SUM(CASE WHEN ro.state = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled_orders,
				SUM(CASE WHEN ro.state = 'Settled' THEN ro.grand_total ELSE 0 END) AS revenue,
				AVG(CASE WHEN ro.state = 'Settled' THEN ro.grand_total ELSE NULL END) AS avg_check
			FROM `tabRestaurant Order` ro
			WHERE DATE(ro.opened_at) BETWEEN %s AND %s
			{outlet_clause}
			""",
			[start_str, end_str, *outlet_args],
			as_dict=True,
		)
		return row[0] if row else {}

	current = _rollup(start, end)
	length = (getdate(end) - getdate(start)).days + 1
	prev_end = add_days(getdate(start), -1)
	prev_start = add_days(prev_end, -(length - 1))
	previous = _rollup(str(prev_start), str(prev_end))

	def _delta_pct(now, before):
		before = flt(before)
		if not before:
			return None
		return round(((flt(now) - before) / before) * 100, 1)

	return _envelope(
		{
			"from_date": start,
			"to_date": end,
			"outlet": outlet,
			"total_orders": int(current.get("total_orders") or 0),
			"settled_orders": int(current.get("settled_orders") or 0),
			"cancelled_orders": int(current.get("cancelled_orders") or 0),
			"revenue": flt(current.get("revenue")),
			"avg_check": flt(current.get("avg_check")),
			"cancel_rate_pct": round(
				(int(current.get("cancelled_orders") or 0) / int(current.get("total_orders") or 1)) * 100, 1
			)
			if current.get("total_orders")
			else 0,
			"deltas": {
				"orders_pct": _delta_pct(current.get("settled_orders"), previous.get("settled_orders")),
				"revenue_pct": _delta_pct(current.get("revenue"), previous.get("revenue")),
				"avg_check_pct": _delta_pct(current.get("avg_check"), previous.get("avg_check")),
			},
		}
	)


@frappe.whitelist()
def get_daily_sales(from_date: str | None = None, to_date: str | None = None, outlet: str | None = None) -> dict:
	"""Day-by-day settled orders + revenue for the range. Zero-fills missing
	days so charts don't collapse."""
	_require_analytics()
	start, end = _resolve_range(from_date, to_date)
	outlet_clause, outlet_args = _outlet_clause(outlet)
	rows = frappe.db.sql(
		f"""
		SELECT DATE(ro.opened_at) AS day,
			COUNT(*) AS orders,
			SUM(ro.grand_total) AS revenue,
			AVG(ro.grand_total) AS avg_check
		FROM `tabRestaurant Order` ro
		WHERE ro.state = 'Settled'
		  AND DATE(ro.opened_at) BETWEEN %s AND %s
		{outlet_clause}
		GROUP BY DATE(ro.opened_at)
		""",
		[start, end, *outlet_args],
		as_dict=True,
	)
	by_day = {str(r.day): r for r in rows}
	series = []
	d = getdate(start)
	end_d = getdate(end)
	while d <= end_d:
		key = str(d)
		if key in by_day:
			series.append(
				{
					"date": key,
					"orders": int(by_day[key].orders or 0),
					"revenue": flt(by_day[key].revenue),
					"avg_check": flt(by_day[key].avg_check),
					"present": True,
				}
			)
		else:
			series.append({"date": key, "orders": 0, "revenue": 0.0, "avg_check": 0.0, "present": False})
		d = add_days(d, 1)
	return _envelope({"from_date": start, "to_date": end, "outlet": outlet, "series": series})


@frappe.whitelist()
def top_dishes(from_date: str | None = None, to_date: str | None = None, outlet: str | None = None, limit: int = 20) -> dict:
	"""Best-selling menu items — qty sold + revenue for the window."""
	_require_analytics()
	start, end = _resolve_range(from_date, to_date)
	outlet_clause, outlet_args = _outlet_clause(outlet)
	rows = frappe.db.sql(
		f"""
		SELECT
			roi.menu_item, roi.item_name,
			mi.image, mi.category, mi.price,
			SUM(roi.quantity) AS qty_sold,
			SUM(roi.amount) AS revenue
		FROM `tabRestaurant Order Item` roi
		INNER JOIN `tabRestaurant Order` ro ON ro.name = roi.parent
		LEFT JOIN `tabMenu Item` mi ON mi.name = roi.menu_item
		WHERE ro.state = 'Settled'
		  AND DATE(ro.opened_at) BETWEEN %s AND %s
		{outlet_clause}
		GROUP BY roi.menu_item, roi.item_name, mi.image, mi.category, mi.price
		ORDER BY qty_sold DESC
		LIMIT %s
		""",
		[start, end, *outlet_args, int(limit)],
		as_dict=True,
	)
	return _envelope({"from_date": start, "to_date": end, "outlet": outlet, "dishes": rows})


@frappe.whitelist()
def sales_by_waiter(from_date: str | None = None, to_date: str | None = None, outlet: str | None = None) -> dict:
	"""Per-waiter revenue + orders + cover count. Groups by
	Restaurant Order.waiter_user and joins User.full_name."""
	_require_analytics()
	start, end = _resolve_range(from_date, to_date)
	outlet_clause, outlet_args = _outlet_clause(outlet)
	rows = frappe.db.sql(
		f"""
		SELECT
			ro.waiter_user AS user, u.full_name AS waiter_name,
			COUNT(*) AS orders, SUM(ro.grand_total) AS revenue,
			SUM(ro.party_size) AS covers,
			AVG(ro.grand_total) AS avg_check
		FROM `tabRestaurant Order` ro
		LEFT JOIN `tabUser` u ON u.name = ro.waiter_user
		WHERE ro.state = 'Settled'
		  AND ro.waiter_user IS NOT NULL
		  AND DATE(ro.opened_at) BETWEEN %s AND %s
		{outlet_clause}
		GROUP BY ro.waiter_user, u.full_name
		ORDER BY revenue DESC
		""",
		[start, end, *outlet_args],
		as_dict=True,
	)
	return _envelope({"from_date": start, "to_date": end, "outlet": outlet, "waiters": rows})


# ---------- sales calendar ----------


@frappe.whitelist()
def get_sales_calendar(year: int, month: int, outlet: str | None = None) -> dict:
	"""Per-day rollup for a whole month — orders, revenue, top dish, waste value.
	Backs a month-grid calendar view. Days with no data return zeros."""
	_require_analytics()
	year, month = int(year), int(month)
	if not (1 <= month <= 12):
		frappe.throw(_("Invalid month."))
	first = date(year, month, 1)
	last = date(year, month, monthrange(year, month)[1])
	outlet_clause, outlet_args = _outlet_clause(outlet)
	# Per-day totals.
	day_rows = frappe.db.sql(
		f"""
		SELECT DATE(ro.opened_at) AS day,
			COUNT(*) AS orders, SUM(ro.grand_total) AS revenue
		FROM `tabRestaurant Order` ro
		WHERE ro.state = 'Settled'
		  AND DATE(ro.opened_at) BETWEEN %s AND %s
		{outlet_clause}
		GROUP BY DATE(ro.opened_at)
		""",
		[str(first), str(last), *outlet_args],
		as_dict=True,
	)
	by_day = {str(r.day): r for r in day_rows}
	# Top dish per day.
	top_rows = frappe.db.sql(
		f"""
		SELECT DATE(ro.opened_at) AS day,
			roi.menu_item, roi.item_name,
			SUM(roi.quantity) AS qty
		FROM `tabRestaurant Order Item` roi
		INNER JOIN `tabRestaurant Order` ro ON ro.name = roi.parent
		WHERE ro.state = 'Settled'
		  AND DATE(ro.opened_at) BETWEEN %s AND %s
		{outlet_clause}
		GROUP BY DATE(ro.opened_at), roi.menu_item, roi.item_name
		""",
		[str(first), str(last), *outlet_args],
		as_dict=True,
	)
	top_by_day: dict[str, dict] = {}
	for r in top_rows:
		key = str(r.day)
		if key not in top_by_day or (r.qty or 0) > (top_by_day[key]["qty"] or 0):
			top_by_day[key] = {"menu_item": r.menu_item, "item_name": r.item_name, "qty": int(r.qty or 0)}

	# Waste value per day (F&B wastage — Stock Entries flagged via remarks).
	waste_rows = frappe.db.sql(
		"""
		SELECT DATE(se.posting_date) AS day, SUM(sed.amount) AS waste_value
		FROM `tabStock Entry` se
		INNER JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
		WHERE se.stock_entry_type = 'Material Issue'
		  AND se.remarks LIKE 'F&B wastage%%'
		  AND se.docstatus = 1
		  AND DATE(se.posting_date) BETWEEN %s AND %s
		GROUP BY DATE(se.posting_date)
		""",
		(str(first), str(last)),
		as_dict=True,
	)
	waste_by_day = {str(r.day): flt(r.waste_value) for r in waste_rows}

	# Assemble day list.
	days = []
	current = first
	while current <= last:
		key = str(current)
		orders = int(by_day.get(key, {}).get("orders") or 0) if by_day.get(key) else 0
		revenue = flt(by_day.get(key, {}).get("revenue")) if by_day.get(key) else 0
		days.append(
			{
				"date": key,
				"day_of_week": current.isoweekday(),
				"orders": orders,
				"revenue": revenue,
				"top_dish": top_by_day.get(key),
				"waste_value": waste_by_day.get(key, 0),
			}
		)
		current = add_days(current, 1)
	total_revenue = sum(d["revenue"] for d in days)
	total_orders = sum(d["orders"] for d in days)
	total_waste = sum(d["waste_value"] for d in days)
	return _envelope(
		{
			"year": year,
			"month": month,
			"outlet": outlet,
			"days": days,
			"totals": {"revenue": total_revenue, "orders": total_orders, "waste_value": total_waste},
		}
	)


# ---------- waste report ----------


@frappe.whitelist()
def get_waste_report(from_date: str | None = None, to_date: str | None = None, warehouse: str | None = None) -> dict:
	"""Wastage entries + rollups by item + reason bucket.

	Detects wastage by Stock Entry.remarks starting with 'F&B wastage —' —
	the marker set by inventory.wastage_entry."""
	_require_analytics()
	start, end = _resolve_range(from_date, to_date)
	wh_clause = ""
	wh_args: list = []
	if warehouse:
		from the_reezort.fnb.inventory import _resolve_warehouse

		resolved = _resolve_warehouse(warehouse)
		if resolved:
			wh_clause = " AND sed.s_warehouse = %s"
			wh_args = [resolved]

	# Detail rows: one per wasted item.
	rows = frappe.db.sql(
		f"""
		SELECT
			se.name AS stock_entry, se.posting_date, se.posting_time, se.remarks,
			sed.item_code, i.item_name, i.image, i.item_group,
			sed.qty, sed.uom, sed.basic_rate, sed.amount, sed.s_warehouse
		FROM `tabStock Entry` se
		INNER JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
		INNER JOIN `tabItem` i ON i.name = sed.item_code
		WHERE se.stock_entry_type = 'Material Issue'
		  AND se.docstatus = 1
		  AND se.remarks LIKE 'F&B wastage%%'
		  AND DATE(se.posting_date) BETWEEN %s AND %s
		{wh_clause}
		ORDER BY se.posting_date DESC, se.posting_time DESC
		""",
		[start, end, *wh_args],
		as_dict=True,
	)
	# Parse reason from remarks — format: "F&B wastage — <reason>"
	for r in rows:
		r["reason"] = (r["remarks"] or "").split(" — ", 1)[1] if " — " in (r["remarks"] or "") else ""

	# Rollup by item.
	by_item: dict[str, dict] = {}
	for r in rows:
		key = r["item_code"]
		if key not in by_item:
			by_item[key] = {
				"item_code": key,
				"item_name": r["item_name"],
				"image": r["image"],
				"item_group": r["item_group"],
				"total_qty": 0.0,
				"total_value": 0.0,
				"entries": 0,
			}
		by_item[key]["total_qty"] += flt(r["qty"])
		by_item[key]["total_value"] += flt(r["amount"])
		by_item[key]["entries"] += 1
	# Sort items by value desc.
	items_ranked = sorted(by_item.values(), key=lambda x: -x["total_value"])

	total_value = sum(r["total_value"] for r in items_ranked)
	total_entries = len(rows)
	return _envelope(
		{
			"from_date": start,
			"to_date": end,
			"warehouse": warehouse,
			"total_value": total_value,
			"total_entries": total_entries,
			"unique_items": len(items_ranked),
			"entries": rows,
			"by_item": items_ranked,
		}
	)


# ---------- dish performance ----------


def _bom_cost(menu_item: str) -> float:
	"""Sum of BOM Item.amount for the default active BOM of the menu item's
	linked ERPNext Item. Cached lookups would be nice; per-call is fine at
	demo scale."""
	erp_item = frappe.db.get_value("Menu Item", menu_item, "erpnext_item")
	if not erp_item:
		return 0.0
	bom = frappe.db.get_value(
		"BOM", {"item": erp_item, "is_active": 1, "is_default": 1, "docstatus": 1}, "name"
	)
	if not bom:
		return 0.0
	row = frappe.db.sql(
		"SELECT COALESCE(SUM(qty * rate), 0) FROM `tabBOM Item` WHERE parent = %s",
		(bom,),
	)
	return flt(row[0][0] if row else 0)


@frappe.whitelist()
def get_dish_performance(from_date: str | None = None, to_date: str | None = None, outlet: str | None = None) -> dict:
	"""Per-menu-item velocity + revenue + cost + margin + trend arrow.

	Trend = qty sold in the current window vs the same-length prior window;
	arrow is 'up' / 'flat' / 'down' (thresholds 10% and -10% delta).
	"""
	_require_analytics()
	start, end = _resolve_range(from_date, to_date)
	length = (getdate(end) - getdate(start)).days + 1
	prev_end = add_days(getdate(start), -1)
	prev_start = add_days(prev_end, -(length - 1))
	outlet_clause, outlet_args = _outlet_clause(outlet)

	def _rollup(a: str, b: str) -> dict[str, dict]:
		rows = frappe.db.sql(
			f"""
			SELECT roi.menu_item, roi.item_name,
				mi.image, mi.category, mi.price,
				SUM(roi.quantity) AS qty, SUM(roi.amount) AS revenue
			FROM `tabRestaurant Order Item` roi
			INNER JOIN `tabRestaurant Order` ro ON ro.name = roi.parent
			LEFT JOIN `tabMenu Item` mi ON mi.name = roi.menu_item
			WHERE ro.state = 'Settled'
			  AND DATE(ro.opened_at) BETWEEN %s AND %s
			{outlet_clause}
			GROUP BY roi.menu_item
			""",
			[a, b, *outlet_args],
			as_dict=True,
		)
		return {r.menu_item: r for r in rows}

	current = _rollup(start, end)
	previous = _rollup(str(prev_start), str(prev_end))
	dishes = []
	for menu_item, row in current.items():
		unit_cost = _bom_cost(menu_item)
		unit_price = flt(row.price)
		unit_margin_pct = round(((unit_price - unit_cost) / unit_price) * 100, 1) if unit_price else None
		total_cost = unit_cost * flt(row.qty)
		gross_margin = flt(row.revenue) - total_cost
		gross_margin_pct = round((gross_margin / flt(row.revenue)) * 100, 1) if row.revenue else 0
		prev_qty = flt(previous.get(menu_item, {}).get("qty") or 0)
		delta_qty = flt(row.qty) - prev_qty
		delta_pct = round((delta_qty / prev_qty) * 100, 1) if prev_qty else None
		if delta_pct is None:
			trend = "new"
		elif delta_pct >= 10:
			trend = "up"
		elif delta_pct <= -10:
			trend = "down"
		else:
			trend = "flat"
		dishes.append(
			{
				"menu_item": menu_item,
				"item_name": row.item_name,
				"image": row.image,
				"category": row.category,
				"unit_price": unit_price,
				"unit_cost": unit_cost,
				"unit_margin_pct": unit_margin_pct,
				"qty_sold": flt(row.qty),
				"revenue": flt(row.revenue),
				"total_cost": total_cost,
				"gross_margin": gross_margin,
				"gross_margin_pct": gross_margin_pct,
				"prev_qty_sold": prev_qty,
				"delta_qty": delta_qty,
				"delta_pct": delta_pct,
				"trend": trend,
			}
		)
	dishes.sort(key=lambda d: -d["revenue"])

	# Slow-mover list: dishes with any BOM but NOT sold in the window.
	sold_menu_names = set(current.keys())
	all_menu = frappe.get_all(
		"Menu Item",
		filters={"is_available": 1} | ({"outlet": frappe.db.get_value("FnB Outlet", outlet, "name")} if outlet else {}),
		fields=["name", "item_name", "image", "category", "price"],
	) if outlet else frappe.get_all(
		"Menu Item",
		filters={"is_available": 1},
		fields=["name", "item_name", "image", "category", "price"],
	)
	slow_movers = [
		{
			"menu_item": m["name"],
			"item_name": m["item_name"],
			"image": m["image"],
			"category": m["category"],
			"unit_price": flt(m["price"]),
		}
		for m in all_menu
		if m["name"] not in sold_menu_names
	]

	return _envelope(
		{
			"from_date": start,
			"to_date": end,
			"outlet": outlet,
			"dishes": dishes,
			"slow_movers": slow_movers,
		}
	)


# ---------- waiter assignment ----------


@frappe.whitelist()
def assign_waiter(
	restaurant_table: str,
	waiter_user: str,
	shift_start: str,
	shift_end: str,
	outlet: str | None = None,
	resort_property: str | None = None,
	notes: str | None = None,
) -> dict:
	"""Assign a waiter to a table for a shift window.

	Refuses overlapping active shifts on the same table (validated in the
	doctype's Python controller). Auto-derives waiter_employee via the User
	link if the user has an Employee row.
	"""
	_require_management()
	# Resolve outlet + property from the table if not supplied.
	if not outlet or not resort_property:
		table_row = frappe.db.get_value(
			"Restaurant Table",
			restaurant_table,
			["outlet", "resort_property"],
			as_dict=True,
		)
		if not table_row:
			frappe.throw(_("Unknown table: {0}").format(restaurant_table))
		outlet = outlet or table_row.outlet
		resort_property = resort_property or table_row.resort_property

	doc = frappe.get_doc(
		{
			"doctype": "Waiter Assignment",
			"resort_property": resort_property,
			"outlet": outlet,
			"restaurant_table": restaurant_table,
			"waiter_user": waiter_user,
			"shift_start": shift_start,
			"shift_end": shift_end,
			"status": "Active",
			"notes": notes,
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert()
	record_audit_event(
		"Waiter Assignment",
		doc.name,
		"restaurant.assign_waiter",
		details={
			"table": restaurant_table,
			"waiter": waiter_user,
			"shift_start": str(shift_start),
			"shift_end": str(shift_end),
		},
	)
	return _envelope({"assignment": doc.name, "waiter_employee": doc.waiter_employee})


@frappe.whitelist()
def list_waiter_assignments(outlet: str | None = None, on_date: str | None = None, status: str = "Active") -> dict:
	"""List active shifts for an outlet on a given day (default today).

	Rows include waiter full name + table name + shift window + running
	order count so the shift-board can render at a glance.
	"""
	_require_analytics()
	on = getdate(on_date) if on_date else getdate(today())
	# Assignments that cover `on` at all — shift_start <= end-of-day AND shift_end >= start-of-day
	day_start = get_datetime(f"{on} 00:00:00")
	day_end = get_datetime(f"{on} 23:59:59")
	filters: dict = {
		"shift_start": ["<=", day_end],
		"shift_end": [">=", day_start],
	}
	if status:
		filters["status"] = status
	if outlet:
		filters["outlet"] = outlet
	names = frappe.get_all(
		"Waiter Assignment",
		filters=filters,
		pluck="name",
		order_by="shift_start ASC",
	)
	rows = []
	for name in names:
		wa = frappe.get_doc("Waiter Assignment", name)
		waiter_full_name = frappe.db.get_value("User", wa.waiter_user, "full_name") if wa.waiter_user else None
		table_row = frappe.db.get_value(
			"Restaurant Table", wa.restaurant_table, ["table_code", "table_name", "zone", "seats"], as_dict=True
		) or {}
		# Live order count under this waiter/table today.
		order_count = frappe.db.count(
			"Restaurant Order",
			{
				"restaurant_table": wa.restaurant_table,
				"waiter_user": wa.waiter_user,
				"opened_at": ["between", [day_start, day_end]],
			},
		)
		rows.append(
			{
				"assignment": wa.name,
				"outlet": wa.outlet,
				"table": wa.restaurant_table,
				"table_code": table_row.get("table_code"),
				"table_name": table_row.get("table_name"),
				"table_zone": table_row.get("zone"),
				"table_seats": table_row.get("seats"),
				"waiter_user": wa.waiter_user,
				"waiter_name": waiter_full_name,
				"waiter_employee": wa.waiter_employee,
				"shift_start": str(wa.shift_start),
				"shift_end": str(wa.shift_end),
				"status": wa.status,
				"notes": wa.notes,
				"orders_today": order_count,
			}
		)
	return _envelope({"outlet": outlet, "date": str(on), "assignments": rows})


@frappe.whitelist()
def unassign_waiter(assignment: str, reason: str | None = None) -> dict:
	"""End an active shift early. Sets status → Cancelled and stamps shift_end
	to now if the current shift_end is in the future."""
	_require_management()
	doc = frappe.get_doc("Waiter Assignment", assignment)
	if doc.status != "Active":
		frappe.throw(_("Shift is already {0}.").format(doc.status))
	doc.status = "Cancelled"
	if reason:
		doc.notes = (doc.notes or "") + f"\n[Cancelled] {reason}"
	# If the current shift_end is in the future, wind it back to now — makes
	# reporting honest about the actual worked window. But only if now is still
	# after shift_start; if the shift hasn't actually started yet, leave the
	# original window intact (the shift is simply pre-cancelled).
	now = now_datetime()
	if get_datetime(doc.shift_end) > now and now > get_datetime(doc.shift_start):
		doc.shift_end = now
	doc.flags.ignore_permissions = True
	doc.save()
	record_audit_event(
		"Waiter Assignment",
		doc.name,
		"restaurant.unassign_waiter",
		reason=reason or "",
	)
	return _envelope({"assignment": doc.name, "status": doc.status})


# ---------- Restaurant audit trail ----------


@frappe.whitelist()
def list_order_audit_trail(order: str) -> dict:
	"""Every Audit Event captured for a Restaurant Order — the audit trail
	for the POS shift-close review + the manager's dispute investigation."""
	_require_analytics()
	rows = frappe.get_all(
		"Audit Event",
		filters={"source_doctype": "Restaurant Order", "source_name": order},
		fields=["name", "at", "actor", "action", "reason", "details"],
		order_by="at ASC",
		limit_page_length=500,
	)
	for r in rows:
		try:
			r["details_parsed"] = frappe.parse_json(r.get("details") or "{}")
		except Exception:
			r["details_parsed"] = {}
		r["actor_name"] = frappe.db.get_value("User", r["actor"], "full_name") if r["actor"] else None
	return _envelope({"order": order, "events": rows})
