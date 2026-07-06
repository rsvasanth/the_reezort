"""F&B raw-ingredient catalog + BOM + opening stock seeder — spec 006 · Slice 2.

Ships:
  1. ~35 raw ingredient ERPNext Items (Item Group 'Raw Material', is_stock_item=1,
     with valuation rate and per-Item UOM) — the pantry.
  2. A BOM for each Menu Item linking to the raw ingredients used in the dish,
     with realistic quantities and stock UOMs. Cocktails use spirit + mixer +
     garnish; mains use protein + carb + fat + spices; desserts use base + topping.
  3. Opening stock — a Stock Reconciliation seeds a starting quantity per raw
     item into the appropriate outlet's warehouse so orders can actually
     consume against something (otherwise Stock Entry.submit rejects with
     'negative stock').

Fully idempotent — every step matches by name and no-ops on second run.

Menu items whose BOM is intentionally NOT modeled in this slice (deferred to a
follow-up):
  · Butter Croissant, Chocolate Croissant, New York Cheesecake — the pastry
    section is its own vertical (yeasted vs. baked; buys pre-made vs. in-house).
    They still get an implicit BOM (one 'Pastry - Prepared' unit) so consumption
    tracking works, but the real per-ingredient breakdown is out of scope here.
"""

from __future__ import annotations

import frappe
from the_reezort.permissions import system_manager_only
from frappe.utils import now_datetime


# ---------------------------------------------------------------------------
# Raw ingredient catalog
# ---------------------------------------------------------------------------

# item_code, item_name, uom, valuation_rate (INR per UOM)
RAW_INGREDIENTS: list[tuple[str, str, str, float]] = [
	# Proteins
	("RAW-CHICKEN-BONELESS", "Chicken Breast (Boneless)", "Kg", 320),
	("RAW-CHICKEN-WHOLE",    "Chicken Whole",             "Kg", 210),
	("RAW-LAMB",             "Lamb Curry Cut",            "Kg", 620),
	("RAW-PRAWN",            "Tiger Prawn",               "Kg", 850),
	("RAW-PANEER",           "Fresh Paneer",              "Kg", 380),
	("RAW-EGG",              "Egg",                       "Nos", 8),
	# Grains + carbs
	("RAW-BASMATI-RICE",     "Basmati Rice",              "Kg", 180),
	("RAW-MAIDA",            "Refined Flour (Maida)",     "Kg", 55),
	("RAW-WHEAT-FLOUR",      "Wheat Flour",               "Kg", 45),
	("RAW-POTATO",           "Potato",                    "Kg", 40),
	("RAW-PASTA-BUCATINI",   "Bucatini Pasta",            "Kg", 220),
	# Dairy + fats
	("RAW-BUTTER",           "Unsalted Butter",           "Kg", 480),
	("RAW-CREAM",            "Fresh Cream",               "Litre", 380),
	("RAW-MILK",             "Full-Cream Milk",           "Litre", 68),
	("RAW-CHEESE-MOZ",       "Mozzarella",                "Kg", 620),
	("RAW-OIL-REFINED",      "Refined Oil",               "Litre", 145),
	("RAW-OIL-OLIVE",        "Olive Oil",                 "Litre", 720),
	# Produce
	("RAW-TOMATO",           "Tomato",                    "Kg", 42),
	("RAW-ONION",            "Onion",                     "Kg", 38),
	("RAW-GARLIC",           "Garlic",                    "Kg", 180),
	("RAW-GINGER",           "Ginger",                    "Kg", 220),
	("RAW-LEMON",            "Lemon",                     "Kg", 90),
	("RAW-CORIANDER",        "Coriander Leaves",          "Kg", 60),
	("RAW-MINT",             "Mint Leaves",               "Kg", 110),
	("RAW-LETTUCE",          "Iceberg Lettuce",           "Kg", 140),
	("RAW-CUCUMBER",         "Cucumber",                  "Kg", 45),
	# Fruits
	("RAW-FRUIT-SEASONAL",   "Seasonal Fruit Mix",        "Kg", 180),
	("RAW-COCONUT-FRESH",    "Fresh Coconut",             "Nos", 55),
	("RAW-ORANGE",           "Orange",                    "Kg", 90),
	# Spices + masalas (bulk kitchen)
	("RAW-SPICE-MASALA",     "Whole Spice Mix",           "Kg", 950),
	("RAW-SALT",             "Salt",                      "Kg", 25),
	("RAW-SUGAR",            "Sugar",                     "Kg", 55),
	# Beverages base
	("RAW-COFFEE-BEAN",      "Arabica Coffee Beans",      "Kg", 1200),
	("RAW-TEA-ASSAM",        "Assam CTC Tea",             "Kg", 480),
	("RAW-CHOCOLATE",        "Dark Chocolate 70%",        "Kg", 890),
	# Alcohol (bar)
	("RAW-RUM-WHITE",        "White Rum",                 "Litre", 1100),
	("RAW-VODKA",            "Vodka",                     "Litre", 1250),
	("RAW-WINE-RED",         "House Red Wine",            "Litre", 850),
	# Mixers
	("RAW-SODA",             "Soda Water",                "Litre", 55),
	("RAW-PINEAPPLE-JUICE",  "Pineapple Juice",           "Litre", 140),
	("RAW-COLA",             "Cola",                      "Litre", 65),
	# Bakery-prep placeholder (pastry section deferred)
	("RAW-PASTRY-PREPARED",  "Pastry (Prepared)",         "Nos", 45),
	# Catch-all pantry consumables
	("RAW-SEASONING-MISC",   "Miscellaneous Seasoning",   "Nos", 20),
]


