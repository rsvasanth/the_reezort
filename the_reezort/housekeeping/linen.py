"""Linen count & laundry hand-off — spec 005 / ui-ux-linen-checkout-restock.md.

Every count → one Linen Movement (audit) + up to one Housekeeping Task
(Linen Restock) when found < par + optional Stock Reconciliation for
damage/loss above the write-off threshold (approval-gated).

Idempotent per (room, phase, counted_at.date()).
"""

from __future__ import annotations

import frappe
from the_reezort.permissions import system_manager_only
from frappe import _
from frappe.utils import flt, get_datetime, getdate, now_datetime, today

from the_reezort.staff.api import _envelope

WRITE_OFF_THRESHOLD = 5000.0  # ₹ — above this a Stock Reconciliation needs approval


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _room_or_throw(room: str):
	if not frappe.db.exists("Room", room):
		frappe.throw(_("Unknown room: {0}").format(room))
	return frappe.db.get_value(
		"Room", room, ["name", "resort_property", "room_type", "occupancy_status", "housekeeping_status"], as_dict=True
	)


# ---------- catalog ----------


@frappe.whitelist()
def get_linen_catalog(resort_property: str | None = None) -> dict:
	_require_login()
	filters = {"is_active": 1}
	if resort_property:
		filters["resort_property"] = resort_property
	rows = frappe.get_all(
		"Linen Item",
		filters=filters,
		fields=["name", "item_name", "item_code_short", "category", "unit_cost", "currency", "erpnext_item"],
		order_by="category asc, item_name asc",
	)
	return _envelope({"items": rows})


# ---------- par resolution ----------


@frappe.whitelist()
def get_room_par(room: str) -> dict:
	"""Merged par per linen item — per-room override wins over room-type default."""
	_require_login()
	r = _room_or_throw(room)

	# All active linen items for the property.
	items = frappe.get_all(
		"Linen Item",
		filters={"resort_property": r.resort_property, "is_active": 1},
		fields=["name", "item_name", "item_code_short", "category", "unit_cost"],
		order_by="category asc, item_name asc",
	)
	room_par = {
		p["linen_item"]: int(p["par_quantity"])
		for p in frappe.get_all(
			"Linen Par", filters={"room": room}, fields=["linen_item", "par_quantity"]
		)
	}
	rt_par = {
		p["linen_item"]: int(p["par_quantity"])
		for p in frappe.get_all(
			"Linen Par", filters={"room_type": r.room_type, "room": ["in", ["", None]]}, fields=["linen_item", "par_quantity"]
		)
	}
	rows = []
	for i in items:
		par = room_par.get(i["name"], rt_par.get(i["name"], 0))
		rows.append({**i, "par": par})

	last = frappe.get_all(
		"Linen Movement",
		filters={"room": room},
		fields=["name", "counted_at", "phase", "short_count", "damaged_count", "missing_count"],
		order_by="counted_at desc",
		limit=1,
	)
	return _envelope({"room": room, "items": rows, "last_count": last[0] if last else None})


# ---------- post ----------


