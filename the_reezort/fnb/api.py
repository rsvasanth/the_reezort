"""F&B In-Room Dining — spec 006 · Slice 1.

Sheet flow: Front Desk clerk opens the IRD sheet on an in-house row →
picks items from the outlet's Menu → posts. Server creates ONE Folio Line
(source_module Restaurant) + ONE FnB Order audit doc. Idempotent per
(stay, ordered_at, item bag, user).

Approval gates:
  · fnb_backdate      — ordered_at older than 24h from now
  · fnb_void_same_day — same-day void > threshold (Slice 4)

Slice 1 explicitly does NOT wire stock / BOM / COGS — that's Slice 2.
"""

from __future__ import annotations

import hashlib
import json

import frappe
from frappe import _
from frappe.utils import flt, get_datetime, getdate, now_datetime, today

from the_reezort.staff.api import _envelope

BACKDATE_HOURS = 24


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


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
def list_outlets(resort_property: str | None = None) -> dict:
	"""Active F&B outlets on a property — for the sheet's outlet select."""
	_require_login()
	filters = {"is_active": 1}
	if resort_property:
		filters["resort_property"] = resort_property
	rows = frappe.get_all(
		"FnB Outlet",
		filters=filters,
		fields=["name", "outlet_name", "outlet_code", "outlet_type", "is_default", "default_service_charge_pct"],
		order_by="is_default desc, outlet_name asc",
	)
	return _envelope({"outlets": rows})


@frappe.whitelist()
def list_menu_items(outlet: str) -> dict:
	"""Available items in an outlet, grouped by category."""
	_require_login()
	if not frappe.db.exists("FnB Outlet", outlet):
		frappe.throw(_("Unknown outlet: {0}").format(outlet))
	rows = frappe.get_all(
		"Menu Item",
		filters={"outlet": outlet, "is_available": 1},
		fields=[
			"name", "item_name", "item_code_short", "description",
			"category", "price", "currency", "erpnext_item",
			"veg_flag", "spice_level", "prep_time_minutes",
			"allergens", "tags", "image",
		],
		order_by="category asc, item_name asc",
	)
	return _envelope({"outlet": outlet, "items": rows})


# ---------- post order ----------


def _make_idempotency_key(stay: str, outlet: str, ordered_at: str, items: list[dict], user: str) -> str:
	digest = hashlib.md5()
	digest.update(stay.encode())
	digest.update(outlet.encode())
	digest.update(str(ordered_at).encode())
	digest.update(user.encode())
	rows = sorted(items, key=lambda r: str(r.get("menu_item")))
	digest.update(json.dumps([
		{"i": r.get("menu_item"), "q": int(r.get("quantity") or 0)}
		for r in rows
	]).encode())
	return f"fnb:{digest.hexdigest()[:20]}"


