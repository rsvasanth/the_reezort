"""Restaurant POS + KOT + Table workspace — spec 006 · Slice 4.

Walk-in flow (POS tablet):
  1. list_tables(outlet)            → floor plan with live status per table
  2. open_walk_in_order(outlet,     → creates Draft Restaurant Order + kot_number pending
     table)
  3. add_items(order, items)        → mutates draft, recomputes totals
  4. send_to_kitchen(order)         → transitions Draft → Sent to Kitchen,
                                       assigns kot_number, snapshots kitchen_section,
                                       notifies Restaurant/Kitchen roles
  5. list_active_kots(outlet)       → for the KOT screen
  6. mark_kot_status(order, status) → Preparing / Ready / Served state transitions
  7. close_walk_in(order, payments) → creates Sales Invoice + Payment Entry via
                                       the existing billing.settlement path,
                                       transitions to Settled

State machine:
  Draft → Sent to Kitchen → Preparing → Ready → Served → Bill Pending → Settled
     └───────────────────────────────────────────────────────────────→ Cancelled

Idempotency:
  - open_walk_in_order is idempotent per (outlet, table, waiter, opened_at)
  - close_walk_in short-circuits if erpnext_sales_invoice is already set

Approval gates:
  - restaurant_backdate     — order opened > 24h in past
  - restaurant_void_amount  — cancelling an order > threshold (Slice 5)
"""

from __future__ import annotations

import hashlib
import json
from contextlib import contextmanager

import frappe
from frappe import _
from frappe.utils import flt, get_datetime, now_datetime, today

from the_reezort.audit.api import record_audit_event
from the_reezort.staff.api import _envelope
from the_reezort.utils import require_permission as _require_permission

BACKDATE_HOURS = 24


@contextmanager
def _as_admin():
	"""Run an ERPNext posting block as Administrator.

	The whitelisted Restaurant endpoints ARE the trusted service boundary — role
	permissions are enforced at the entry (Restaurant / Resort Manager can call
	close_walk_in). Behind that boundary, submitting a Sales Invoice + Payment
	Entry touches Item / Item Price / GL Entry etc. that operational roles have
	no direct rights on. Elevating the block inside the service method is the
	standard Frappe pattern for this. Restored on any path (exception or clean).
	"""
	original = frappe.session.user
	try:
		frappe.set_user("Administrator")
		yield
	finally:
		frappe.set_user(original)


# State machine — allowed forward transitions.
# Served → Cancelled is a real path: comp'd meal, walkout, dispute at the
# table where the manager voids the whole order without ever settling.
STATE_TRANSITIONS = {
	"Draft": {"Sent to Kitchen", "Cancelled"},
	"Sent to Kitchen": {"Preparing", "Cancelled"},
	"Preparing": {"Ready", "Cancelled"},
	"Ready": {"Served", "Cancelled"},
	"Served": {"Bill Pending", "Settled", "Cancelled"},
	"Bill Pending": {"Settled", "Cancelled"},
	"Settled": set(),
	"Cancelled": set(),
}

OPEN_STATES = {"Draft", "Sent to Kitchen", "Preparing", "Ready", "Served", "Bill Pending"}


# ---------- helpers ----------


def _ensure_erpnext_item_for_menu(menu_item_name: str) -> str:
	"""Lazily create an ERPNext Item for a Menu Item that lacks one.

	Slice 4 needs walk-in Sales Invoices — every SI line needs an Item.
	Menu items seeded before this slice don't have `erpnext_item` set,
	so provision on demand: same code as `MENU-<item_code_short>`, group
	'Products', selling item, non-stock. Slice 2 replaces this with proper
	BOM-backed inventory items.
	"""
	menu = frappe.db.get_value(
		"Menu Item",
		menu_item_name,
		["item_name", "item_code_short", "price", "currency"],
		as_dict=True,
	)
	if not menu:
		frappe.throw(_("Unknown Menu Item: {0}").format(menu_item_name))
	code = f"MENU-{menu.item_code_short}"
	if not frappe.db.exists("Item", code):
		frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": code,
				"item_name": menu.item_name,
				"item_group": frappe.db.get_value("Item Group", {"parent_item_group": "All Item Groups"}, "name")
				or "Products",
				"stock_uom": "Nos",
				"is_stock_item": 0,
				"is_sales_item": 1,
				"is_purchase_item": 0,
				"standard_rate": flt(menu.price),
			}
		).insert(ignore_permissions=True)
	frappe.db.set_value("Menu Item", menu_item_name, "erpnext_item", code, update_modified=False)
	return code


SERVICE_CHARGE_ITEM_CODE = "FNB-SERVICE-CHARGE"


def _ensure_service_charge_item() -> str:
	"""ERPNext service item used to bill the outlet service charge on the invoice
	so it is captured as revenue and taxed like any other line."""
	if not frappe.db.exists("Item", SERVICE_CHARGE_ITEM_CODE):
		frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": SERVICE_CHARGE_ITEM_CODE,
				"item_name": "F&B Service Charge",
				"item_group": frappe.db.get_value("Item Group", {"parent_item_group": "All Item Groups"}, "name")
				or "Services",
				"stock_uom": "Nos",
				"is_stock_item": 0,
				"is_sales_item": 1,
				"is_purchase_item": 0,
			}
		).insert(ignore_permissions=True)
	return SERVICE_CHARGE_ITEM_CODE


