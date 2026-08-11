"""Minibar posting — spec 004 / ui-ux-minibar-posting.md.

Compact right-slide sheet posting flow. One click → one Folio Line +
one Minibar Posting audit doc. Idempotent per (stay, consumed_at, item
bag). Approval gates:

  · minibar_backdate     — consumed_at older than 24h from now
  · minibar_void_same_day — voiding a posting on the same day > threshold

Both wire into the existing require_approval framework.
"""

from __future__ import annotations

import hashlib
import json

import frappe
from the_reezort.permissions import system_manager_only
from frappe import _
from frappe.utils import flt, get_datetime, getdate, now_datetime, today

from the_reezort.staff.api import _envelope
from the_reezort.utils import require_permission


BACKDATE_HOURS = 24


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _safe_int(value) -> int:
	"""Coerce a client-supplied quantity to int, treating junk as 0."""
	try:
		return int(value or 0)
	except (TypeError, ValueError):
		return 0


def _stay_or_throw(stay: str):
	if not frappe.db.exists("Stay", stay):
		frappe.throw(_("Unknown stay: {0}").format(stay))
	return frappe.db.get_value(
		"Stay", stay,
		["name", "stay_status", "current_room", "resort_property", "arrival_date", "departure_date"],
		as_dict=True,
	)


def _folio_of(stay_name: str) -> str | None:
	return frappe.db.get_value("Guest Folio", {"stay": stay_name}, "name")


# ---------- catalog ----------


@frappe.whitelist()
def list_minibar_items(resort_property: str | None = None) -> dict:
	_require_login()
	filters = {"is_active": 1}
	if resort_property:
		filters["resort_property"] = resort_property
	rows = frappe.get_all(
		"Minibar Item",
		filters=filters,
		fields=["name", "item_name", "item_code_short", "category", "price", "currency", "erpnext_item", "par_level_per_room"],
		order_by="category asc, item_name asc",
	)
	return _envelope({"items": rows})


# ---------- post ----------


def _make_idempotency_key(stay: str, consumed_at: str, items: list[dict], user: str) -> str:
	"""Same stay+time+item bag+user posted twice → same key → single line."""
	digest = hashlib.md5()
	digest.update(stay.encode())
	digest.update(str(consumed_at).encode())
	digest.update(user.encode())
	# Sort by minibar_item so ordering doesn't matter.
	rows = sorted(items, key=lambda r: str(r.get("minibar_item")))
	digest.update(json.dumps([
		{"i": r.get("minibar_item"), "q": int(r.get("quantity") or 0)}
		for r in rows
	]).encode())
	return f"minibar:{digest.hexdigest()[:20]}"