# ---------------------------------------------------------------------------
# BOM per menu item (menu item_code_short → list of (raw_item_code, qty, uom))
# ---------------------------------------------------------------------------

BOMS: dict[str, list[tuple[str, float, str]]] = {
	# --- SIGREST — mains + starters + sides + breakfast + desserts ---
	"BUTTER-CHK": [
		("RAW-CHICKEN-BONELESS", 0.220, "Kg"),
		("RAW-BUTTER",           0.035, "Kg"),
		("RAW-CREAM",            0.080, "Litre"),
		("RAW-TOMATO",           0.100, "Kg"),
		("RAW-ONION",            0.060, "Kg"),
		("RAW-SPICE-MASALA",     0.010, "Kg"),
	],
	"PANEER-TIKKA": [
		("RAW-PANEER",       0.150, "Kg"),
		("RAW-CREAM",        0.030, "Litre"),
		("RAW-SPICE-MASALA", 0.008, "Kg"),
		("RAW-ONION",        0.040, "Kg"),
	],
	"CHICKEN-TIKKA": [
		("RAW-CHICKEN-BONELESS", 0.180, "Kg"),
		("RAW-CREAM",            0.020, "Litre"),
		("RAW-SPICE-MASALA",     0.008, "Kg"),
	],
	"PRAWN-COCKTAIL": [
		("RAW-PRAWN",   0.120, "Kg"),
		("RAW-LETTUCE", 0.050, "Kg"),
		("RAW-LEMON",   0.030, "Kg"),
	],
	"DAL-MAKHANI": [
		("RAW-BUTTER",   0.040, "Kg"),
		("RAW-CREAM",    0.060, "Litre"),
		("RAW-TOMATO",   0.080, "Kg"),
		("RAW-SPICE-MASALA", 0.008, "Kg"),
	],
	"LAMB-BIRYANI": [
		("RAW-LAMB",         0.250, "Kg"),
		("RAW-BASMATI-RICE", 0.200, "Kg"),
		("RAW-ONION",        0.100, "Kg"),
		("RAW-SPICE-MASALA", 0.015, "Kg"),
		("RAW-OIL-REFINED",  0.030, "Litre"),
	],
	"VEG-BIRYANI": [
		("RAW-BASMATI-RICE", 0.200, "Kg"),
		("RAW-POTATO",       0.100, "Kg"),
		("RAW-ONION",        0.080, "Kg"),
		("RAW-SPICE-MASALA", 0.012, "Kg"),
		("RAW-OIL-REFINED",  0.025, "Litre"),
	],
	"GARLIC-NAAN": [
		("RAW-MAIDA",   0.120, "Kg"),
		("RAW-GARLIC",  0.010, "Kg"),
		("RAW-BUTTER",  0.020, "Kg"),
	],
	"MASALA-DOSA": [
		("RAW-POTATO",       0.100, "Kg"),
		("RAW-ONION",        0.050, "Kg"),
		("RAW-OIL-REFINED",  0.015, "Litre"),
		("RAW-SPICE-MASALA", 0.006, "Kg"),
	],
	"KESAR-KULFI": [
		("RAW-MILK",  0.150, "Litre"),
		("RAW-CREAM", 0.030, "Litre"),
		("RAW-SUGAR", 0.030, "Kg"),
	],
	"GULAB-JAMUN": [
		("RAW-MILK",  0.100, "Litre"),
		("RAW-MAIDA", 0.030, "Kg"),
		("RAW-SUGAR", 0.060, "Kg"),
	],
	# --- IRD — breakfast + rooms service + starters + desserts ---
	"CONT-BREAKFAST": [
		("RAW-EGG",             2, "Nos"),
		("RAW-BUTTER",          0.015, "Kg"),
		("RAW-FRUIT-SEASONAL",  0.080, "Kg"),
		("RAW-COFFEE-BEAN",     0.020, "Kg"),
	],
	"INDIAN-BREAKFAST": [
		("RAW-POTATO",       0.080, "Kg"),
		("RAW-WHEAT-FLOUR",  0.080, "Kg"),
		("RAW-BUTTER",       0.015, "Kg"),
		("RAW-TEA-ASSAM",    0.010, "Kg"),
	],
	"MIDNIGHT-BURGER": [
		("RAW-MAIDA",            0.100, "Kg"),
		("RAW-CHICKEN-BONELESS", 0.150, "Kg"),
		("RAW-LETTUCE",          0.030, "Kg"),
		("RAW-CHEESE-MOZ",       0.030, "Kg"),
	],
	"CLUB-SANDWICH": [
		("RAW-MAIDA",            0.080, "Kg"),
		("RAW-CHICKEN-BONELESS", 0.100, "Kg"),
		("RAW-EGG",              1, "Nos"),
		("RAW-LETTUCE",          0.030, "Kg"),
	],
	"CAESAR-SALAD": [
		("RAW-LETTUCE",    0.150, "Kg"),
		("RAW-CHEESE-MOZ", 0.030, "Kg"),
		("RAW-CREAM",      0.030, "Litre"),
		("RAW-LEMON",      0.030, "Kg"),
	],
	"TOMATO-SOUP": [
		("RAW-TOMATO",       0.250, "Kg"),
		("RAW-CREAM",        0.030, "Litre"),
		("RAW-BUTTER",       0.010, "Kg"),
		("RAW-SPICE-MASALA", 0.004, "Kg"),
	],
	"FRESH-JUICE": [
		("RAW-ORANGE",           0.300, "Kg"),
		("RAW-SEASONING-MISC",   1,      "Nos"),
	],
	"MASALA-CHAI": [
		("RAW-MILK",         0.120, "Litre"),
		("RAW-TEA-ASSAM",    0.008, "Kg"),
		("RAW-SUGAR",        0.015, "Kg"),
		("RAW-SPICE-MASALA", 0.002, "Kg"),
	],
	"FRUIT-PLATTER": [
		("RAW-FRUIT-SEASONAL", 0.300, "Kg"),
		("RAW-MINT",           0.005, "Kg"),
	],
	# --- POOLBAR — cocktails + light bites ---
	"MOJITO": [
		("RAW-RUM-WHITE", 0.045, "Litre"),
		("RAW-MINT",      0.010, "Kg"),
		("RAW-LEMON",     0.030, "Kg"),
		("RAW-SODA",      0.100, "Litre"),
		("RAW-SUGAR",     0.015, "Kg"),
	],
	"PINA-COLADA": [
		("RAW-RUM-WHITE",       0.060, "Litre"),
		("RAW-COCONUT-FRESH",   1,     "Nos"),
		("RAW-PINEAPPLE-JUICE", 0.100, "Litre"),
	],
	"SANGRIA": [
		("RAW-WINE-RED",        0.150, "Litre"),
		("RAW-ORANGE",          0.100, "Kg"),
		("RAW-PINEAPPLE-JUICE", 0.050, "Litre"),
	],
	"VIRGIN-MOJITO": [
		("RAW-MINT",  0.010, "Kg"),
		("RAW-LEMON", 0.030, "Kg"),
		("RAW-SODA",  0.100, "Litre"),
		("RAW-SUGAR", 0.015, "Kg"),
	],
	"COCONUT-WATER": [
		("RAW-COCONUT-FRESH", 1, "Nos"),
	],
	"NACHOS": [
		("RAW-MAIDA",      0.080, "Kg"),
		("RAW-CHEESE-MOZ", 0.060, "Kg"),
		("RAW-TOMATO",     0.060, "Kg"),
	],
	# --- CAFE — coffee, pastry, dessert ---
	"ESPRESSO": [
		("RAW-COFFEE-BEAN", 0.014, "Kg"),
	],
	"CAPPUCCINO": [
		("RAW-COFFEE-BEAN", 0.014, "Kg"),
		("RAW-MILK",        0.150, "Litre"),
	],
	"CROISSANT": [
		("RAW-PASTRY-PREPARED", 1, "Nos"),
	],
	"CHOC-CROISSANT": [
		("RAW-PASTRY-PREPARED", 1, "Nos"),
		("RAW-CHOCOLATE",       0.020, "Kg"),
	],
	"CHEESECAKE": [
		("RAW-PASTRY-PREPARED", 1, "Nos"),
		("RAW-CREAM",           0.050, "Litre"),
		("RAW-SUGAR",           0.030, "Kg"),
	],
}