@frappe.whitelist()
def post_room_charge_order(
	stay: str,
	outlet: str,
	items,
	ordered_at: str | None = None,
	chef_notes: str | None = None,
	guest_note: str | None = None,
	approval_request: str | None = None,
) -> dict:
	"""Post an IRD order → ONE Folio Line (Restaurant source_module) + ONE
	FnB Order audit doc. Idempotent per (stay, outlet, ordered_at, item bag,
	user). Slice 1 = room charge only (walk-in Sales Invoice is Slice 5)."""
	_require_login()

	if isinstance(items, str):
		items = json.loads(items)
	items = [i for i in (items or []) if int(i.get("quantity") or 0) > 0]
	if not items:
		frappe.throw(_("Add at least one item with quantity > 0."))

	s = _stay_or_throw(stay)
	if s.stay_status not in ("In House", "Checked Out"):
		frappe.throw(_("Stay must be In House or Checked Out to post an order."))
	if not frappe.db.exists("FnB Outlet", outlet):
		frappe.throw(_("Unknown outlet: {0}").format(outlet))

	when = get_datetime(ordered_at) if ordered_at else now_datetime()

	if s.arrival_date and getdate(when) < getdate(s.arrival_date):
		frappe.throw(_("Order timestamp is before arrival."))

	# Back-date approval gate
	seconds_back = (now_datetime() - when).total_seconds()
	if seconds_back > BACKDATE_HOURS * 3600:
		try:
			from the_reezort.approvals.api import require_approval

			require_approval(
				action="fnb_backdate",
				source_doctype="FnB Order",
				source_name=f"{stay}:{when.isoformat()}",
				payload={"hours_back": round(seconds_back / 3600, 1), "stay": stay, "outlet": outlet, "items": items},
				approval_request=approval_request,
			)
		except ImportError:
			pass

	folio = _folio_of(stay)
	if not folio:
		frappe.throw(_("Stay {0} has no open folio.").format(stay))
	folio_status = frappe.db.get_value("Guest Folio", folio, "folio_status")
	if folio_status in {"Settled", "Closed", "Cancelled", "Transferred"}:
		frappe.throw(_("Cannot post order — folio {0} is {1}.").format(folio, folio_status))

	# Fetch canonical menu metadata for pricing + names.
	menu_names = [r["menu_item"] for r in items]
	catalog = {
		i["name"]: i
		for i in frappe.get_all(
			"Menu Item",
			filters={"name": ["in", menu_names]},
			fields=["name", "item_name", "price", "erpnext_item", "outlet", "is_available"],
		)
	}
	order_items = []
	total = 0.0
	descriptions = []
	for r in items:
		mi = catalog.get(r["menu_item"])
		if not mi:
			frappe.throw(_("Unknown menu item: {0}").format(r["menu_item"]))
		if mi["outlet"] != outlet:
			frappe.throw(_("Item {0} does not belong to outlet {1}.").format(mi["item_name"], outlet))
		if not mi["is_available"]:
			frappe.throw(_("Item {0} is 86'd (out of stock).").format(mi["item_name"]))
		qty = int(r["quantity"])
		rate = flt(r.get("rate")) or flt(mi["price"])
		amount = qty * rate
		total += amount
		order_items.append({
			"menu_item": mi["name"],
			"item_name": mi["item_name"],
			"quantity": qty,
			"rate": rate,
			"amount": amount,
		})
		descriptions.append(f"{qty} × {mi['item_name']}")

	idem = _make_idempotency_key(stay, outlet, str(when), items, frappe.session.user)

	# Idempotency short-circuit.
	existing_line = frappe.db.get_value(
		"Folio Line",
		{"guest_folio": folio, "idempotency_key": idem},
		"name",
	)
	if existing_line:
		existing_order = frappe.db.get_value(
			"FnB Order", {"folio_line": existing_line}, "name"
		)
		return _envelope({
			"folio_line": existing_line,
			"fnb_order": existing_order,
			"total_amount": total,
			"reused": True,
		})

	order = frappe.get_doc({
		"doctype": "FnB Order",
		"resort_property": s.resort_property,
		"outlet": outlet,
		"stay": stay,
		"guest_folio": folio,
		"ordered_at": when,
		"ordered_by": frappe.session.user,
		"posted_at": now_datetime(),
		"currency": frappe.db.get_value("Guest Folio", folio, "currency") or "INR",
		"chef_notes": chef_notes,
		"guest_note": guest_note,
		"items": order_items,
		"state": "Posted",
	})
	order.flags.ignore_permissions = True
	order.insert(ignore_permissions=True)

	outlet_name = frappe.db.get_value("FnB Outlet", outlet, "outlet_name")
	description = f"{outlet_name} × {sum(int(r['quantity']) for r in items)}: {', '.join(descriptions)}"
	if guest_note:
		description = f"{description} · {guest_note}"

	line = frappe.get_doc({
		"doctype": "Folio Line",
		"guest_folio": folio,
		"line_type": "Charge",
		"source_module": "Restaurant",
		"source_doctype": "FnB Order",
		"source_name": order.name,
		"idempotency_key": idem,
		"service_date": getdate(when),
		"description": description,
		"qty": 1,
		"rate": total,
		"amount": total,
		"tax_treatment": "Standard",
	})
	line.insert(ignore_permissions=True)

	frappe.db.set_value("FnB Order", order.name, "folio_line", line.name, update_modified=False)

	# Best-effort audit.
	try:
		from the_reezort.audit.api import record_audit_event

		record_audit_event(
			source_doctype="FnB Order",
			source_name=order.name,
			action="fnb_order_posted",
			reason=guest_note or "",
			details={
				"stay": stay,
				"outlet": outlet,
				"folio": folio,
				"total": total,
				"items": [{"i": r["menu_item"], "q": int(r["quantity"])} for r in items],
			},
		)
	except Exception:
		pass

	# Notify Restaurant + Kitchen — bell picks it up.
	try:
		from the_reezort.staff.notify_api import notify_role

		notify_role(
			role=["Restaurant"],
			subject=f"IRD order · {outlet_name} · Room {s.current_room or stay}",
			body=(chef_notes or "") + ("\n\n" if chef_notes else "") + f"{', '.join(descriptions)}",
			source_doctype="FnB Order",
			source_name=order.name,
			kind="Assignment",
			exclude_users={frappe.session.user},
		)
	except Exception:
		pass

	# Raw-material consumption via BOM — Slice 2. Uses the outlet's dedicated
	# raw-material warehouse. Failures are logged and dropped_items surfaced so
	# kitchen ops can reconcile without blocking the folio charge.
	consumption_result: dict = {"stock_entry": None}
	try:
		from the_reezort.fnb.consumption import consume_for_order
		from the_reezort.fnb.warehouse_seed import warehouse_for_outlet

		warehouse = warehouse_for_outlet(outlet)
		if warehouse:
			consumption_result = consume_for_order(
				warehouse=warehouse,
				order_items=[
					{"menu_item": i["menu_item"], "quantity": int(i.get("quantity") or 1), "item_name": i.get("item_name")}
					for i in items
				],
				remarks=f"F&B IRD {order.name} · Stay {stay}",
			)
	except Exception as exc:
		frappe.log_error(f"IRD consumption failed: {exc}", "F&B IRD consumption")

	frappe.db.commit()
	return _envelope({
		"folio_line": line.name,
		"fnb_order": order.name,
		"total_amount": total,
		"reused": False,
		"stock_entry": consumption_result.get("stock_entry"),
		"consumption_dropped": consumption_result.get("dropped_items", []),
	})


