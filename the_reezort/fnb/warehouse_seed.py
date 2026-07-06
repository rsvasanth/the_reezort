"""F&B outlet warehouse hierarchy — spec 006 · Slice 2.

Structure produced under Company's `F&B Store - TRZ` (which is flipped to
is_group=1 on first run):

    F&B Store - TRZ  (group)
    ├── SIGREST Kitchen Store - TRZ
    ├── POOLBAR Store - TRZ
    ├── CAFE Store - TRZ
    └── IRD Prep - TRZ

Each outlet warehouse becomes the source for the outlet's raw-material
consumption on order settle. Idempotent — safe to re-run.
"""

from __future__ import annotations

import frappe
from the_reezort.permissions import system_manager_only


PER_OUTLET_WAREHOUSES = [
	# (outlet_code, warehouse_name_suffix)
	("SIGREST", "SIGREST Kitchen Store"),
	("POOLBAR", "POOLBAR Store"),
	("CAFE", "CAFE Store"),
	("IRD", "IRD Prep"),
]


def _company_abbr(company: str) -> str:
	return frappe.db.get_value("Company", company, "abbr") or "TRZ"


@frappe.whitelist()
@system_manager_only
def seed_fnb_warehouses(company: str | None = None) -> dict:
	company = company or frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
		"Company", {}, "name"
	)
	if not company:
		return {"ok": False, "reason": "No company configured"}
	abbr = _company_abbr(company)

	# Flip the top-level F&B Store to a group so we can hang outlet stores under it.
	fnb_store = frappe.db.get_value("Warehouse", f"F&B Store - {abbr}", "name")
	if not fnb_store:
		fnb_store = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": "F&B Store",
				"company": company,
				"is_group": 1,
				"parent_warehouse": frappe.db.get_value("Warehouse", {"company": company, "is_group": 1, "warehouse_name": "All Warehouses"}, "name"),
			}
		).insert(ignore_permissions=True).name
	else:
		# Convert leaf → group; safe if nothing has been transacted against it yet.
		# ERPNext refuses this if the warehouse already carries stock ledger entries;
		# if the user has already used it as a stock location, we skip and use it as-is.
		is_group = frappe.db.get_value("Warehouse", fnb_store, "is_group")
		has_ledger = frappe.db.exists("Stock Ledger Entry", {"warehouse": fnb_store})
		if not is_group and not has_ledger:
			doc = frappe.get_doc("Warehouse", fnb_store)
			doc.is_group = 1
			doc.flags.ignore_permissions = True
			doc.save()

	created = []
	existed = []
	for outlet_code, suffix in PER_OUTLET_WAREHOUSES:
		wh_name = f"{suffix} - {abbr}"
		if frappe.db.exists("Warehouse", wh_name):
			existed.append(wh_name)
			continue
		doc = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": suffix,
				"company": company,
				"is_group": 0,
				"parent_warehouse": fnb_store,
			}
		)
		doc.flags.ignore_permissions = True
		doc.insert()
		created.append(doc.name)

	# Pin each FnB Outlet doc to its default warehouse via a custom field-esque set_value
	# — the field is optional so it's stored as a Property Setter if not already there.
	# For now we just return the mapping; the deduction resolver reads it from name convention.

	frappe.db.commit()
	return {
		"ok": True,
		"company": company,
		"fnb_store_group": fnb_store,
		"created": created,
		"existed": existed,
	}


def warehouse_for_outlet(outlet_name: str, company: str | None = None) -> str | None:
	"""Resolve an FnB Outlet doc name to its raw-material warehouse."""
	company = company or frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
		"Company", {}, "name"
	)
	if not company:
		return None
	abbr = _company_abbr(company)
	outlet_code = frappe.db.get_value("FnB Outlet", outlet_name, "outlet_code")
	if not outlet_code:
		return None
	suffix_by_code = {code: name for code, name in PER_OUTLET_WAREHOUSES}
	suffix = suffix_by_code.get(outlet_code)
	if not suffix:
		# Fallback: any outlet without a dedicated warehouse hits the F&B Store parent.
		return frappe.db.get_value("Warehouse", f"F&B Store - {abbr}", "name")
	return frappe.db.get_value("Warehouse", f"{suffix} - {abbr}", "name")