# ---------------------------------------------------------------------------
# Opening stock — per-outlet warehouse gets a healthy starting quantity of
# every raw item, so orders can consume without hitting "negative stock" on
# the first day.
# ---------------------------------------------------------------------------

# Multiplier per warehouse-suffix so different outlets stock what they need
# in the right shape. SIGREST is the busiest so it gets the largest opening
# stock; IRD is a prep pantry so it gets a lighter starting float.
OPENING_STOCK_MULTIPLIER = {
	"SIGREST": 5.0,
	"POOLBAR": 3.0,
	"CAFE":    2.5,
	"IRD":     2.0,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _company_abbr(company: str) -> str:
	return frappe.db.get_value("Company", company, "abbr") or "TRZ"


def _resolve_company() -> str | None:
	return frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
		"Company", {}, "name"
	)


def _ensure_uom(uom: str) -> str:
	if frappe.db.exists("UOM", uom):
		return uom
	frappe.get_doc({"doctype": "UOM", "uom_name": uom}).insert(ignore_permissions=True)
	return uom


def _ensure_raw_item(company: str, code: str, name: str, uom: str, rate: float) -> str:
	if frappe.db.exists("Item", code):
		return code
	_ensure_uom(uom)
	item_group = frappe.db.get_value("Item Group", "Raw Material", "name") or "Products"
	doc = frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": code,
			"item_name": name,
			"item_group": item_group,
			"stock_uom": uom,
			"is_stock_item": 1,
			"is_sales_item": 0,
			"is_purchase_item": 1,
			"include_item_in_manufacturing": 1,
			"valuation_rate": rate,
			"standard_rate": rate,
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert()
	return doc.name