# ---------- history ----------


@frappe.whitelist()
def list_recent_orders(stay: str, limit: int = 10) -> dict:
	_require_login()
	rows = frappe.get_all(
		"FnB Order",
		filters={"stay": stay},
		fields=["name", "outlet", "ordered_at", "ordered_by", "total_amount", "currency", "state", "folio_line", "chef_notes", "guest_note"],
		order_by="ordered_at desc",
		limit=int(limit),
	)
	for r in rows:
		r["outlet_name"] = frappe.db.get_value("FnB Outlet", r["outlet"], "outlet_name")
		r["items"] = frappe.get_all(
			"FnB Order Item",
			filters={"parent": r["name"]},
			fields=["menu_item", "item_name", "quantity", "rate", "amount"],
			order_by="idx asc",
		)
	return _envelope({"orders": rows})


# ---------- seed ----------


DEFAULT_OUTLETS = (
	# (code, name, type, is_default, service_charge_pct)
	("SIGREST",  "Signature Restaurant", "Restaurant",       0, 10.0),
	("IRD",      "In-Room Dining",       "In-Room Dining",   1,  0.0),
	("POOLBAR",  "Poolside Bar",         "Bar",              0,  5.0),
	("CAFE",     "The Reezort Café",     "Cafe",             0,  0.0),
)


