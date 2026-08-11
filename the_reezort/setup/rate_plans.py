"""Whitelisted CRUD for Rate Plan / Season / Package (spec 002).

Kept small and typed to avoid re-inventing management.py's full machinery.
The SPA's Property Management "Pricing" tab drives all of this.
"""

import frappe
from frappe import _

from the_reezort.setup.api import _as_dict, _clean, _envelope, _require_permission

# Fields a caller may set through upsert_*. Identity fields (resort_property,
# code — which together derive `name`) and framework fields (name, owner,
# docstatus, doctype, ...) are deliberately excluded: they must never come
# from an unfiltered client payload.
_EDITABLE = {
	"Rate Plan": [
		"plan_name", "is_active", "refundable", "cancellation_hours",
		"room_type", "currency", "base_rate_override", "weekend_uplift_pct", "notes",
	],
	"Season": [
		"season_name", "priority", "is_active",
		"start_date", "end_date", "modifier_pct", "absolute_rate", "notes",
	],
	"Package": [
		"package_name", "nights", "is_active", "room_type", "linked_rate_plan",
		"package_price", "currency", "valid_from", "valid_to", "notes",
	],
}


def _list_docs(doctype, resort_property, fields):
	filters = {}
	if resort_property:
		filters["resort_property"] = resort_property
	return frappe.get_all(doctype, filters=filters, fields=fields, order_by="code asc")


@frappe.whitelist()
def list_pricing(resort_property=None):
	"""One read for all three tabs — list Rate Plans + Seasons + Packages."""
	_require_permission("Rate Plan", "read")
	rate_plans = _list_docs(
		"Rate Plan",
		resort_property,
		["name", "code", "plan_name", "room_type", "base_rate_override", "weekend_uplift_pct", "refundable", "cancellation_hours", "is_active"],
	)
	seasons = _list_docs(
		"Season",
		resort_property,
		["name", "code", "season_name", "start_date", "end_date", "modifier_pct", "absolute_rate", "priority", "is_active"],
	)
	packages = _list_docs(
		"Package",
		resort_property,
		["name", "code", "package_name", "nights", "room_type", "package_price", "valid_from", "valid_to", "is_active"],
	)
	for p in packages:
		inclusions = frappe.get_all(
			"Package Inclusion",
			filters={"parent": p.name, "parenttype": "Package"},
			fields=["inclusion_name", "quantity"],
			order_by="idx asc",
		)
		p["inclusions"] = inclusions
		p["inclusions_summary"] = " + ".join(i.inclusion_name for i in inclusions) if inclusions else ""
	return _envelope({"rate_plans": rate_plans, "seasons": seasons, "packages": packages})


def _upsert(doctype, payload, upper_code=True):
	payload = _as_dict(payload)
	code = _clean(payload.get("code"))
	if not code:
		frappe.throw(_("Code is required."))
	if upper_code:
		code = code.upper()
	resort_property = payload.get("resort_property")
	if not resort_property:
		frappe.throw(_("Resort Property is required."))

	editable = _EDITABLE.get(doctype, [])
	name = f"{resort_property}-{code}"
	if frappe.db.exists(doctype, name):
		doc = frappe.get_doc(doctype, name)
		for field in editable:
			if field in payload:
				value = payload[field]
				doc.set(field, _clean(value) if isinstance(value, str) else value)
		doc.save(ignore_permissions=True)
		reused = True
	else:
		values = {field: payload[field] for field in editable if field in payload}
		doc = frappe.get_doc({
			"doctype": doctype,
			"resort_property": resort_property,
			"code": code,
			**values,
		})
		doc.insert(ignore_permissions=True)
		reused = False
	return doc, reused


@frappe.whitelist()
def upsert_rate_plan(payload):
	_require_permission("Rate Plan", "write")
	doc, reused = _upsert("Rate Plan", payload)
	return _envelope({"rate_plan": doc.name, "reused": reused})


@frappe.whitelist()
def upsert_season(payload):
	_require_permission("Season", "write")
	doc, reused = _upsert("Season", payload)
	return _envelope({"season": doc.name, "reused": reused})


@frappe.whitelist()
def upsert_package(payload):
	_require_permission("Package", "write")
	payload = _as_dict(payload)
	inclusions = payload.pop("inclusions", None) or []
	doc, reused = _upsert("Package", payload)
	# Replace inclusions.
	doc.set("inclusions", [])
	for row in inclusions:
		row = _as_dict(row)
		if not row.get("inclusion_name"):
			continue
		doc.append("inclusions", {"inclusion_name": row.get("inclusion_name"), "quantity": row.get("quantity") or 1, "notes": row.get("notes")})
	doc.save(ignore_permissions=True)
	return _envelope({"package": doc.name, "reused": reused})


@frappe.whitelist()
def set_pricing_active(doctype, name, is_active):
	if doctype not in {"Rate Plan", "Season", "Package"}:
		frappe.throw(_("{0} is not a pricing doctype.").format(doctype))
	_require_permission(doctype, "write")
	active = 1 if str(is_active) in ("1", "true", "True") else 0
	frappe.db.set_value(doctype, name, "is_active", active)
	return _envelope({"name": name, "is_active": active})


@frappe.whitelist()
def delete_pricing(doctype, name):
	"""Guarded delete — blocked when referenced by a reservation."""
	if doctype not in {"Rate Plan", "Season", "Package"}:
		frappe.throw(_("{0} is not a pricing doctype.").format(doctype))
	_require_permission(doctype, "delete")
	# Reservation refs (fields will land in a later ship — for now, guard is a stub).
	try:
		frappe.delete_doc(doctype, name, ignore_permissions=True)
	except frappe.LinkExistsError:
		frappe.throw(
			_("Cannot delete {0} — referenced elsewhere. Deactivate it instead.").format(name)
		)
	return _envelope({"deleted": name})