def _property_currency(resort_property: str) -> str | None:
	company = frappe.db.get_value("Resort Property", resort_property, "company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)
	if not company:
		return None
	return frappe.db.get_value("Company", company, "default_currency")


def _outlet_or_throw(outlet: str) -> dict:
	if not frappe.db.exists("FnB Outlet", outlet):
		frappe.throw(_("Unknown outlet: {0}").format(outlet))
	return frappe.db.get_value(
		"FnB Outlet",
		outlet,
		["name", "outlet_name", "outlet_code", "resort_property", "default_service_charge_pct"],
		as_dict=True,
	)


def _order_or_throw(order: str) -> "frappe.model.document.Document":
	if not frappe.db.exists("Restaurant Order", order):
		frappe.throw(_("Unknown order: {0}").format(order))
	return frappe.get_doc("Restaurant Order", order)


def _assert_transition(doc, target: str) -> None:
	allowed = STATE_TRANSITIONS.get(doc.state, set())
	if target not in allowed:
		frappe.throw(
			_("Cannot transition Restaurant Order {0} from {1} to {2}.").format(
				doc.name, doc.state, target
			)
		)


def _idempotency_key(outlet: str, table: str | None, waiter: str, opened_at: str) -> str:
	digest = hashlib.md5()
	digest.update(outlet.encode())
	digest.update(str(table or "").encode())
	digest.update(waiter.encode())
	digest.update(str(opened_at).encode())
	return f"restaurant:{digest.hexdigest()[:16]}"


def _kitchen_section_for(items: list[dict]) -> str:
	"""Derive kitchen section from menu categories on the order — Hot/Cold/Bar/Pastry/Mixed."""
	if not items:
		return ""
	categories = set()
	for i in items:
		category = frappe.db.get_value("Menu Item", i.get("menu_item"), "category")
		if category:
			categories.add(category)
	if categories <= {"Beverages", "Alcohol"}:
		return "Bar"
	if categories <= {"Desserts"}:
		return "Pastry"
	if categories <= {"Starters", "Sides"}:
		return "Cold Kitchen"
	if len(categories) == 1 and next(iter(categories)) in {"Mains", "Breakfast"}:
		return "Hot Kitchen"
	return "Mixed"


def _next_kot_number(outlet: str) -> str:
	"""Sequential per-outlet KOT counter within today."""
	today_prefix = today().replace("-", "")
	outlet_code = frappe.db.get_value("FnB Outlet", outlet, "outlet_code") or "OUT"
	base = f"KOT-{outlet_code}-{today_prefix}-"
	count = frappe.db.count(
		"Restaurant Order",
		{"outlet": outlet, "kot_number": ["like", f"{base}%"]},
	)
	return f"{base}{count + 1:03d}"


def _order_item_dict(row) -> dict:
	"""Every menu-item-bearing row across the module carries the same
	imagery packet — Menu Item image URL + veg + spice + category — so the UI
	can render the branded tile with fallback-to-gradient without a second
	round-trip to `list_menu_items`.
	"""
	menu_meta = frappe.db.get_value(
		"Menu Item",
		row.menu_item,
		["image", "veg_flag", "spice_level", "category"],
		as_dict=True,
	) or {}
	return {
		"name": row.name,
		"menu_item": row.menu_item,
		"item_name": row.item_name,
		"quantity": row.quantity,
		"rate": flt(row.rate),
		"amount": flt(row.amount),
		"line_status": row.line_status,
		"chef_note": row.chef_note,
		"sent_at": str(row.sent_at) if row.sent_at else None,
		"ready_at": str(row.ready_at) if row.ready_at else None,
		"served_at": str(row.served_at) if row.served_at else None,
		"image": menu_meta.get("image"),
		"veg_flag": menu_meta.get("veg_flag"),
		"spice_level": menu_meta.get("spice_level"),
		"category": menu_meta.get("category"),
	}


def _kitchen_item_dict(row) -> dict:
	"""Kitchen-facing row — what to cook and how, with NO pricing.

	The KDS is used by the kitchen role, which spec 006 (spec.md:829) forbids
	from seeing financial totals. This is the money-stripped sibling of
	`_order_item_dict`: no `rate`/`amount`, but the full imagery + prep packet.
	"""
	menu_meta = frappe.db.get_value(
		"Menu Item",
		row.menu_item,
		["image", "veg_flag", "spice_level", "category"],
		as_dict=True,
	) or {}
	return {
		"name": row.name,
		"menu_item": row.menu_item,
		"item_name": row.item_name,
		"quantity": row.quantity,
		"line_status": row.line_status,
		"chef_note": row.chef_note,
		"sent_at": str(row.sent_at) if row.sent_at else None,
		"ready_at": str(row.ready_at) if row.ready_at else None,
		"served_at": str(row.served_at) if row.served_at else None,
		"image": menu_meta.get("image"),
		"veg_flag": menu_meta.get("veg_flag"),
		"spice_level": menu_meta.get("spice_level"),
		"category": menu_meta.get("category"),
	}


def _kitchen_order_dict(doc) -> dict:
	"""Kitchen-facing order — ticket header + prep timers, NO money fields.

	Deliberately omits subtotal / discount / service charge / taxes /
	grand_total and per-item pricing so financial totals never reach the
	kitchen role over the wire (spec 006, spec.md:829).
	"""
	return {
		"name": doc.name,
		"outlet": doc.outlet,
		"table": doc.restaurant_table,
		"bill_type": doc.bill_type or "Walk-in",
		"stay": doc.stay,
		"state": doc.state,
		"kot_number": doc.kot_number,
		"kitchen_section": doc.kitchen_section,
		"party_size": doc.party_size,
		"guest_name": doc.guest_name,
		"opened_at": str(doc.opened_at) if doc.opened_at else None,
		"sent_to_kitchen_at": str(doc.sent_to_kitchen_at) if doc.sent_to_kitchen_at else None,
		"ready_at": str(doc.ready_at) if doc.ready_at else None,
		"served_at": str(doc.served_at) if doc.served_at else None,
		"chef_notes": doc.chef_notes,
		"guest_note": doc.guest_note,
		"items": [_kitchen_item_dict(row) for row in (doc.items or [])],
	}


def _order_dict(doc) -> dict:
	return {
		"name": doc.name,
		"outlet": doc.outlet,
		"table": doc.restaurant_table,
		"bill_type": doc.bill_type or "Walk-in",
		"stay": doc.stay,
		"guest_folio": doc.guest_folio,
		"state": doc.state,
		"kot_number": doc.kot_number,
		"kitchen_section": doc.kitchen_section,
		"party_size": doc.party_size,
		"guest_name": doc.guest_name,
		"waiter_user": doc.waiter_user,
		"opened_at": str(doc.opened_at) if doc.opened_at else None,
		"sent_to_kitchen_at": str(doc.sent_to_kitchen_at) if doc.sent_to_kitchen_at else None,
		"ready_at": str(doc.ready_at) if doc.ready_at else None,
		"served_at": str(doc.served_at) if doc.served_at else None,
		"settled_at": str(doc.settled_at) if doc.settled_at else None,
		"subtotal": flt(doc.subtotal),
		"discount_amount": flt(doc.discount_amount),
		"service_charge_pct": flt(doc.service_charge_pct),
		"service_charge_amount": flt(doc.service_charge_amount),
		"total_taxes": flt(doc.total_taxes),
		"grand_total": flt(doc.grand_total),
		"currency": doc.currency,
		"chef_notes": doc.chef_notes,
		"guest_note": doc.guest_note,
		"erpnext_sales_invoice": doc.erpnext_sales_invoice,
		"erpnext_payment_entry": doc.erpnext_payment_entry,
		"items": [_order_item_dict(row) for row in (doc.items or [])],
	}


# ---------- floor plan ----------


@frappe.whitelist()
def list_tables(outlet: str) -> dict:
	"""Floor plan for an outlet — every active table + its live status.

	Live status derivation:
	  - "Vacant"           → no open order on this table
	  - "Seated"           → open order in state Draft
	  - "Ordering"         → open order in state Draft with ≥1 item
	    (client can distinguish empty draft vs items-in-cart by inspecting the order)
	  - "Preparing"        → open order in state Sent to Kitchen / Preparing
	  - "Serving"          → open order in state Ready / Served
	  - "Bill Pending"     → open order in state Bill Pending
	"""
	_require_permission("Restaurant Table", "read")
	_outlet_or_throw(outlet)

	tables = frappe.get_all(
		"Restaurant Table",
		filters={"outlet": outlet, "is_active": 1},
		fields=["name", "table_code", "table_name", "zone", "seats", "display_order"],
		order_by="display_order asc, table_code asc",
	)

	# Batch fetch open orders for these tables. An outlet with no tables
	# (e.g. In-Room Dining) has nothing to match — skip the query entirely.
	open_orders = (
		frappe.get_all(
			"Restaurant Order",
			filters={
				"outlet": outlet,
				"restaurant_table": ["in", [t["name"] for t in tables]],
				"state": ["in", list(OPEN_STATES)],
			},
			fields=["name", "restaurant_table", "state", "opened_at", "grand_total", "guest_name", "kot_number"],
		)
		if tables
		else []
	)
	by_table: dict[str, dict] = {}
	for order in open_orders:
		by_table[order["restaurant_table"]] = order

	for t in tables:
		order = by_table.get(t["name"])
		if not order:
			t["live_status"] = "Vacant"
			t["open_order"] = None
			continue
		state = order["state"]
		if state == "Draft":
			t["live_status"] = "Seated"
		elif state in {"Sent to Kitchen", "Preparing"}:
			t["live_status"] = "Preparing"
		elif state in {"Ready", "Served"}:
			t["live_status"] = "Serving"
		elif state == "Bill Pending":
			t["live_status"] = "Bill Pending"
		else:
			t["live_status"] = "Occupied"
		t["open_order"] = {
			"name": order["name"],
			"state": state,
			"opened_at": str(order["opened_at"]) if order["opened_at"] else None,
			"grand_total": flt(order["grand_total"]),
			"guest_name": order.get("guest_name"),
			"kot_number": order.get("kot_number"),
		}

	return _envelope({"outlet": outlet, "tables": tables})


# ---------- walk-in order lifecycle ----------


@frappe.whitelist()
def open_walk_in_order(
	outlet: str,
	table: str | None = None,
	party_size: int = 2,
	guest_name: str | None = None,
	opened_at: str | None = None,
	approval_request: str | None = None,
) -> dict:
	"""Create a Draft Restaurant Order. Idempotent per (outlet, table, waiter, opened_at)."""
	_require_permission("Restaurant Order", "create")
	outlet_row = _outlet_or_throw(outlet)

	if table:
		table_row = frappe.db.get_value("Restaurant Table", table, ["outlet", "is_active"], as_dict=True)
		if not table_row:
			frappe.throw(_("Unknown table: {0}").format(table))
		if table_row.outlet != outlet:
			frappe.throw(_("Table {0} does not belong to outlet {1}.").format(table, outlet))
		if not table_row.is_active:
			frappe.throw(_("Table {0} is deactivated.").format(table))
		# Reject if there's already an open order on this table.
		existing = frappe.db.get_value(
			"Restaurant Order",
			{"restaurant_table": table, "state": ["in", list(OPEN_STATES)]},
			"name",
		)
		if existing:
			return _envelope(
				{"order": _order_dict(frappe.get_doc("Restaurant Order", existing)), "reused": True}
			)

	opened_at = opened_at or now_datetime()
	# Backdate gate.
	if isinstance(opened_at, str):
		opened_at_dt = get_datetime(opened_at)
	else:
		opened_at_dt = opened_at
	hours_back = (now_datetime() - opened_at_dt).total_seconds() / 3600
	if hours_back > BACKDATE_HOURS:
		from the_reezort.approvals.api import require_approval

		require_approval(
			action="restaurant_backdate",
			source_doctype="Restaurant Order",
			source_name=f"{outlet}-{opened_at_dt.isoformat()}",
			payload={"outlet": outlet, "hours_back": hours_back},
			approval_request=approval_request,
		)

	key = _idempotency_key(outlet, table, frappe.session.user, str(opened_at_dt))
	existing_name = frappe.db.get_value("Restaurant Order", {"idempotency_key": key}, "name")
	if existing_name:
		return _envelope(
			{"order": _order_dict(frappe.get_doc("Restaurant Order", existing_name)), "reused": True}
		)

	doc = frappe.get_doc(
		{
			"doctype": "Restaurant Order",
			"resort_property": outlet_row.resort_property,
			"outlet": outlet,
			"restaurant_table": table,
			"state": "Draft",
			"opened_at": opened_at_dt,
			"waiter_user": frappe.session.user,
			"party_size": party_size,
			"guest_name": guest_name,
			"service_charge_pct": flt(outlet_row.default_service_charge_pct or 0),
			"currency": _property_currency(outlet_row.resort_property) or "INR",
			"idempotency_key": key,
			"items": [],
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert()
	record_audit_event(
		"Restaurant Order",
		doc.name,
		"restaurant.open_walk_in",
		details={"outlet": outlet, "table": table, "party_size": party_size},
	)
	return _envelope({"order": _order_dict(doc), "reused": False})


# Orders that can still accept new item rounds (multi-round service). Once the
# bill is being settled (Bill Pending / Settled) or cancelled, no new items.
ADDABLE_STATES = {"Draft", "Sent to Kitchen", "Preparing", "Ready", "Served"}


@frappe.whitelist()
def add_items(order: str, items: list[dict] | str) -> dict:
	"""Add a fresh round of items to an open order. New rows land as Draft-line
	items to be fired with the next send_to_kitchen; existing rows are untouched.
	Allowed while the order is still open (through Served) — supports multi-round
	dining. Blocked once the bill is being settled or cancelled."""
	_require_permission("Restaurant Order", "write")
	doc = _order_or_throw(order)
	if doc.state not in ADDABLE_STATES:
		frappe.throw(_("Cannot add items to order {0} in state {1}.").format(order, doc.state))

	raw_items = items
	items = json.loads(items) if isinstance(items, str) else items
	if not items:
		frappe.throw(_("No items supplied."))

	for row in items:
		menu_item = row.get("menu_item")
		if not menu_item:
			frappe.throw(_("Every item must include a menu_item."))
		menu_row = frappe.db.get_value(
			"Menu Item",
			menu_item,
			["name", "outlet", "price", "is_available", "item_name"],
			as_dict=True,
		)
		if not menu_row:
			frappe.throw(_("Unknown menu item: {0}").format(menu_item))
		if menu_row.outlet != doc.outlet:
			frappe.throw(
				_("Item {0} belongs to outlet {1}, not {2}.").format(menu_item, menu_row.outlet, doc.outlet)
			)
		if not menu_row.is_available:
			frappe.throw(_("Item {0} is 86'd right now.").format(menu_row.item_name))
		qty = int(row.get("quantity") or 1)
		if qty <= 0:
			frappe.throw(_("Quantity for {0} must be > 0.").format(menu_row.item_name))
		doc.append(
			"items",
			{
				"menu_item": menu_item,
				"item_name": menu_row.item_name,
				"quantity": qty,
				"rate": flt(row.get("rate") or menu_row.price),
				"chef_note": row.get("chef_note"),
				"line_status": "Draft",
			},
		)

	doc.flags.ignore_permissions = True
	doc.save()
	record_audit_event(
		"Restaurant Order",
		doc.name,
		"restaurant.add_items",
		details={"count": len(items), "items": [{"menu_item": i.get("menu_item"), "quantity": int(i.get("quantity") or 1)} for i in items]},
	)
	return _envelope({"order": _order_dict(doc)})


@frappe.whitelist()
def send_to_kitchen(order: str) -> dict:
	"""Fire the unsent (Draft-line) items to the kitchen with a fresh KOT number.

	First round: Draft → Sent to Kitchen. Later rounds (order already past Draft
	after add_items): the order keeps its current state and only the new items
	are fired under a new KOT — this is how multi-round dining works."""
	_require_permission("Restaurant Order", "write")
	doc = _order_or_throw(order)

	unsent = [item for item in doc.items if item.line_status == "Draft"]
	if not unsent:
		frappe.throw(_("Order {0} has no new items to send.").format(order))

	first_round = doc.state == "Draft"
	if first_round:
		_assert_transition(doc, "Sent to Kitchen")
		doc.state = "Sent to Kitchen"
	elif doc.state not in ADDABLE_STATES:
		frappe.throw(_("Order {0} in state {1} cannot receive another round.").format(order, doc.state))

	doc.sent_to_kitchen_at = now_datetime()
	doc.kot_number = _next_kot_number(doc.outlet)
	doc.kitchen_section = _kitchen_section_for(
		[{"menu_item": i.menu_item} for i in unsent]
	)
	for item in unsent:
		item.line_status = "Sent"
		item.sent_at = now_datetime()

	doc.flags.ignore_permissions = True
	doc.save()
	record_audit_event(
		"Restaurant Order",
		doc.name,
		"restaurant.send_to_kitchen",
		details={"kot": doc.kot_number, "section": doc.kitchen_section, "item_count": len(unsent), "round": not first_round},
	)

	# Fire notification to Restaurant role — Kitchen sub-role can be added later.
	try:
		from the_reezort.staff.notify_api import notify_role

		notify_role(
			role="Restaurant",
			subject=_("KOT {0} sent · {1}").format(doc.kot_number, doc.outlet),
			body=_("{0} items → {1}").format(len(unsent), doc.kitchen_section or "kitchen"),
			link=f"#/restaurant/kitchen?order={doc.name}",
			dedupe_key=f"pos-sent:{doc.name}:{doc.kot_number}",
		)
	except Exception:
		pass

	return _envelope({"order": _order_dict(doc)})


@frappe.whitelist()
def list_active_kots(outlet: str) -> dict:
	"""KOT screen queue — every order currently in Sent to Kitchen / Preparing / Ready."""
	_require_permission("Restaurant Order", "read")
	_outlet_or_throw(outlet)
	names = frappe.get_all(
		"Restaurant Order",
		filters={"outlet": outlet, "state": ["in", ["Sent to Kitchen", "Preparing", "Ready"]]},
		pluck="name",
		order_by="sent_to_kitchen_at asc",
	)
	# Kitchen-scoped payload — no financial totals reach the KDS (spec.md:829).
	orders = [_kitchen_order_dict(frappe.get_doc("Restaurant Order", n)) for n in names]
	return _envelope({"outlet": outlet, "orders": orders})


@frappe.whitelist()
def mark_kot_status(order: str, status: str) -> dict:
	"""Kitchen-side state transitions: Preparing / Ready / Served.

	Also cascades to every item row so the POS-side sees per-item progress
	(future spec ships per-item strike-off; for now everything moves together).
	"""
	_require_permission("Restaurant Order", "write")
	doc = _order_or_throw(order)
	_assert_transition(doc, status)

	doc.state = status
	stamp = now_datetime()
	if status == "Ready":
		doc.ready_at = stamp
		for item in doc.items:
			if item.line_status in {"Sent", "Preparing"}:
				item.line_status = "Ready"
				item.ready_at = stamp
	elif status == "Preparing":
		for item in doc.items:
			if item.line_status == "Sent":
				item.line_status = "Preparing"
	elif status == "Served":
		doc.served_at = stamp
		for item in doc.items:
			if item.line_status in {"Ready", "Preparing", "Sent"}:
				item.line_status = "Served"
				item.served_at = stamp

	doc.flags.ignore_permissions = True
	doc.save()
	record_audit_event(
		"Restaurant Order",
		doc.name,
		f"restaurant.kot_{status.lower().replace(' ', '_')}",
		details={"kot": doc.kot_number, "state": status},
	)

	# A Room-billed order is charged to the guest's folio the moment it's served —
	# no separate POS settlement step for room service.
	if status == "Served" and doc.bill_type == "Room" and doc.stay and not doc.guest_folio:
		post_order_to_room(doc.name, doc.stay)
		doc.reload()

	return _envelope({"order": _order_dict(doc)})


@frappe.whitelist()
def close_walk_in(order: str, payments: list[dict] | str | None = None) -> dict:
	"""Served → Settled. Creates a Sales Invoice + optional Payment Entry.

	Idempotent: short-circuits if erpnext_sales_invoice is already set.
	Payments shape mirrors billing.settlement.settle_folio: [{mode_of_payment, amount}].
	"""
	_require_permission("Restaurant Order", "write")
	doc = _order_or_throw(order)

	# A Room-billed order settles to the guest's folio, not a POS Sales Invoice.
	if doc.bill_type == "Room" and doc.stay:
		return post_order_to_room(order, doc.stay)

	if doc.erpnext_sales_invoice and doc.state == "Settled":
		return _envelope({"order": _order_dict(doc), "reused": True})

	if doc.state not in {"Served", "Bill Pending"}:
		frappe.throw(_("Order {0} must be Served or Bill Pending to close.").format(order))

	payments = json.loads(payments) if isinstance(payments, str) else (payments or [])

	from the_reezort.billing.erpnext_posting import (
		build_and_submit_sales_invoice,
		create_payment_entry_for_invoice,
	)

	company = frappe.db.get_value("Resort Property", doc.resort_property, "company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)
	# Entire ERPNext posting block runs elevated — SI.submit + PE.submit touch
	# Item Price / GL Entry / Stock Ledger that operational (Restaurant /
	# Resort Manager) roles have no direct rights on. The whitelisted endpoint
	# above is the trusted service boundary.
	with _as_admin():
		# Walk-in charges — no guest profile, bill to a generic walk-in customer.
		walk_in_customer = frappe.db.get_value("Customer", {"customer_name": "Walk-in Guest"}, "name")
		if not walk_in_customer:
			walk_in_customer = frappe.get_doc(
				{
					"doctype": "Customer",
					"customer_name": "Walk-in Guest",
					"customer_group": "Individual",
					"territory": "All Territories",
				}
			).insert(ignore_permissions=True).name

		# Build lines from menu items → ERPNext items, auto-provisioning missing links.
		invoice_lines = []
		for item in doc.items:
			erp_item = frappe.db.get_value(
				"Menu Item", item.menu_item, "erpnext_item"
			) or _ensure_erpnext_item_for_menu(item.menu_item)
			invoice_lines.append(
				{
					"item_code": erp_item,
					"qty": item.quantity,
					"rate": flt(item.rate),
					"description": item.item_name,
				}
			)

		# Service charge is billed as its own invoice line so it is real revenue
		# and taxed with everything else (Slice 5 gap: it was previously dropped).
		if flt(doc.service_charge_amount) > 0:
			invoice_lines.append(
				{
					"item_code": _ensure_service_charge_item(),
					"qty": 1,
					"rate": flt(doc.service_charge_amount),
					"description": _("Service charge ({0}%)").format(flt(doc.service_charge_pct)),
				}
			)

		# Prefer the outlet's own tax template so GST/service-mode rules apply;
		# fall back to the company default inside build_and_submit_sales_invoice.
		outlet_template = frappe.db.get_value("FnB Outlet", doc.outlet, "default_tax_template")

		sales_invoice = build_and_submit_sales_invoice(
			company=company,
			customer=walk_in_customer,
			currency=doc.currency or "INR",
			lines=invoice_lines,
			taxes_template=outlet_template,
			remarks=_("Restaurant Order {0} · {1}").format(doc.name, doc.outlet),
		)

		# Multi-payment: settle across every supplied payment row (cash / card /
		# UPI / wallet / mixed), never dropping any but the first. Cumulative
		# payment is capped at the invoice's grand total.
		payment_entries = []
		# Pay against the SI's true payable (rounded_total), never the raw grand
		# total — ERPNext rejects allocating more than the rounded outstanding.
		remaining = flt(sales_invoice.rounded_total) or flt(sales_invoice.grand_total)
		for payment in payments:
			if remaining <= 0:
				break
			requested = flt(payment.get("amount")) or remaining
			pay_amount = min(requested, remaining)
			if pay_amount <= 0:
				continue
			pe = create_payment_entry_for_invoice(
				sales_invoice=sales_invoice.name,
				amount=pay_amount,
				mode_of_payment=payment.get("mode_of_payment") or "Cash",
				reference_no=payment.get("reference_no") or sales_invoice.name,
			)
			payment_entries.append(pe)
			remaining -= pay_amount
		payment_entry_name = payment_entries[0] if payment_entries else None

	# Raw-material consumption via BOM — Slice 2. Runs inside the same _as_admin
	# block so it has Stock Entry / GL Entry rights. Failures don't block invoice
	# submission (log_error + dropped_items list); a kitchen ops manager can
	# reconcile stock separately when consumption fails on shortage etc.
	consumption_result: dict = {"stock_entry": None}
	with _as_admin():
		from the_reezort.fnb.consumption import consume_for_order
		from the_reezort.fnb.warehouse_seed import warehouse_for_outlet

		warehouse = warehouse_for_outlet(doc.outlet, company=company)
		if warehouse:
			consumption_result = consume_for_order(
				warehouse=warehouse,
				order_items=[
					{"menu_item": item.menu_item, "quantity": item.quantity, "item_name": item.item_name}
					for item in doc.items
				],
				remarks=f"F&B walk-in {doc.name} · SI {sales_invoice.name}",
				company=company,
			)

	doc.erpnext_sales_invoice = sales_invoice.name
	if payment_entry_name:
		doc.erpnext_payment_entry = payment_entry_name
	doc.state = "Settled"
	doc.settled_at = now_datetime()
	doc.flags.ignore_permissions = True
	doc.save()
	record_audit_event(
		"Restaurant Order",
		doc.name,
		"restaurant.close_walk_in",
		details={
			"sales_invoice": sales_invoice.name,
			"payment_entry": payment_entry_name,
			"grand_total": flt(doc.grand_total),
			"stock_entry": consumption_result.get("stock_entry"),
		},
	)

	return _envelope(
		{
			"order": _order_dict(doc),
			"sales_invoice": sales_invoice.name,
			"payment_entry": payment_entry_name,
			"payment_entries": payment_entries,
			"stock_entry": consumption_result.get("stock_entry"),
			"consumption_dropped": consumption_result.get("dropped_items", []),
		}
	)


@frappe.whitelist()
def create_room_service_order(
	stay: str,
	outlet: str,
	items: list[dict] | str,
	party_size: int | None = None,
	guest_name: str | None = None,
	chef_notes: str | None = None,
	guest_note: str | None = None,
) -> dict:
	"""In-room-dining order for an in-house guest — one call: create a Room-billed
	Restaurant Order, add the items, and fire it to the kitchen (KOT).

	This is the bridge that makes front-desk / guest room-service orders appear on
	the SAME kitchen queue as POS table orders. Billing happens on close via
	post_order_to_room (charge to folio), not here.
	"""
	_require_permission("Restaurant Order", "create")
	stay_row = frappe.db.get_value(
		"Stay", stay, ["name", "stay_status", "resort_property", "primary_guest_name"], as_dict=True
	)
	if not stay_row:
		frappe.throw(_("Unknown stay: {0}").format(stay))
	if stay_row.stay_status != "In House":
		frappe.throw(_("Room service requires an in-house stay (stay is {0}).").format(stay_row.stay_status))
	_outlet_or_throw(outlet)

	doc = frappe.get_doc(
		{
			"doctype": "Restaurant Order",
			"resort_property": stay_row.resort_property,
			"outlet": outlet,
			"bill_type": "Room",
			"stay": stay,
			"guest_name": guest_name or stay_row.primary_guest_name,
			"party_size": int(party_size or 1),
			"state": "Draft",
			"opened_at": now_datetime(),
			"waiter_user": frappe.session.user,
			"currency": _property_currency(stay_row.resort_property) or "INR",
			"chef_notes": chef_notes,
			"guest_note": guest_note,
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert(ignore_permissions=True)

	add_items(doc.name, items)
	send_to_kitchen(doc.name)  # assigns KOT, notifies kitchen, shows on the KOT screen
	frappe.db.commit()

	return _envelope({"order": _order_dict(frappe.get_doc("Restaurant Order", doc.name))})


@frappe.whitelist()
def set_order_guest(order: str, guest_name: str | None = None, party_size: int | None = None) -> dict:
	"""Attach / update the walk-in guest name (and optionally covers) on an order."""
	_require_permission("Restaurant Order", "write")
	doc = _order_or_throw(order)
	if doc.state in {"Settled", "Cancelled"}:
		frappe.throw(_("Order {0} is {1}; guest details are locked.").format(order, doc.state))
	if guest_name is not None:
		doc.guest_name = guest_name.strip() or None
	if party_size:
		doc.party_size = int(party_size)
	doc.flags.ignore_permissions = True
	doc.save()
	return _envelope({"order": _order_dict(doc)})


@frappe.whitelist()
def create_restaurant_razorpay_order(order: str) -> dict:
	"""Create a Razorpay order for a walk-in's grand total (card / UPI at the POS)."""
	_require_permission("Restaurant Order", "write")
	doc = _order_or_throw(order)
	if doc.state not in {"Served", "Bill Pending"}:
		frappe.throw(_("Order {0} must be Served or Bill Pending to take payment.").format(order))

	amount = flt(doc.grand_total)
	if amount <= 0:
		frappe.throw(_("Order {0} has no payable amount.").format(order))

	from the_reezort.billing.razorpay_gateway import _create_order

	razorpay_order = _create_order(
		amount, doc.currency or "INR", f"RO-{doc.name}", {"restaurant_order": doc.name, "intent": "pos"}
	)
	razorpay_order["order"] = doc.name
	return _envelope(razorpay_order)


@frappe.whitelist()
def capture_restaurant_payment(order: str, razorpay_order_id: str, razorpay_payment_id: str, razorpay_signature: str) -> dict:
	"""Verify a Razorpay POS payment and settle the walk-in with it."""
	_require_permission("Restaurant Order", "write")
	from the_reezort.billing.razorpay_gateway import (
		_authoritative_amount,
		_ensure_razorpay_mode_of_payment,
		verify_signature,
	)

	if not verify_signature(razorpay_order_id, razorpay_payment_id, razorpay_signature):
		frappe.throw(_("Razorpay signature verification failed."))

	# Never trust a client amount — take it from Razorpay.
	amount = _authoritative_amount(razorpay_payment_id, razorpay_order_id)
	mode = _ensure_razorpay_mode_of_payment()
	return close_walk_in(
		order,
		payments=[{"mode_of_payment": mode, "amount": amount, "reference_no": razorpay_payment_id}],
	)


@frappe.whitelist()
def list_in_house_stays(search: str | None = None, limit: int = 20) -> dict:
	"""In-house stays for the POS 'charge to room' picker — optional search over
	guest name or room."""
	_require_permission("Stay", "read")
	filters = {"stay_status": "In House"}
	rows = frappe.get_all(
		"Stay",
		filters=filters,
		fields=["name", "primary_guest_name", "current_room", "resort_property"],
		order_by="modified desc",
		limit_page_length=int(limit),
	)
	if search:
		needle = search.strip().lower()
		rows = [
			r
			for r in rows
			if needle in (r.get("primary_guest_name") or "").lower()
			or needle in (r.get("current_room") or "").lower()
			or needle in (r.get("name") or "").lower()
		]
	return _envelope({"stays": rows})


@frappe.whitelist()
def post_order_to_room(order: str, stay: str) -> dict:
	"""Charge an in-house guest's dining order to their Guest Folio instead of
	settling it at the POS (Workflow 3 · Charge to Room).

	Validates an active checked-in stay with an open folio, posts one folio
	charge line per item (carrying the ERPNext item so folio settlement applies
	GST) plus a service-charge line, and marks the order Settled + room-posted.
	Idempotent per order.
	"""
	_require_permission("Restaurant Order", "write")
	doc = _order_or_throw(order)

	if doc.erpnext_sales_invoice or doc.guest_folio:
		return _envelope({"order": _order_dict(doc), "guest_folio": doc.guest_folio, "reused": True})
	if doc.state not in {"Served", "Bill Pending", "Ready"}:
		frappe.throw(_("Order {0} must be Ready/Served/Bill Pending to charge to room.").format(order))
	if not doc.items:
		frappe.throw(_("Order {0} has no items to post.").format(order))

	stay_row = frappe.db.get_value(
		"Stay", stay, ["name", "stay_status", "resort_property", "customer"], as_dict=True
	)
	if not stay_row:
		frappe.throw(_("Unknown stay: {0}").format(stay))
	if stay_row.stay_status != "In House":
		frappe.throw(_("Room posting requires an active checked-in stay (stay is {0}).").format(stay_row.stay_status))

	from the_reezort.billing.api import get_or_create_folio

	folio = get_or_create_folio(stay=stay, customer=stay_row.customer)["data"]["folio"]["name"]
	folio_status = frappe.db.get_value("Guest Folio", folio, "folio_status")
	if folio_status in {"Settled", "Closed", "Cancelled", "Transferred"}:
		frappe.throw(_("Cannot charge to room — folio {0} is {1}.").format(folio, folio_status))

	posted_lines = []
	with _as_admin():
		for item in doc.items:
			erp_item = frappe.db.get_value(
				"Menu Item", item.menu_item, "erpnext_item"
			) or _ensure_erpnext_item_for_menu(item.menu_item)
			line = frappe.get_doc({
				"doctype": "Folio Line",
				"guest_folio": folio,
				"line_type": "Charge",
				"source_module": "Restaurant",
				"source_doctype": "Restaurant Order",
				"source_name": doc.name,
				"source_row_id": item.name,
				"idempotency_key": f"fnb-order:{doc.name}:{item.name}",
				"service_date": today(),
				"item_code": erp_item,
				"description": f"{item.quantity} × {item.item_name} · {doc.outlet}",
				"qty": item.quantity,
				"rate": flt(item.rate),
				"amount": flt(item.quantity) * flt(item.rate),
				"tax_treatment": "Standard",
			})
			line.insert(ignore_permissions=True)
			posted_lines.append(line.name)

		if flt(doc.service_charge_amount) > 0:
			sc = frappe.get_doc({
				"doctype": "Folio Line",
				"guest_folio": folio,
				"line_type": "Charge",
				"source_module": "Restaurant",
				"source_doctype": "Restaurant Order",
				"source_name": doc.name,
				"idempotency_key": f"fnb-order-svc:{doc.name}",
				"service_date": today(),
				"item_code": _ensure_service_charge_item(),
				"description": _("Service charge ({0}%) · {1}").format(flt(doc.service_charge_pct), doc.outlet),
				"qty": 1,
				"rate": flt(doc.service_charge_amount),
				"amount": flt(doc.service_charge_amount),
				"tax_treatment": "Standard",
			})
			sc.insert(ignore_permissions=True)
			posted_lines.append(sc.name)

	doc.guest_folio = folio
	doc.state = "Settled"
	doc.settled_at = now_datetime()
	doc.flags.ignore_permissions = True
	doc.save()

	# Stock still moves for a room-posted order — same consumption path as a walk-in.
	company = frappe.db.get_value("Resort Property", doc.resort_property, "company")
	with _as_admin():
		from the_reezort.fnb.consumption import consume_for_order
		from the_reezort.fnb.warehouse_seed import warehouse_for_outlet

		warehouse = warehouse_for_outlet(doc.outlet, company=company)
		if warehouse:
			consume_for_order(
				warehouse=warehouse,
				order_items=[
					{"menu_item": i.menu_item, "quantity": i.quantity, "item_name": i.item_name}
					for i in doc.items
				],
				remarks=f"F&B room-post {doc.name} · folio {folio}",
				company=company,
			)

	record_audit_event(
		"Restaurant Order", doc.name, "restaurant.post_order_to_room",
		details={"stay": stay, "guest_folio": folio, "folio_lines": posted_lines},
	)

	return _envelope({
		"order": _order_dict(doc),
		"guest_folio": folio,
		"stay": stay,
		"folio_lines": posted_lines,
	})


@frappe.whitelist()
def cancel_order(order: str, reason: str | None = None, approval_request: str | None = None) -> dict:
	"""Cancel an open order. Kitchen-side cancellations before Settled.

	Voiding an order the kitchen has already seen (anything past Draft) is a
	financial-control event — it destroys committed food and revenue — so it is
	routed through the approval framework (spec 006, spec.md:179). A Draft order
	cancels freely; a post-KOT void needs manager sign-off per the active
	`restaurant_void` Approval Policy (its threshold decides which voids block).
	"""
	_require_permission("Restaurant Order", "write")
	doc = _order_or_throw(order)
	prior_state = doc.state
	_assert_transition(doc, "Cancelled")

	if prior_state != "Draft":
		from the_reezort.approvals.api import require_approval

		require_approval(
			action="restaurant_void",
			source_doctype="Restaurant Order",
			source_name=doc.name,
			payload={"amount": flt(doc.grand_total), "reason": reason, "from_state": prior_state},
			approval_request=approval_request,
		)

	doc.state = "Cancelled"
	doc.cancelled_at = now_datetime()
	if reason:
		doc.chef_notes = (doc.chef_notes or "") + f"\n[Cancelled] {reason}"
	doc.flags.ignore_permissions = True
	doc.save()
	record_audit_event(
		"Restaurant Order",
		doc.name,
		"restaurant.cancel_order",
		reason=reason or "",
		details={"from_state": prior_state},
	)
	return _envelope({"order": _order_dict(doc)})


# ---------- table transfer + order merge (spec 006 · Workflow 4) ----------


def _has_open_split(order: str) -> bool:
	"""An order mid-split can't be moved or merged — money is already partitioned."""
	return bool(
		frappe.get_all(
			"FnB Bill Split", filters={"restaurant_order": order}, limit=1, pluck="name"
		)
	)


@frappe.whitelist()
def transfer_table(order: str, to_table: str) -> dict:
	"""Move an open order to a different, vacant table in the same outlet — the
	guest changed seats. Leaves items, KOT, and totals intact."""
	_require_permission("Restaurant Order", "write")
	doc = _order_or_throw(order)
	if doc.state not in OPEN_STATES:
		frappe.throw(_("Order {0} is {1}; it can't be transferred.").format(order, doc.state))
	if to_table == doc.restaurant_table:
		frappe.throw(_("Order {0} is already on table {1}.").format(order, to_table))

	target = frappe.db.get_value(
		"Restaurant Table", to_table, ["name", "outlet", "is_active"], as_dict=True
	)
	if not target:
		frappe.throw(_("Unknown table: {0}").format(to_table))
	if target.outlet != doc.outlet:
		frappe.throw(_("Table {0} belongs to a different outlet.").format(to_table))
	if not target.is_active:
		frappe.throw(_("Table {0} is deactivated.").format(to_table))

	occupied = frappe.db.get_value(
		"Restaurant Order",
		{"restaurant_table": to_table, "state": ["in", list(OPEN_STATES)]},
		"name",
	)
	if occupied:
		frappe.throw(_("Table {0} already has an open order ({1}).").format(to_table, occupied))

	from_table = doc.restaurant_table
	doc.restaurant_table = to_table
	doc.flags.ignore_permissions = True
	doc.save()
	record_audit_event(
		"Restaurant Order", doc.name, "restaurant.transfer_table",
		details={"from_table": from_table, "to_table": to_table},
	)
	return _envelope({"order": _order_dict(doc)})


@frappe.whitelist()
def merge_orders(primary_order: str, from_order: str) -> dict:
	"""Combine two open orders into one bill — e.g. two tables joining. All items
	from `from_order` move onto `primary_order`; the absorbed order is cancelled
	with a pointer back. Totals recompute on the primary."""
	_require_permission("Restaurant Order", "write")
	if primary_order == from_order:
		frappe.throw(_("Cannot merge an order into itself."))

	primary = _order_or_throw(primary_order)
	source = _order_or_throw(from_order)

	for label, o in (("primary", primary), ("source", source)):
		if o.state not in OPEN_STATES:
			frappe.throw(_("The {0} order {1} is {2}; only open orders can be merged.").format(label, o.name, o.state))
		if o.erpnext_sales_invoice or o.guest_folio:
			frappe.throw(_("Order {0} is already (partly) settled and can't be merged.").format(o.name))
		if _has_open_split(o.name):
			frappe.throw(_("Order {0} has a split plan; cancel it before merging.").format(o.name))
	if primary.outlet != source.outlet:
		frappe.throw(_("Orders are in different outlets and can't be merged."))

	moved = 0
	for row in source.items:
		primary.append(
			"items",
			{
				"menu_item": row.menu_item,
				"item_name": row.item_name,
				"quantity": row.quantity,
				"rate": flt(row.rate),
				"chef_note": row.chef_note,
				"line_status": row.line_status,
				"sent_at": row.sent_at,
				"ready_at": row.ready_at,
				"served_at": row.served_at,
			},
		)
		moved += 1

	primary.flags.ignore_permissions = True
	primary.save()  # recomputes totals

	source.items = []
	source.state = "Cancelled"
	source.cancelled_at = now_datetime()
	source.chef_notes = (source.chef_notes or "") + f"\n[Merged into {primary.name}]"
	source.flags.ignore_permissions = True
	source.save()

	record_audit_event(
		"Restaurant Order", primary.name, "restaurant.merge_orders",
		details={"absorbed": source.name, "items_moved": moved},
	)
	record_audit_event(
		"Restaurant Order", source.name, "restaurant.merged_away",
		details={"into": primary.name},
	)
	return _envelope({"order": _order_dict(primary), "absorbed": source.name})


# ---------- lookup helpers for the POS UI ----------


@frappe.whitelist()
def get_order(order: str) -> dict:
	_require_permission("Restaurant Order", "read")
	return _envelope({"order": _order_dict(_order_or_throw(order))})


@frappe.whitelist()
def list_orders_by_state(outlet: str, states: list[str] | str | None = None, limit: int = 50) -> dict:
	"""Generic filter for the Restaurant workspace's tabs."""
	_require_permission("Restaurant Order", "read")
	_outlet_or_throw(outlet)
	if isinstance(states, str):
		states = json.loads(states)
	filters = {"outlet": outlet}
	if states:
		filters["state"] = ["in", states]
	names = frappe.get_all(
		"Restaurant Order",
		filters=filters,
		pluck="name",
		order_by="opened_at desc",
		limit=limit,
	)
	orders = [_order_dict(frappe.get_doc("Restaurant Order", n)) for n in names]
	return _envelope({"outlet": outlet, "orders": orders})