DEFAULT_MENU = (
	# (outlet_code, code, name, category, price, veg_flag, spice, prep, description, allergens, tags)
	("SIGREST", "BUTTER-CHK",     "Butter Chicken",           "Mains",     850,  "Non-veg", 2, 25, "Slow-cooked in tomato + cream, served with basmati rice",             "Dairy, Nuts",     "Signature, Chef pick"),
	("SIGREST", "PANEER-TIKKA",   "Paneer Tikka",             "Starters",  650,  "Veg",     2, 15, "Charcoal-grilled cottage cheese in yogurt marinade",                  "Dairy",           "Signature"),
	("SIGREST", "CHICKEN-TIKKA",  "Chicken Tikka",            "Starters",  750,  "Non-veg", 3, 20, "Charcoal-grilled boneless chicken, mint chutney",                     "Dairy",           "Chef pick"),
	("SIGREST", "PRAWN-COCKTAIL", "Prawn Cocktail",           "Starters",  950,  "Non-veg", 1, 10, "Chilled tiger prawns, cocktail sauce, avocado",                       "Shellfish, Egg",  ""),
	("SIGREST", "DAL-MAKHANI",    "Dal Makhani",              "Mains",     550,  "Veg",     1, 20, "Slow-simmered black lentils, butter, cream",                          "Dairy",           "Chef pick"),
	("SIGREST", "LAMB-BIRYANI",   "Lamb Biryani",             "Mains",     950,  "Non-veg", 3, 40, "Fragrant basmati rice, tender lamb, saffron, raita",                  "Dairy, Nuts",     "Signature"),
	("SIGREST", "VEG-BIRYANI",    "Vegetable Biryani",        "Mains",     650,  "Veg",     2, 30, "Basmati rice with seasonal vegetables and spices",                    "Dairy, Nuts",     "Kid friendly"),
	("SIGREST", "GARLIC-NAAN",    "Garlic Naan",              "Sides",     150,  "Veg",     0,  8, "Tandoor-baked bread with roasted garlic and butter",                  "Gluten, Dairy",   ""),
	("SIGREST", "MASALA-DOSA",    "Masala Dosa",              "Breakfast", 350,  "Veg",     1, 15, "Crispy rice crepe, potato masala, three chutneys",                    "",                "Kid friendly, Signature"),
	("SIGREST", "KESAR-KULFI",    "Kesar Kulfi",              "Desserts",  350,  "Veg",     0,  5, "Traditional saffron and pistachio kulfi ice cream",                   "Dairy, Nuts",     "Chef pick"),
	("SIGREST", "GULAB-JAMUN",    "Gulab Jamun",              "Desserts",  250,  "Veg",     0,  8, "Milk dumplings in cardamom-rose syrup, served warm",                  "Dairy, Nuts",     "Kid friendly"),
	("IRD",     "CONT-BREAKFAST", "Continental Breakfast",    "Breakfast", 850,  "Veg",     0, 15, "Assorted breads, preserves, cheese, fresh fruit, juice, coffee/tea",  "Gluten, Dairy",   "Chef pick"),
	("IRD",     "INDIAN-BREAKFAST","Indian Breakfast",        "Breakfast", 750,  "Veg",     1, 15, "Aloo paratha, dahi, pickle, masala chai, seasonal fruit",             "Gluten, Dairy",   ""),
	("IRD",     "MIDNIGHT-BURGER","Midnight Burger",          "Mains",     650,  "Non-veg", 1, 20, "Angus beef, cheddar, lettuce, brioche bun, side of fries",            "Gluten, Dairy",   "Kid friendly"),
	("IRD",     "CLUB-SANDWICH",  "Club Sandwich",            "Mains",     550,  "Non-veg", 0, 12, "Triple-decker with grilled chicken, bacon, tomato, side of chips",    "Gluten",          "Kid friendly"),
	("IRD",     "CAESAR-SALAD",   "Caesar Salad",             "Mains",     550,  "Non-veg", 0, 10, "Romaine, parmesan, anchovies, croutons, classic dressing",            "Gluten, Dairy, Egg", ""),
	("IRD",     "TOMATO-SOUP",    "Tomato Basil Soup",        "Starters",  350,  "Veg",     0, 10, "Slow-roasted tomatoes, fresh basil, garlic croutons",                 "Gluten, Dairy",   "Kid friendly"),
	("IRD",     "FRESH-JUICE",    "Fresh Fruit Juice",        "Beverages", 250,  "Vegan",   0,  5, "Choice of orange, watermelon, pineapple, or mixed berry",             "",                "Kid friendly"),
	("IRD",     "MASALA-CHAI",    "Masala Chai",              "Beverages", 150,  "Veg",     0,  8, "Assam tea brewed with cardamom, ginger, cinnamon, milk",              "Dairy",           ""),
	("IRD",     "FRUIT-PLATTER",  "Seasonal Fruit Platter",   "Desserts",  450,  "Vegan",   0,  5, "Chef-selected tropical and seasonal fruits",                          "",                "Kid friendly"),
	("POOLBAR", "MOJITO",         "Classic Mojito",           "Alcohol",   550,  "Vegan",   0,  8, "White rum, mint, lime, brown sugar, soda",                            "",                "Signature"),
	("POOLBAR", "PINA-COLADA",    "Piña Colada",              "Alcohol",   650,  "Vegan",   0,  8, "White rum, coconut cream, pineapple juice",                           "",                "Signature"),
	("POOLBAR", "SANGRIA",        "Red Wine Sangria",         "Alcohol",   750,  "Vegan",   0, 10, "Red wine, orange, apple, cinnamon, brandy",                           "",                ""),
	("POOLBAR", "VIRGIN-MOJITO",  "Virgin Mojito",            "Beverages", 350,  "Vegan",   0,  5, "Mint, lime, brown sugar, soda — no alcohol",                          "",                "Kid friendly"),
	("POOLBAR", "COCONUT-WATER",  "Fresh Coconut Water",      "Beverages", 200,  "Vegan",   0,  3, "Straight from the coconut",                                           "",                "Kid friendly"),
	("POOLBAR", "NACHOS",         "Loaded Nachos",            "Sides",     450,  "Veg",     1, 12, "Corn tortilla chips, cheese, jalapeño, salsa, sour cream",            "Gluten, Dairy",   ""),
	("CAFE",    "ESPRESSO",       "Espresso",                 "Beverages", 150,  "Vegan",   0,  3, "Single shot, freshly ground beans",                                   "",                ""),
	("CAFE",    "CAPPUCCINO",     "Cappuccino",               "Beverages", 200,  "Veg",     0,  4, "Espresso, steamed milk, thick foam, dusting of cocoa",                "Dairy",           ""),
	("CAFE",    "CROISSANT",      "Butter Croissant",         "Breakfast", 200,  "Veg",     0,  3, "Flaky, buttery, baked in-house every morning",                        "Gluten, Dairy",   "Chef pick"),
	("CAFE",    "CHOC-CROISSANT", "Chocolate Croissant",      "Breakfast", 250,  "Veg",     0,  3, "Chocolate-filled, warm from the oven",                                "Gluten, Dairy",   "Kid friendly"),
	("CAFE",    "CHEESECAKE",     "New York Cheesecake",      "Desserts",  350,  "Veg",     0,  3, "Classic cream cheese, graham cracker base, seasonal berry compote",   "Gluten, Dairy, Egg", "Chef pick"),
)