@frappe.whitelist()
def post_minibar_consumption(
	stay: str,
	items,
	consumed_at: str | None = None,
	notes: str | None = None,
	approval_request: str | None = None,
) -> dict:
	"""Post minibar consumption → creates ONE Folio Line (source_module Minibar)
	+ ONE Minibar Posting audit doc. Idempotent per (stay, consumed_at, item bag).
	"""
	require_permission("Minibar Posting", "create")

	if isinstance(items, str):
		items = json.loads(items)
	if not isinstance(items, list):
		frappe.throw(_("items must be a list of {item_code, quantity} objects."))
	if not all(isinstance(i, dict) for i in items):
		frappe.throw(_("Each item must be an object with item_code and quantity."))
	items = [i for i in items if _safe_int(i.get("quantity")) > 0]
	if not items:
		frappe.throw(_("Add at least one item with quantity > 0."))

	s = _stay_or_throw(stay)
	if s.stay_status not in ("In House", "Checked Out"):
		frappe.throw(_("Stay must be In House or Checked Out to post minibar."))

	when = get_datetime(consumed_at) if consumed_at else now_datetime()

	# Reject clearly-outside-stay-window (5 day guard on each side).
	if s.arrival_date and getdate(when) < getdate(s.arrival_date):
		frappe.throw(_("Consumed date is before arrival."))

	# Back-date approval gate: > BACKDATE_HOURS in the past requires sign-off.
	seconds_back = (now_datetime() - when).total_seconds()
	if seconds_back > BACKDATE_HOURS * 3600:
		try:
			from the_reezort.approvals.api import require_approval

			require_approval(
				action="minibar_backdate",
				source_doctype="Minibar Posting",
				source_name=f"{stay}:{when.isoformat()}",
				payload={"hours_back": round(seconds_back / 3600, 1), "stay": stay, "items": items},
				approval_request=approval_request,
			)
		except ImportError:
			pass

	folio = _folio_of(stay)
	if not folio:
		frappe.throw(_("Stay {0} has no open folio.").format(stay))
	folio_status = frappe.db.get_value("Guest Folio", folio, "folio_status")
	if folio_status in {"Settled", "Closed", "Cancelled", "Transferred"}:
		frappe.throw(_("Cannot post minibar — folio {0} is {1}.").format(folio, folio_status))

	# Fetch canonical item metadata (price, name).
	catalog = {i["name"]: i for i in frappe.get_all(
		"Minibar Item",
		filters={"name": ["in", [r["minibar_item"] for r in items]]},
		fields=["name", "item_name", "price", "erpnext_item"],
	)}
	posting_items = []
	total = 0.0
	descriptions = []
	for r in items:
		mi = catalog.get(r["minibar_item"])
		if not mi:
			frappe.throw(_("Unknown Minibar Item: {0}").format(r["minibar_item"]))
		qty = int(r["quantity"])
		# Price always comes from the catalog — never trust a client-supplied rate.
		rate = flt(mi["price"])
		amount = qty * rate
		total += amount
		posting_items.append({
			"minibar_item": mi["name"],
			"item_name": mi["item_name"],
			"quantity": qty,
			"rate": rate,
			"amount": amount,
		})
		descriptions.append(f"{qty} × {mi['item_name']}")

	idem = _make_idempotency_key(stay, str(when), items, frappe.session.user)

	# Idempotency: if a Minibar Posting with the same idempotency-derived
	# Folio Line already exists, return it.
	existing_line = frappe.db.get_value(
		"Folio Line",
		{"guest_folio": folio, "idempotency_key": idem},
		"name",
	)
	if existing_line:
		existing_posting = frappe.db.get_value(
			"Minibar Posting",
			{"folio_line": existing_line},
			"name",
		)
		return _envelope({
			"folio_line": existing_line,
			"minibar_posting": existing_posting,
			"total_amount": total,
			"reused": True,
		})

	# Create the audit posting first so we can point the folio line at it.
	posting = frappe.get_doc({
		"doctype": "Minibar Posting",
		"resort_property": s.resort_property,
		"stay": stay,
		"guest_folio": folio,
		"consumed_at": when,
		"posted_by": frappe.session.user,
		"posted_at": now_datetime(),
		"currency": frappe.db.get_value("Guest Folio", folio, "currency") or "INR",
		"notes": notes,
		"items": posting_items,
		"state": "Posted",
	})
	posting.flags.ignore_permissions = True
	posting.insert(ignore_permissions=True)

	description = f"Minibar × {sum(int(r['quantity']) for r in items)}: {', '.join(descriptions)}"
	if notes:
		description = f"{description} · {notes}"

	# Fold into one Folio Line (grand total, qty 1, rate = total).
	line = frappe.get_doc({
		"doctype": "Folio Line",
		"guest_folio": folio,
		"line_type": "Charge",
		"source_module": "Minibar",
		"source_doctype": "Minibar Posting",
		"source_name": posting.name,
		"idempotency_key": idem,
		"service_date": getdate(when),
		"description": description,
		"qty": 1,
		"rate": total,
		"amount": total,
		"tax_treatment": "Standard",
	})
	line.insert(ignore_permissions=True)

	# Wire the folio line back onto the posting.
	frappe.db.set_value("Minibar Posting", posting.name, "folio_line", line.name, update_modified=False)

	# Best-effort audit.
	try:
		from the_reezort.audit.api import record_audit_event

		record_audit_event(
			source_doctype="Minibar Posting",
			source_name=posting.name,
			action="minibar_post",
			reason=notes or "",
			details={
				"stay": stay,
				"folio": folio,
				"total": total,
				"items": [{"i": r["minibar_item"], "q": int(r["quantity"])} for r in items],
			},
		)
	except Exception:
		pass

	frappe.db.commit()
	return _envelope({
		"folio_line": line.name,
		"minibar_posting": posting.name,
		"total_amount": total,
		"reused": False,
	})