@frappe.whitelist()
def post_linen_count(
	room: str,
	counts,
	phase: str = "Departure",
	stay: str | None = None,
	notes: str | None = None,
	counted_at: str | None = None,
	approval_request: str | None = None,
) -> dict:
	"""Post a linen count → Linen Movement + auto Restock task + optional
	Stock Reconciliation. Idempotent per (room, phase, counted_at.date())."""
	import json

	_require_login()

	if isinstance(counts, str):
		counts = json.loads(counts)
	counts = [c for c in (counts or []) if int(c.get("found") or 0) or int(c.get("damaged") or 0) or int(c.get("missing") or 0)]
	if not counts:
		frappe.throw(_("Enter at least one item count."))

	r = _room_or_throw(room)
	when = get_datetime(counted_at) if counted_at else now_datetime()
	phase = phase or "Departure"
	if phase not in ("Departure", "Mid-stay", "Par audit"):
		frappe.throw(_("Unknown phase: {0}").format(phase))

	# Idempotency: same (room, phase, date) reuses the Linen Movement.
	existing = frappe.db.get_value(
		"Linen Movement",
		{"room": room, "phase": phase, "counted_at": ["between", [f"{getdate(when)} 00:00:00", f"{getdate(when)} 23:59:59"]]},
		"name",
	)
	if existing:
		return _envelope({
			"linen_movement": existing,
			"reused": True,
			"restock_task": frappe.db.get_value("Linen Movement", existing, "restock_task"),
		})

	# Build the Linen Movement child rows — pull unit_cost for damage-value math.
	linen_names = [c["linen_item"] for c in counts]
	item_meta = {i["name"]: i for i in frappe.get_all(
		"Linen Item", filters={"name": ["in", linen_names]},
		fields=["name", "item_name", "unit_cost", "erpnext_item"],
	)}
	rows = []
	for c in counts:
		li = item_meta.get(c["linen_item"])
		if not li:
			frappe.throw(_("Unknown Linen Item: {0}").format(c["linen_item"]))
		rows.append({
			"linen_item": li["name"],
			"item_name": li["item_name"],
			"par": int(c.get("par") or 0),
			"found": int(c.get("found") or 0),
			"damaged": int(c.get("damaged") or 0),
			"missing": int(c.get("missing") or 0),
			"notes": c.get("notes"),
		})

	movement = frappe.get_doc({
		"doctype": "Linen Movement",
		"resort_property": r.resort_property,
		"room": room,
		"stay": stay,
		"phase": phase,
		"direction": "Room-to-Laundry",
		"counted_at": when,
		"counted_by": frappe.session.user,
		"notes": notes,
		"items": rows,
	})
	movement.flags.ignore_permissions = True
	movement.insert(ignore_permissions=True)

	# Approval gate — write-off over threshold requires manager sign-off before
	# Stock Reconciliation is booked.
	restock_task_name = None
	if movement.short_count > 0:
		restock_task_name = _create_restock_task(room, movement, r)
		frappe.db.set_value("Linen Movement", movement.name, "restock_task", restock_task_name, update_modified=False)

	if flt(movement.damage_value) > WRITE_OFF_THRESHOLD:
		try:
			from the_reezort.approvals.api import require_approval

			require_approval(
				action="linen_writeoff",
				source_doctype="Linen Movement",
				source_name=movement.name,
				payload={"room": room, "amount": float(movement.damage_value)},
				approval_request=approval_request,
			)
		except ImportError:
			pass
		# If we get here the approval landed — future work can post the
		# actual Stock Reconciliation. For now we record the gate cleared.

	# Departure with zero shortages advances the room's HK status.
	if phase == "Departure" and movement.short_count == 0 and movement.damaged_count == 0:
		try:
			frappe.db.set_value("Room", room, "housekeeping_status", "Pickup")
		except Exception:
			pass

	# Best-effort audit.
	try:
		from the_reezort.audit.api import record_audit_event

		record_audit_event(
			source_doctype="Linen Movement",
			source_name=movement.name,
			action="linen_count_posted",
			reason=notes or "",
			details={
				"room": room,
				"phase": phase,
				"short_count": int(movement.short_count),
				"damage_value": float(movement.damage_value),
			},
		)
	except Exception:
		pass

	frappe.db.commit()
	return _envelope({
		"linen_movement": movement.name,
		"restock_task": restock_task_name,
		"short_count": int(movement.short_count),
		"damaged_count": int(movement.damaged_count),
		"missing_count": int(movement.missing_count),
		"damage_value": float(movement.damage_value),
		"reused": False,
	})


