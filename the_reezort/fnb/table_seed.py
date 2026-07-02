"""Restaurant Table seeder — spec 006 · Slice 4.

Idempotent — every outlet on a property gets a small realistic floor plan:
Signature Restaurant + Pool Bar + Cafe each get 8 tables, In-Room Dining
gets zero (it's a virtual outlet, not a floor).
"""

from __future__ import annotations

import frappe


# Per-outlet floor plans. (table_code, table_name, zone, seats, display_order)
FLOOR_PLANS: dict[str, list[tuple[str, str, str, int, int]]] = {
	"SIGREST": [
		("T01", "Window 1",   "Indoor",  4, 10),
		("T02", "Window 2",   "Indoor",  4, 20),
		("T03", "Window 3",   "Indoor",  2, 30),
		("T04", "Booth 1",    "Indoor",  6, 40),
		("T05", "Booth 2",    "Indoor",  6, 50),
		("T06", "Centre 1",   "Indoor",  4, 60),
		("T07", "Chef Table", "Private", 8, 70),
		("T08", "Terrace",    "Outdoor", 4, 80),
	],
	"POOLBAR": [
		("B01", "Poolside 1", "Poolside", 4, 10),
		("B02", "Poolside 2", "Poolside", 4, 20),
		("B03", "Poolside 3", "Poolside", 4, 30),
		("B04", "Poolside 4", "Poolside", 4, 40),
		("B05", "Bar Stool 1", "Bar",     2, 50),
		("B06", "Bar Stool 2", "Bar",     2, 60),
		("B07", "Bar Stool 3", "Bar",     2, 70),
		("B08", "Cabana",      "Private", 6, 80),
	],
	"CAFE": [
		("C01", "Window",    "Indoor", 2, 10),
		("C02", "Bar Front", "Bar",    2, 20),
		("C03", "Bar Mid",   "Bar",    2, 30),
		("C04", "Bar Back",  "Bar",    2, 40),
		("C05", "Corner",    "Indoor", 4, 50),
		("C06", "Patio 1",   "Patio",  2, 60),
		("C07", "Patio 2",   "Patio",  2, 70),
		("C08", "Patio 3",   "Patio",  4, 80),
	],
	# IRD is virtual — no floor plan.
}


@frappe.whitelist()
def seed_restaurant_tables(resort_property: str | None = None) -> dict:
	filters = {"is_active": 1}
	if resort_property:
		filters["resort_property"] = resort_property
	outlets = frappe.get_all(
		"FnB Outlet",
		filters=filters,
		fields=["name", "outlet_code"],
	)

	created = []
	skipped = []
	for outlet in outlets:
		plan = FLOOR_PLANS.get(outlet["outlet_code"])
		if not plan:
			continue
		for code, name, zone, seats, order in plan:
			full_code = f"{outlet['outlet_code']}-{code}"
			if frappe.db.exists("Restaurant Table", full_code):
				skipped.append(full_code)
				continue
			doc = frappe.get_doc(
				{
					"doctype": "Restaurant Table",
					"outlet": outlet["name"],
					"table_code": code,
					"table_name": name,
					"zone": zone,
					"seats": seats,
					"display_order": order,
					"is_active": 1,
				}
			)
			doc.insert(ignore_permissions=True)
			created.append(doc.name)

	frappe.db.commit()
	return {"ok": True, "created": created, "skipped": skipped}