@frappe.whitelist()
def seed_fnb_catalog(resort_property: str | None = None) -> dict:
	"""Idempotent seeder — 4 outlets + ~30-item menu + food images.

	Images are read from `setup/seed_assets/menu_photos/{OUTLET}_{CODE}.jpg`
	(same pattern as villa renders). Missing files just skip the image —
	the UI falls back to a category-tinted gradient tile.
	"""
	if not resort_property:
		resort_property = frappe.db.get_value("Resort Property", {"is_active": 1}, "name")
	if not resort_property:
		frappe.throw(_("No active Resort Property found."))

	created_outlets = []
	skipped_outlets = []
	for code, name, otype, is_default, sc in DEFAULT_OUTLETS:
		key = {"resort_property": resort_property, "outlet_code": code}
		if frappe.db.exists("FnB Outlet", key):
			skipped_outlets.append(code)
			continue
		frappe.get_doc({
			"doctype": "FnB Outlet",
			"resort_property": resort_property,
			"outlet_name": name,
			"outlet_code": code,
			"outlet_type": otype,
			"is_default": is_default,
			"is_active": 1,
			"default_service_charge_pct": sc,
		}).insert(ignore_permissions=True)
		created_outlets.append(code)

	default_currency = (
		frappe.db.get_value("Company", frappe.defaults.get_global_default("company"), "default_currency")
		or "INR"
	)

	created_items = []
	skipped_items = []
	for out_code, code, name, category, price, veg, spice, prep, desc, allergens, tags in DEFAULT_MENU:
		outlet_name = frappe.db.get_value(
			"FnB Outlet", {"resort_property": resort_property, "outlet_code": out_code}, "name"
		)
		if not outlet_name:
			continue
		if frappe.db.exists("Menu Item", {"outlet": outlet_name, "item_code_short": code}):
			skipped_items.append(f"{out_code}/{code}")
			continue
		item = frappe.get_doc({
			"doctype": "Menu Item",
			"outlet": outlet_name,
			"item_name": name,
			"item_code_short": code,
			"category": category,
			"price": price,
			"currency": default_currency,
			"veg_flag": veg,
			"spice_level": spice,
			"prep_time_minutes": prep,
			"description": desc,
			"allergens": allergens or None,
			"tags": tags or None,
			"is_available": 1,
		}).insert(ignore_permissions=True)
		created_items.append(f"{out_code}/{code}")

	# Now attach images from seed_assets/menu_photos to every Menu Item that
	# has a matching file. Idempotent — same content_hash won't re-upload.
	from the_reezort.fnb.image_seed import seed_menu_images

	image_result = seed_menu_images(resort_property=resort_property)

	frappe.db.commit()
	return {
		"resort_property": resort_property,
		"outlets": {"created": created_outlets, "skipped": skipped_outlets},
		"items": {"created": created_items, "skipped": skipped_items},
		"images": image_result,
	}