# ---------------------------------------------------------------------------
# Menu-item to ERPNext-item bridge — this slice makes the menu item a
# "manufactured, non-stock" finished good so a BOM can be attached to it.
# The pre-existing MENU-XXX Items from Slice 1 are re-used and augmented
# in-place; new menu items get created with the same MENU-XXX shape.
# ---------------------------------------------------------------------------


def _ensure_menu_item_as_finished_good(menu_item_short_code: str) -> str:
	code = f"MENU-{menu_item_short_code}"
	if frappe.db.exists("Item", code):
		# Ensure the existing Item is BOM-eligible.
		item = frappe.get_doc("Item", code)
		if not item.include_item_in_manufacturing:
			item.include_item_in_manufacturing = 1
			item.flags.ignore_permissions = True
			item.save()
		return code
	# Look up the Menu Item row for name + price.
	row = frappe.db.get_value(
		"Menu Item",
		{"item_code_short": menu_item_short_code},
		["item_name", "price"],
		as_dict=True,
	)
	if not row:
		frappe.throw(f"Unknown Menu Item short code {menu_item_short_code!r}")
	doc = frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": code,
			"item_name": row.item_name,
			"item_group": frappe.db.get_value("Item Group", "Products", "name") or "Products",
			"stock_uom": "Nos",
			"is_stock_item": 0,
			"is_sales_item": 1,
			"include_item_in_manufacturing": 1,
			"standard_rate": row.price,
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert()
	# Pin back on the Menu Item so future SI lines find it without _ensure_erpnext_item_for_menu.
	frappe.db.set_value(
		"Menu Item",
		{"item_code_short": menu_item_short_code},
		"erpnext_item",
		code,
		update_modified=False,
	)
	return code