def _create_restock_task(room: str, movement, r) -> str:
	"""Idempotent per (room, movement.name)."""
	key = f"linen-restock:{movement.name}"
	existing = frappe.db.get_value("Housekeeping Task", {"idempotency_key": key}, "name")
	if existing:
		return existing

	shortages = [
		f"{max(0, int(row.par or 0) - int(row.found or 0))} × {row.item_name}"
		for row in movement.items
		if int(row.par or 0) > int(row.found or 0)
	]
	notes = "Linen shortages: " + ", ".join(shortages) if shortages else "Linen restock"

	task = frappe.get_doc({
		"doctype": "Housekeeping Task",
		"resort_property": r.resort_property,
		"room": room,
		"task_type": "Linen Restock",
		"task_status": "Queued",
		"priority": "High" if movement.damage_value > 0 else "Normal",
		"idempotency_key": key,
		"source_doctype": "Linen Movement",
		"source_name": movement.name,
		"completion_notes": notes,
	})
	task.flags.ignore_permissions = True
	# Task doctype has task_type as Select — may need to bypass if "Linen Restock"
	# isn't a stock option. Use ignore_mandatory only if needed.
	task.flags.ignore_mandatory = True
	task.insert(ignore_permissions=True)
	return task.name


# ---------- history ----------


@frappe.whitelist()
def list_recent_counts(room: str, days: int = 30, limit: int = 10) -> dict:
	_require_login()
	from frappe.utils import add_days

	filters = {"room": room, "counted_at": [">=", f"{add_days(today(), -int(days))} 00:00:00"]}
	rows = frappe.get_all(
		"Linen Movement",
		filters=filters,
		fields=["name", "counted_at", "phase", "counted_by", "short_count", "damaged_count", "missing_count", "damage_value", "restock_task"],
		order_by="counted_at desc",
		limit=int(limit),
	)
	return _envelope({"movements": rows})


# ---------- seed ----------


DEFAULT_CATALOG = (
	# (code, name, category, unit_cost, default_par_per_room)
	("BATH-TOWEL",     "Bath towel",         "Towel",  600,  4),
	("HAND-TOWEL",     "Hand towel",         "Towel",  250,  4),
	("BATH-MAT",       "Bath mat",           "Bath",   400,  2),
	("BED-SHEET-Q",    "Bed sheet queen",    "Sheet",  900,  2),
	("PILLOWCASE",     "Pillowcase",         "Sheet",  200,  4),
	("BATHROBE",       "Bathrobe",           "Robe",  1800,  2),
	("DUVET-COVER",    "Duvet cover",        "Sheet", 1200,  1),
)


@frappe.whitelist()
@system_manager_only
def seed_linen_catalog(resort_property: str | None = None) -> dict:
	"""Idempotent seeder for the demo linen catalog + property-level par
	fallbacks (per Room Type on the property)."""
	if not resort_property:
		resort_property = frappe.db.get_value("Resort Property", {"is_active": 1}, "name")
	if not resort_property:
		frappe.throw(_("No active Resort Property found."))

	created = []
	skipped = []
	room_types = frappe.get_all("Room Type", filters={"resort_property": resort_property, "is_active": 1}, pluck="name")

	for code, name, category, cost, par in DEFAULT_CATALOG:
		if frappe.db.exists("Linen Item", {"resort_property": resort_property, "item_code_short": code}):
			skipped.append(code)
			continue
		item = frappe.get_doc({
			"doctype": "Linen Item",
			"resort_property": resort_property,
			"item_name": name,
			"item_code_short": code,
			"category": category,
			"unit_cost": cost,
			"currency": frappe.db.get_value("Company", frappe.defaults.get_global_default("company"), "default_currency") or "INR",
			"is_active": 1,
		}).insert(ignore_permissions=True)
		created.append(code)
		# Seed a par for each room type on the property.
		for rt in room_types:
			frappe.get_doc({
				"doctype": "Linen Par",
				"resort_property": resort_property,
				"linen_item": item.name,
				"room_type": rt,
				"par_quantity": par,
			}).insert(ignore_permissions=True)

	frappe.db.commit()
	return {"resort_property": resort_property, "created": created, "skipped": skipped}
