"""Split-bill settlement for restaurant orders — spec 006 Workflow 5.

A cashier partitions one unpaid Restaurant Order into N portions ("splits").
The whole check is split by ONE method — Item / Seat / Amount / Percentage /
Custom — but each portion settles INDEPENDENTLY: one may be paid directly
(Sales Invoice + Payment Entry) while another is charged to a guest's room
folio. The original order keeps full audit traceability; BOM stock is consumed
once, when the final portion settles and the parent order flips to Settled.

Split types:
  - Item / Seat / Custom → each portion carries an explicit subset of the
    order's item rows (qty allocations). Every order row's full quantity must
    be allocated exactly once across the plan.
  - Amount               → each portion owns a grand-total amount; the amounts
    must sum to the order grand total.
  - Percentage           → each portion owns a % of the order; the percentages
    must sum to 100.

For Amount/Percentage the portion has no item detail, so its invoice/folio
carries a single proportional revenue line. Service charge and tax are
apportioned onto every portion by its pre-tax net share so the portions sum
back to the order total.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import flt, now_datetime, today

from the_reezort.audit.api import record_audit_event
from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission
from the_reezort.fnb.restaurant import (
	_as_admin,
	_ensure_erpnext_item_for_menu,
	_ensure_service_charge_item,
	_order_or_throw,
)

SPLIT_CHARGE_ITEM_CODE = "FNB-SPLIT-SHARE"
ITEMIZED_TYPES = {"Item", "Seat", "Custom"}
VALUE_TYPES = {"Amount", "Percentage"}
# A cent of slack absorbs floating-point rounding in coverage checks.
_EPS = 0.01


# --------------------------------------------------------------------------- #
#  apportionment math
# --------------------------------------------------------------------------- #

def _effective_tax_rate(order) -> float:
	"""Back out the order's blended tax rate from its own computed totals so a
	portion is taxed exactly like the parent (no second source of truth)."""
	taxable = flt(order.subtotal) - flt(order.discount_amount) + flt(order.service_charge_amount)
	if taxable <= 0:
		return 0.0
	return flt(order.total_taxes) / taxable * 100.0


def _apportion(order, net: float) -> dict:
	"""Given a portion's pre-tax net (sum of its item amounts), apportion the
	order's discount, service charge and tax onto it. Portions sum to the order.
	"""
	order_subtotal = flt(order.subtotal)
	share = (flt(net) / order_subtotal) if order_subtotal > 0 else 0.0
	discount = flt(order.discount_amount) * share
	service_charge = flt(net) * flt(order.service_charge_pct) / 100.0
	taxable = flt(net) - discount + service_charge
	tax = taxable * _effective_tax_rate(order) / 100.0
	grand = taxable + tax
	return {
		"net_amount": flt(net),
		"service_charge_amount": flt(service_charge),
		"tax_amount": flt(tax),
		"grand_total": flt(grand),
	}


def _net_for_value_portion(order, split_type: str, portion: dict) -> float:
	"""Convert an Amount- or Percentage-portion into a pre-tax net so it can go
	through the same apportionment as an itemized portion."""
	order_subtotal = flt(order.subtotal)
	if split_type == "Percentage":
		pct = flt(portion.get("percentage"))
		return order_subtotal * pct / 100.0
	# Amount: the portion is expressed as a slice of the grand total; convert
	# back to net by the order's grand/subtotal ratio.
	grand = flt(order.grand_total)
	amount = flt(portion.get("amount"))
	if grand <= 0:
		return 0.0
	return amount * order_subtotal / grand


# --------------------------------------------------------------------------- #
#  plan resolution + validation
# --------------------------------------------------------------------------- #

def _order_rows(order) -> dict:
	"""Map Restaurant Order Item row-name → {menu_item, item_name, rate, qty}."""
	return {
		row.name: {
			"menu_item": row.menu_item,
			"item_name": row.item_name,
			"rate": flt(row.rate),
			"qty": flt(row.quantity),
		}
		for row in order.items
	}


def _resolve_portions(order, split_type: str, splits: list[dict]) -> list[dict]:
	"""Validate the plan and compute each portion's allocations + totals.

	Raises ValidationError on any coverage mismatch. Returns a list of dicts
	ready to persist as F&B Bill Split records.
	"""
	if not splits:
		frappe.throw(_("A split plan needs at least one portion."))
	if split_type not in ITEMIZED_TYPES | VALUE_TYPES:
		frappe.throw(_("Unknown split type: {0}").format(split_type))

	resolved: list[dict] = []

	if split_type in ITEMIZED_TYPES:
		rows = _order_rows(order)
		allocated: dict[str, float] = {name: 0.0 for name in rows}
		for portion in splits:
			items = portion.get("items") or []
			if not items:
				frappe.throw(_("Each {0} split must allocate at least one item.").format(split_type))
			split_items = []
			net = 0.0
			for alloc in items:
				row_name = alloc.get("order_item")
				qty = flt(alloc.get("qty"))
				if row_name not in rows:
					frappe.throw(_("Item row {0} is not on order {1}.").format(row_name, order.name))
				if qty <= 0:
					continue
				allocated[row_name] += qty
				rate = rows[row_name]["rate"]
				net += qty * rate
				split_items.append(
					{
						"order_item_row": row_name,
						"menu_item": rows[row_name]["menu_item"],
						"item_name": rows[row_name]["item_name"],
						"qty": qty,
						"rate": rate,
						"amount": qty * rate,
					}
				)
			resolved.append({"portion": portion, "split_items": split_items, **_apportion(order, net)})

		# Coverage: every row's full quantity is allocated exactly once.
		for name, row in rows.items():
			if abs(allocated[name] - row["qty"]) > _EPS:
				frappe.throw(
					_("Item {0} is over/under-allocated: {1} of {2} assigned.").format(
						row["item_name"], allocated[name], row["qty"]
					)
				)
	else:
		total_check = 0.0
		for portion in splits:
			net = _net_for_value_portion(order, split_type, portion)
			resolved.append({"portion": portion, "split_items": [], **_apportion(order, net)})
			total_check += flt(portion.get("percentage")) if split_type == "Percentage" else flt(portion.get("amount"))
		if split_type == "Percentage" and abs(total_check - 100.0) > _EPS:
			frappe.throw(_("Percentages must sum to 100 (got {0}).").format(total_check))
		if split_type == "Amount" and abs(total_check - flt(order.grand_total)) > _EPS:
			frappe.throw(
				_("Amounts must sum to the order total {0} (got {1}).").format(
					flt(order.grand_total), total_check
				)
			)

	return resolved


# --------------------------------------------------------------------------- #
#  serialization
# --------------------------------------------------------------------------- #

def _split_dict(doc) -> dict:
	return {
		"name": doc.name,
		"restaurant_order": doc.restaurant_order,
		"split_type": doc.split_type,
		"split_label": doc.split_label,
		"settlement_mode": doc.settlement_mode,
		"room_stay": doc.room_stay,
		"customer_name": doc.customer_name,
		"portion_pct": flt(doc.portion_pct),
		"split_status": doc.split_status,
		"net_amount": flt(doc.net_amount),
		"service_charge_amount": flt(doc.service_charge_amount),
		"tax_amount": flt(doc.tax_amount),
		"grand_total": flt(doc.grand_total),
		"currency": doc.currency,
		"erpnext_sales_invoice": doc.erpnext_sales_invoice,
		"erpnext_payment_entry": doc.erpnext_payment_entry,
		"guest_folio": doc.guest_folio,
		"settled_at": str(doc.settled_at) if doc.settled_at else None,
		"items": [
			{
				"order_item_row": row.order_item_row,
				"menu_item": row.menu_item,
				"item_name": row.item_name,
				"qty": flt(row.qty),
				"rate": flt(row.rate),
				"amount": flt(row.amount),
			}
			for row in doc.split_items
		],
	}


def _list_for_order(order_name: str) -> list[dict]:
	names = frappe.get_all(
		"F&B Bill Split", filters={"restaurant_order": order_name}, pluck="name", order_by="creation asc"
	)
	return [_split_dict(frappe.get_doc("F&B Bill Split", n)) for n in names]


# --------------------------------------------------------------------------- #
#  endpoints
# --------------------------------------------------------------------------- #

@frappe.whitelist()
def create_split_plan(order: str, split_type: str, splits: list[dict] | str) -> dict:
	"""Partition an unpaid order into Draft F&B Bill Split records. Re-planning
	is allowed until the first portion is settled; it replaces the Draft plan."""
	_require_permission("F&B Bill Split", "create")
	doc = _order_or_throw(order)
	if doc.state in {"Settled", "Cancelled"}:
		frappe.throw(_("Order {0} is {1}; it cannot be split.").format(order, doc.state))
	if doc.erpnext_sales_invoice or doc.guest_folio:
		frappe.throw(_("Order {0} is already fully settled.").format(order))
	if not doc.items:
		frappe.throw(_("Order {0} has no items to split.").format(order))

	splits = json.loads(splits) if isinstance(splits, str) else splits

	# Reject a re-plan once anything has been settled — you cannot re-slice money
	# that has already posted.
	existing = frappe.get_all(
		"F&B Bill Split", filters={"restaurant_order": order}, fields=["name", "split_status"]
	)
	if any(s.split_status == "Settled" for s in existing):
		frappe.throw(_("Order {0} has settled splits; cancel them before re-planning.").format(order))
	for s in existing:
		frappe.delete_doc("F&B Bill Split", s.name, force=True, ignore_permissions=True)

	resolved = _resolve_portions(doc, split_type, splits)
	currency = doc.currency or "INR"
	created = []
	for idx, r in enumerate(resolved):
		portion = r["portion"]
		mode = portion.get("settlement_mode") or "Direct"
		split_doc = frappe.get_doc(
			{
				"doctype": "F&B Bill Split",
				"restaurant_order": order,
				"split_type": split_type,
				"split_label": portion.get("label") or f"Split {idx + 1}",
				"settlement_mode": mode,
				"room_stay": portion.get("stay") if mode == "Room" else None,
				"customer_name": portion.get("customer_name") if mode == "Direct" else None,
				"portion_pct": flt(portion.get("percentage")) if split_type == "Percentage" else 0,
				"split_status": "Draft",
				"net_amount": r["net_amount"],
				"service_charge_amount": r["service_charge_amount"],
				"tax_amount": r["tax_amount"],
				"grand_total": r["grand_total"],
				"currency": currency,
				"idempotency_key": f"split:{order}:{idx}:{now_datetime().timestamp()}",
				"split_items": r["split_items"],
			}
		)
		split_doc.flags.ignore_permissions = True
		split_doc.insert(ignore_permissions=True)
		created.append(split_doc.name)

	record_audit_event(
		"Restaurant Order", order, "fnb.create_split_plan",
		details={"split_type": split_type, "portions": len(created)},
	)
	return _envelope({"order": order, "splits": _list_for_order(order)})


@frappe.whitelist()
def list_splits(order: str) -> dict:
	_require_permission("F&B Bill Split", "read")
	return _envelope({"order": order, "splits": _list_for_order(order)})


@frappe.whitelist()
def cancel_split_plan(order: str) -> dict:
	"""Discard the Draft plan (only if nothing has settled yet)."""
	_require_permission("F&B Bill Split", "delete")
	rows = frappe.get_all(
		"F&B Bill Split", filters={"restaurant_order": order}, fields=["name", "split_status"]
	)
	if any(r.split_status == "Settled" for r in rows):
		frappe.throw(_("Cannot cancel — order {0} already has settled splits.").format(order))
	for r in rows:
		frappe.delete_doc("F&B Bill Split", r.name, force=True, ignore_permissions=True)
	record_audit_event("Restaurant Order", order, "fnb.cancel_split_plan", details={"removed": len(rows)})
	return _envelope({"order": order, "splits": []})


@frappe.whitelist()
def settle_split(split: str, payments: list[dict] | str | None = None, stay: str | None = None) -> dict:
	"""Settle ONE portion. Direct → Sales Invoice + Payment Entry; Room → folio
	charge lines. When the last open portion settles, the parent order flips to
	Settled and BOM stock is consumed once for the whole order."""
	_require_permission("F&B Bill Split", "write")
	split_doc = frappe.get_doc("F&B Bill Split", split)
	if split_doc.split_status == "Settled":
		return _envelope({"split": _split_dict(split_doc), "reused": True})
	if split_doc.split_status == "Cancelled":
		frappe.throw(_("Split {0} is cancelled.").format(split))

	order = _order_or_throw(split_doc.restaurant_order)
	payments = json.loads(payments) if isinstance(payments, str) else (payments or [])

	if split_doc.settlement_mode == "Room":
		_settle_room(split_doc, order, stay or split_doc.room_stay)
	else:
		_settle_direct(split_doc, order, payments)

	split_doc.split_status = "Settled"
	split_doc.settled_at = now_datetime()
	split_doc.flags.ignore_permissions = True
	split_doc.save(ignore_permissions=True)
	record_audit_event(
		"F&B Bill Split", split_doc.name, "fnb.settle_split",
		details={
			"order": order.name,
			"mode": split_doc.settlement_mode,
			"sales_invoice": split_doc.erpnext_sales_invoice,
			"guest_folio": split_doc.guest_folio,
			"grand_total": flt(split_doc.grand_total),
		},
	)

	finalized = _finalize_if_complete(order)
	return _envelope(
		{"split": _split_dict(split_doc), "order_settled": finalized, "splits": _list_for_order(order.name)}
	)


# --------------------------------------------------------------------------- #
#  settlement helpers
# --------------------------------------------------------------------------- #

def _ensure_split_charge_item() -> str:
	"""Generic non-stock revenue item for Amount/Percentage split lines that
	carry no item detail."""
	if not frappe.db.exists("Item", SPLIT_CHARGE_ITEM_CODE):
		frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": SPLIT_CHARGE_ITEM_CODE,
				"item_name": "F&B Split Share",
				"item_group": frappe.db.get_value("Item Group", {"parent_item_group": "All Item Groups"}, "name")
				or "Services",
				"stock_uom": "Nos",
				"is_stock_item": 0,
				"is_sales_item": 1,
				"is_purchase_item": 0,
			}
		).insert(ignore_permissions=True)
	return SPLIT_CHARGE_ITEM_CODE


def _split_invoice_lines(split_doc, order) -> list[dict]:
	"""Build the ERPNext line set for a split — itemized rows for Item/Seat/
	Custom, a single proportional line for Amount/Percentage — plus the
	apportioned service charge."""
	lines = []
	if split_doc.split_items:
		for row in split_doc.split_items:
			erp_item = frappe.db.get_value("Menu Item", row.menu_item, "erpnext_item") or _ensure_erpnext_item_for_menu(
				row.menu_item
			)
			lines.append(
				{"item_code": erp_item, "qty": flt(row.qty), "rate": flt(row.rate), "description": row.item_name}
			)
	else:
		lines.append(
			{
				"item_code": _ensure_split_charge_item(),
				"qty": 1,
				"rate": flt(split_doc.net_amount),
				"description": _("{0} — split share of order {1}").format(
					split_doc.split_label or split_doc.name, order.name
				),
			}
		)
	if flt(split_doc.service_charge_amount) > 0:
		lines.append(
			{
				"item_code": _ensure_service_charge_item(),
				"qty": 1,
				"rate": flt(split_doc.service_charge_amount),
				"description": _("Service charge ({0}%)").format(flt(order.service_charge_pct)),
			}
		)
	return lines


def _settle_direct(split_doc, order, payments: list[dict]) -> None:
	from the_reezort.billing.erpnext_posting import (
		build_and_submit_sales_invoice,
		create_payment_entry_for_invoice,
	)

	company = frappe.db.get_value("Resort Property", order.resort_property, "company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)
	outlet_template = frappe.db.get_value("FnB Outlet", order.outlet, "default_tax_template")
	with _as_admin():
		customer = frappe.db.get_value("Customer", {"customer_name": "Walk-in Guest"}, "name")
		if not customer:
			customer = frappe.get_doc(
				{
					"doctype": "Customer",
					"customer_name": "Walk-in Guest",
					"customer_group": "Individual",
					"territory": "All Territories",
				}
			).insert(ignore_permissions=True).name

		sales_invoice = build_and_submit_sales_invoice(
			company=company,
			customer=customer,
			currency=split_doc.currency or "INR",
			lines=_split_invoice_lines(split_doc, order),
			taxes_template=outlet_template,
			remarks=_("Split {0} of Restaurant Order {1} · {2}").format(
				split_doc.split_label or split_doc.name, order.name, split_doc.customer_name or ""
			),
		)

		remaining = flt(sales_invoice.rounded_total) or flt(sales_invoice.grand_total)
		first_pe = None
		for payment in payments:
			if remaining <= 0:
				break
			pay_amount = min(flt(payment.get("amount")) or remaining, remaining)
			if pay_amount <= 0:
				continue
			pe = create_payment_entry_for_invoice(
				sales_invoice=sales_invoice.name,
				amount=pay_amount,
				mode_of_payment=payment.get("mode_of_payment") or "Cash",
				reference_no=payment.get("reference_no") or sales_invoice.name,
			)
			first_pe = first_pe or pe
			remaining -= pay_amount

	split_doc.erpnext_sales_invoice = sales_invoice.name
	if first_pe:
		split_doc.erpnext_payment_entry = first_pe


def _settle_room(split_doc, order, stay: str | None) -> None:
	if not stay:
		frappe.throw(_("Split {0} is Room-billed but no stay was provided.").format(split_doc.name))
	stay_row = frappe.db.get_value("Stay", stay, ["name", "stay_status", "customer"], as_dict=True)
	if not stay_row:
		frappe.throw(_("Unknown stay: {0}").format(stay))
	if stay_row.stay_status != "In House":
		frappe.throw(_("Room posting needs an in-house stay (stay is {0}).").format(stay_row.stay_status))

	from the_reezort.billing.api import get_or_create_folio

	folio = get_or_create_folio(stay=stay, customer=stay_row.customer)["data"]["folio"]["name"]
	folio_status = frappe.db.get_value("Guest Folio", folio, "folio_status")
	if folio_status in {"Settled", "Closed", "Cancelled", "Transferred"}:
		frappe.throw(_("Cannot charge to room — folio {0} is {1}.").format(folio, folio_status))

	with _as_admin():
		if split_doc.split_items:
			for row in split_doc.split_items:
				erp_item = frappe.db.get_value(
					"Menu Item", row.menu_item, "erpnext_item"
				) or _ensure_erpnext_item_for_menu(row.menu_item)
				frappe.get_doc(
					{
						"doctype": "Folio Line",
						"guest_folio": folio,
						"line_type": "Charge",
						"source_module": "Restaurant",
						"source_doctype": "F&B Bill Split",
						"source_name": split_doc.name,
						"source_row_id": row.name,
						"idempotency_key": f"fnb-split:{split_doc.name}:{row.name}",
						"service_date": today(),
						"item_code": erp_item,
						"description": f"{flt(row.qty)} × {row.item_name} · {order.outlet} (split)",
						"qty": flt(row.qty),
						"rate": flt(row.rate),
						"amount": flt(row.qty) * flt(row.rate),
						"tax_treatment": "Standard",
					}
				).insert(ignore_permissions=True)
		else:
			frappe.get_doc(
				{
					"doctype": "Folio Line",
					"guest_folio": folio,
					"line_type": "Charge",
					"source_module": "Restaurant",
					"source_doctype": "F&B Bill Split",
					"source_name": split_doc.name,
					"idempotency_key": f"fnb-split:{split_doc.name}:share",
					"service_date": today(),
					"item_code": _ensure_split_charge_item(),
					"description": _("{0} — split share of order {1}").format(
						split_doc.split_label or split_doc.name, order.name
					),
					"qty": 1,
					"rate": flt(split_doc.net_amount),
					"amount": flt(split_doc.net_amount),
					"tax_treatment": "Standard",
				}
			).insert(ignore_permissions=True)

		if flt(split_doc.service_charge_amount) > 0:
			frappe.get_doc(
				{
					"doctype": "Folio Line",
					"guest_folio": folio,
					"line_type": "Charge",
					"source_module": "Restaurant",
					"source_doctype": "F&B Bill Split",
					"source_name": split_doc.name,
					"idempotency_key": f"fnb-split:{split_doc.name}:service",
					"service_date": today(),
					"item_code": _ensure_service_charge_item(),
					"description": _("Service charge ({0}%)").format(flt(order.service_charge_pct)),
					"qty": 1,
					"rate": flt(split_doc.service_charge_amount),
					"amount": flt(split_doc.service_charge_amount),
					"tax_treatment": "Standard",
				}
			).insert(ignore_permissions=True)

	split_doc.guest_folio = folio


def _finalize_if_complete(order) -> bool:
	"""If every split for the order is Settled, mark the order Settled and
	consume BOM stock once for the whole order. Returns True when it finalizes."""
	statuses = frappe.get_all(
		"F&B Bill Split", filters={"restaurant_order": order.name}, pluck="split_status"
	)
	if not statuses or any(s != "Settled" for s in statuses):
		return False
	if order.state == "Settled":
		return True

	company = frappe.db.get_value("Resort Property", order.resort_property, "company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)
	with _as_admin():
		from the_reezort.fnb.consumption import consume_for_order
		from the_reezort.fnb.warehouse_seed import warehouse_for_outlet

		warehouse = warehouse_for_outlet(order.outlet, company=company)
		if warehouse:
			consume_for_order(
				warehouse=warehouse,
				order_items=[
					{"menu_item": it.menu_item, "quantity": it.quantity, "item_name": it.item_name}
					for it in order.items
				],
				remarks=f"F&B split settlement {order.name}",
				company=company,
			)

	order.state = "Settled"
	order.settled_at = now_datetime()
	order.flags.ignore_permissions = True
	order.save(ignore_permissions=True)
	record_audit_event(
		"Restaurant Order", order.name, "fnb.split_finalized",
		details={"splits": len(statuses)},
	)
	return True