def _ensure_bom(company: str, finished_item: str, ingredients: list[tuple[str, float, str]]) -> str | None:
	# One default BOM per finished item — if the shape changes, unset default on
	# the old one and create a new one. For seed we only create if missing.
	existing = frappe.db.get_value(
		"BOM",
		{"item": finished_item, "is_active": 1, "is_default": 1, "docstatus": 1},
		"name",
	)
	if existing:
		return existing

	doc = frappe.get_doc(
		{
			"doctype": "BOM",
			"item": finished_item,
			"quantity": 1,
			"is_active": 1,
			"is_default": 1,
			"company": company,
			"currency": "INR",
			"items": [
				{
					"item_code": raw_code,
					"qty": qty,
					"uom": uom,
					"rate": frappe.db.get_value("Item", raw_code, "valuation_rate") or 1,
					"stock_uom": frappe.db.get_value("Item", raw_code, "stock_uom") or uom,
				}
				for raw_code, qty, uom in ingredients
			],
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert()
	doc.submit()
	return doc.name


def _stock_reconciliation_seed(company: str) -> list[str]:
	"""Seed opening stock via per-outlet Material Receipt Stock Entries.

	Chose Material Receipt over Stock Reconciliation "Opening Stock" purpose
	because the latter requires a Balance Sheet Difference Account to be set
	up on the Company before it will accept — Material Receipt just needs the
	items and a warehouse. Semantically equivalent for our demo: kitchen
	receives inventory from a notional supplier.

	Skips (item, warehouse) pairs that already carry stock so re-runs are
	idempotent. Returns the list of Stock Entry names created (one per
	outlet warehouse)."""
	from the_reezort.fnb.warehouse_seed import PER_OUTLET_WAREHOUSES
	abbr = _company_abbr(company)

	created: list[str] = []
	for outlet_code, suffix in PER_OUTLET_WAREHOUSES:
		warehouse = f"{suffix} - {abbr}"
		if not frappe.db.exists("Warehouse", warehouse):
			continue
		multiplier = OPENING_STOCK_MULTIPLIER.get(outlet_code, 2.0)
		rows = []
		for code, _name, uom, rate in RAW_INGREDIENTS:
			bin_qty = frappe.db.get_value(
				"Bin", {"item_code": code, "warehouse": warehouse}, "actual_qty"
			) or 0
			if bin_qty and bin_qty > 0:
				continue  # already stocked
			opening_qty = 50 * multiplier
			rows.append(
				{
					"t_warehouse": warehouse,
					"item_code": code,
					"qty": opening_qty,
					"uom": uom,
					"basic_rate": rate,
				}
			)
		if not rows:
			continue
		doc = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"company": company,
				"stock_entry_type": "Material Receipt",
				"purpose": "Material Receipt",
				"posting_date": frappe.utils.today(),
				"posting_time": frappe.utils.now_datetime().strftime("%H:%M:%S"),
				"remarks": f"F&B opening stock — {suffix}",
				"items": rows,
			}
		)
		doc.flags.ignore_permissions = True
		doc.insert()
		doc.submit()
		created.append(doc.name)
	return created


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


@frappe.whitelist()
@system_manager_only
def seed_fnb_ingredients_and_boms(company: str | None = None) -> dict:
	company = company or _resolve_company()
	if not company:
		return {"ok": False, "reason": "No company configured"}

	# 1. Raw ingredient Items.
	raw_created: list[str] = []
	for code, name, uom, rate in RAW_INGREDIENTS:
		if not frappe.db.exists("Item", code):
			_ensure_raw_item(company, code, name, uom, rate)
			raw_created.append(code)

	# 2. Menu items → finished-good Items → BOM.
	bom_created: list[dict] = []
	bom_skipped: list[str] = []
	bom_missing: list[str] = []
	for menu_short, ingredients in BOMS.items():
		# Check whether every raw item exists.
		if any(not frappe.db.exists("Item", raw_code) for raw_code, _, _ in ingredients):
			bom_missing.append(menu_short)
			continue
		finished_code = _ensure_menu_item_as_finished_good(menu_short)
		bom_name = _ensure_bom(company, finished_code, ingredients)
		if bom_name and bom_name not in [b["bom"] for b in bom_created]:
			bom_created.append({"menu_item_short": menu_short, "finished_item": finished_code, "bom": bom_name})
		else:
			bom_skipped.append(menu_short)

	# 3. Opening stock — one Material Receipt Stock Entry per outlet warehouse.
	opening_entries = _stock_reconciliation_seed(company)

	frappe.db.commit()
	return {
		"ok": True,
		"company": company,
		"raw_ingredients_created": raw_created,
		"boms_created": bom_created,
		"boms_skipped": bom_skipped,
		"boms_missing_raw_items": bom_missing,
		"opening_stock_entries": opening_entries,
	}