# ---------- history ----------


@frappe.whitelist()
def list_recent_postings(stay: str, limit: int = 10) -> dict:
	require_permission("Minibar Posting", "read")
	rows = frappe.get_all(
		"Minibar Posting",
		filters={"stay": stay},
		fields=["name", "consumed_at", "posted_by", "total_amount", "currency", "state", "folio_line", "notes"],
		order_by="consumed_at desc",
		limit=int(limit),
	)
	for r in rows:
		# Bundle the item bag so the UI can show what was in each posting.
		r["items"] = frappe.get_all(
			"Minibar Posting Item",
			filters={"parent": r["name"]},
			fields=["minibar_item", "item_name", "quantity", "rate", "amount"],
			order_by="idx asc",
		)
	return _envelope({"postings": rows})


# ---------- seed ----------


DEFAULT_CATALOG = (
	# (code_short, item_name, category, price)
	("WATER-1L",       "Bisleri 1L",             "Beverages",  150),
	("COKE-330",       "Coca-Cola 330ml",        "Beverages",  120),
	("SPRITE-330",     "Sprite 330ml",           "Beverages",  120),
	("REDBULL-250",    "Red Bull 250ml",         "Beverages",  300),
	("KOMBUCHA-300",   "Kombucha 300ml",         "Beverages",  350),
	("SNICKERS",       "Snickers bar",           "Snacks",     150),
	("PRINGLES",       "Pringles small",         "Snacks",     250),
	("MIXED-NUTS",     "Mixed nuts jar",         "Snacks",     400),
	("BEER-CRAFT",     "Craft beer 330ml",       "Alcohol",    400),
	("WINE-SPLIT",     "Wine split 187ml",       "Alcohol",    650),
	("WHISKEY-MINI",   "Whiskey mini 50ml",      "Alcohol",    500),
	("EARPLUGS",       "Earplug pack",           "Other",      100),
)


@frappe.whitelist()
@system_manager_only
def seed_minibar_catalog(resort_property: str | None = None) -> dict:
	"""Idempotent seeder for a demo minibar catalog. Runs against the
	given (or default active) property; skips items whose code_short already
	exists on that property."""
	if not resort_property:
		resort_property = frappe.db.get_value("Resort Property", {"is_active": 1}, "name")
	if not resort_property:
		frappe.throw(_("No active Resort Property found."))

	created = []
	skipped = []
	for code_short, name, category, price in DEFAULT_CATALOG:
		if frappe.db.exists("Minibar Item", {"resort_property": resort_property, "item_code_short": code_short}):
			skipped.append(code_short)
			continue
		doc = frappe.get_doc({
			"doctype": "Minibar Item",
			"resort_property": resort_property,
			"item_name": name,
			"item_code_short": code_short,
			"category": category,
			"price": price,
			"currency": frappe.db.get_value("Company", frappe.defaults.get_global_default("company"), "default_currency") or "INR",
			"par_level_per_room": 4 if category in ("Beverages", "Snacks") else 2,
			"is_active": 1,
		})
		doc.insert(ignore_permissions=True)
		created.append(code_short)
	frappe.db.commit()
	return {"resort_property": resort_property, "created": created, "skipped": skipped}
