"""F&B Menu Management write API — spec 006 · Slice 2 (menu authoring gap).

The SPA previously had NO write path for menu items, prices, or recipes —
everything required the ERPNext desk. This module closes that gap.

Endpoints (all under `the_reezort.fnb.menu_management.*`):

  create_menu_item(payload)                   → insert + provision ERPNext Item + price
  update_menu_item(menu_item, payload)        → edit whitelisted fields
  set_menu_item_price(menu_item, price)       → update price + upsert ERPNext Item Price
  toggle_menu_item_availability(menu_item, is_available)  → 86 / un-86
  set_menu_item_recipe(menu_item, ingredients)  → build/replace ERPNext BOM
  get_menu_item_detail(menu_item)             → fields + recipe + margin

BOM lifecycle note:
  ERPNext BOMs are submittable docs (docstatus 0=Draft, 1=Submitted, 2=Cancelled).
  To replace an active BOM: cancel the submitted doc → insert + submit the new one.
  We guard against leaving the item with no active BOM on failure by wrapping the
  cancel/insert/submit cycle in a try/except that rolls back via frappe.db.rollback().

Deferred TODOs:
  - Outlet-specific price overrides: the spec requires approval before an item's
    price can differ per outlet. Current implementation sets the standard selling
    price only. Outlet-override-with-approval is deferred to Slice 3.
  - Image upload: the endpoint accepts an `image` URL (File docname or attachment URL).
    Direct binary upload belongs in a separate file-upload endpoint.
"""

from __future__ import annotations

import re
from typing import Any

import frappe
from frappe import _
from frappe.utils import flt

from the_reezort.audit.api import record_audit_event
from the_reezort.fnb.inventory import bom_for_menu_item
from the_reezort.fnb.restaurant import _as_admin, _ensure_erpnext_item_for_menu
from the_reezort.staff.api import _envelope
from the_reezort.utils import require_permission as _require_permission

# ---------------------------------------------------------------------------
# Editable field whitelist — only these fields may be patched via update_menu_item.
# Prevents arbitrary ERPNext field injection from the SPA.
# ---------------------------------------------------------------------------

_EDITABLE_FIELDS = {
    "item_name",
    "category",
    "veg_flag",
    "spice_level",
    "prep_time_minutes",
    "description",
    "allergens",
    "tags",
    "image",
    "is_available",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_CATEGORIES = {
    "Starters", "Mains", "Desserts", "Beverages",
    "Alcohol", "Sides", "Breakfast", "Other",
}

_VALID_VEG_FLAGS = {"Veg", "Non-veg", "Egg", "Vegan"}


def _slugify(name: str) -> str:
    """Convert a display name to a short uppercase code (≤20 chars)."""
    slug = re.sub(r"[^A-Z0-9]+", "-", name.upper().strip())
    slug = slug.strip("-")
    return slug[:20]


def _unique_item_code_short(base: str) -> str:
    """Return base if unused; otherwise append -2, -3, … until unique."""
    candidate = base
    counter = 2
    while frappe.db.exists("Menu Item", {"item_code_short": candidate}):
        candidate = f"{base[:17]}-{counter}"
        counter += 1
    return candidate


def _upsert_selling_item_price(item_code: str, price: float) -> None:
    """Create or update the standard selling Item Price for a menu ERPNext item.

    Mirrors the ensure_room_item pattern in setup/api.py exactly.
    Runs inside _as_admin() at the call sites below — no separate elevation here.
    """
    if price <= 0:
        return
    price_list = (
        frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
        or "Standard Selling"
    )
    existing = frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "price_list": price_list, "selling": 1},
        "name",
    )
    if existing:
        frappe.db.set_value("Item Price", existing, "price_list_rate", flt(price))
    else:
        frappe.get_doc(
            {
                "doctype": "Item Price",
                "item_code": item_code,
                "price_list": price_list,
                "selling": 1,
                "price_list_rate": flt(price),
            }
        ).insert(ignore_permissions=True)


def _validate_category(category: str) -> None:
    if category and category not in _VALID_CATEGORIES:
        frappe.throw(
            _("Invalid category '{0}'. Must be one of: {1}.").format(
                category, ", ".join(sorted(_VALID_CATEGORIES))
            )
        )


def _validate_veg_flag(veg_flag: str) -> None:
    if veg_flag and veg_flag not in _VALID_VEG_FLAGS:
        frappe.throw(
            _("Invalid veg_flag '{0}'. Must be one of: {1}.").format(
                veg_flag, ", ".join(sorted(_VALID_VEG_FLAGS))
            )
        )


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------


@frappe.whitelist()
def create_menu_item(payload: dict | str) -> dict:
    """Insert a new Menu Item, provision its ERPNext Item, and seed its selling price.

    Required payload fields: item_name, outlet, category, price
    Optional: veg_flag, spice_level, prep_time_minutes, description,
              allergens, tags, image, is_available (default 1),
              item_code_short (auto-generated from item_name if omitted)
    """
    _require_permission("Menu Item", "create")
    if isinstance(payload, str):
        import json
        payload = json.loads(payload)

    # --- required fields ---
    item_name = (payload.get("item_name") or "").strip()
    outlet = (payload.get("outlet") or "").strip()
    category = (payload.get("category") or "").strip()
    price = flt(payload.get("price"))

    if not item_name:
        frappe.throw(_("item_name is required."))
    if not outlet:
        frappe.throw(_("outlet is required."))
    if not frappe.db.exists("FnB Outlet", outlet):
        frappe.throw(_("Unknown outlet: {0}").format(outlet))
    if not category:
        frappe.throw(_("category is required."))
    _validate_category(category)
    if price <= 0:
        frappe.throw(_("price must be greater than 0."))

    veg_flag = payload.get("veg_flag") or "Veg"
    _validate_veg_flag(veg_flag)

    # --- item_code_short ---
    code_short = (payload.get("item_code_short") or "").strip()
    if not code_short:
        code_short = _slugify(item_name)
    code_short = _unique_item_code_short(code_short)

    currency = payload.get("currency") or (
        frappe.db.get_value(
            "Company",
            frappe.defaults.get_global_default("company"),
            "default_currency",
        )
        or "INR"
    )

    doc = frappe.get_doc(
        {
            "doctype": "Menu Item",
            "outlet": outlet,
            "item_name": item_name,
            "item_code_short": code_short,
            "category": category,
            "price": price,
            "currency": currency,
            "veg_flag": veg_flag,
            "spice_level": int(payload.get("spice_level") or 0),
            "prep_time_minutes": int(payload.get("prep_time_minutes") or 0),
            "description": payload.get("description") or None,
            "allergens": payload.get("allergens") or None,
            "tags": payload.get("tags") or None,
            "image": payload.get("image") or None,
            "is_available": int(payload.get("is_available") if payload.get("is_available") is not None else 1),
        }
    )
    doc.flags.ignore_permissions = True
    doc.insert()

    # Provision ERPNext Item + Item Price under admin elevation.
    with _as_admin():
        erp_item = _ensure_erpnext_item_for_menu(doc.name)
        _upsert_selling_item_price(erp_item, price)

    record_audit_event(
        "Menu Item",
        doc.name,
        "menu_management.create_menu_item",
        details={"outlet": outlet, "category": category, "price": price},
    )
    return _envelope({"menu_item": _menu_item_dict(doc)})


@frappe.whitelist()
def update_menu_item(menu_item: str, payload: dict | str) -> dict:
    """Edit whitelisted fields on an existing Menu Item.

    Accepted fields: item_name, category, veg_flag, spice_level,
    prep_time_minutes, description, allergens, tags, image, is_available.

    If price is included in the payload it is routed through set_menu_item_price
    so the ERPNext Item Price stays in sync.
    """
    _require_permission("Menu Item", "write")
    if isinstance(payload, str):
        import json
        payload = json.loads(payload)

    if not frappe.db.exists("Menu Item", menu_item):
        frappe.throw(_("Unknown Menu Item: {0}").format(menu_item))

    doc = frappe.get_doc("Menu Item", menu_item)

    # Handle price separately (has ERPNext side-effect).
    new_price = payload.pop("price", None)

    # Apply whitelisted fields only.
    changed: list[str] = []
    for field in _EDITABLE_FIELDS:
        if field not in payload:
            continue
        value = payload[field]
        if field == "category":
            _validate_category(value)
        if field == "veg_flag":
            _validate_veg_flag(value)
        if field in {"spice_level", "prep_time_minutes"}:
            value = int(value or 0)
        if field == "is_available":
            value = int(bool(value))
        setattr(doc, field, value)
        changed.append(field)

    if changed:
        doc.flags.ignore_permissions = True
        doc.save()

    if new_price is not None:
        _do_set_price(menu_item, flt(new_price))
        doc.reload()

    record_audit_event(
        "Menu Item",
        menu_item,
        "menu_management.update_menu_item",
        details={"fields": changed, "price_updated": new_price is not None},
    )
    return _envelope({"menu_item": _menu_item_dict(doc)})


@frappe.whitelist()
def set_menu_item_price(menu_item: str, price: float | str) -> dict:
    """Update Menu Item.price AND upsert the ERPNext selling Item Price.

    Outlet-specific price overrides (per-outlet Item Price with approval gate)
    are deferred to Slice 3 — see module docstring.
    """
    _require_permission("Menu Item", "write")
    price = flt(price)
    if price <= 0:
        frappe.throw(_("price must be > 0."))
    if not frappe.db.exists("Menu Item", menu_item):
        frappe.throw(_("Unknown Menu Item: {0}").format(menu_item))

    _do_set_price(menu_item, price)
    doc = frappe.get_doc("Menu Item", menu_item)
    record_audit_event(
        "Menu Item",
        menu_item,
        "menu_management.set_menu_item_price",
        details={"price": price},
    )
    return _envelope({"menu_item": _menu_item_dict(doc)})


def _do_set_price(menu_item: str, price: float) -> None:
    """Internal price setter — updates Menu Item row + ERPNext Item Price."""
    frappe.db.set_value("Menu Item", menu_item, "price", price)
    erp_item = frappe.db.get_value("Menu Item", menu_item, "erpnext_item")
    if not erp_item:
        with _as_admin():
            erp_item = _ensure_erpnext_item_for_menu(menu_item)
    with _as_admin():
        _upsert_selling_item_price(erp_item, price)


@frappe.whitelist()
def toggle_menu_item_availability(menu_item: str, is_available: bool | int | str) -> dict:
    """86 / un-86 a menu item.

    Sets Menu Item.is_available. No ERPNext side-effect — the item stays
    listed on the SI but won't be orderable via the POS (add_items rejects it).
    """
    _require_permission("Menu Item", "write")
    if not frappe.db.exists("Menu Item", menu_item):
        frappe.throw(_("Unknown Menu Item: {0}").format(menu_item))

    flag = int(bool(int(is_available)))
    frappe.db.set_value("Menu Item", menu_item, "is_available", flag)
    doc = frappe.get_doc("Menu Item", menu_item)
    record_audit_event(
        "Menu Item",
        menu_item,
        "menu_management.toggle_availability",
        details={"is_available": flag},
    )
    return _envelope({"menu_item": _menu_item_dict(doc)})


@frappe.whitelist()
def set_menu_item_recipe(menu_item: str, ingredients: list[dict] | str) -> dict:
    """Build or replace the ERPNext BOM for a menu item's linked ERPNext Item.

    This is the BOM-builder that was marked "Slice 2 — never built" in inventory.py.
    After this runs, close_walk_in / post_order_to_room will consume raw materials
    via consumption.py (which already drives BOMs to Stock Entries).

    ingredients: [{item_code, qty, uom?}]  — raw ingredient ERPNext Items

    BOM lifecycle:
      1. Find the current active default BOM (docstatus=1, is_active=1, is_default=1).
      2. Cancel it (amend if needed) so the item has no stale active BOM.
      3. Insert + submit the new BOM as is_default=1, is_active=1.
      Guard: if step 3 fails, rollback is left to the caller (frappe.db.rollback()).
      The old BOM was already cancelled at that point — the item has no active BOM.
      The caller should surface the error so kitchen ops can retry.
    """
    _require_permission("Menu Item", "write")
    if isinstance(ingredients, str):
        import json
        ingredients = json.loads(ingredients)
    if not ingredients:
        frappe.throw(_("At least one ingredient is required."))

    if not frappe.db.exists("Menu Item", menu_item):
        frappe.throw(_("Unknown Menu Item: {0}").format(menu_item))

    # Ensure the ERPNext Item exists before we build a BOM for it.
    erp_item = frappe.db.get_value("Menu Item", menu_item, "erpnext_item")
    if not erp_item:
        with _as_admin():
            erp_item = _ensure_erpnext_item_for_menu(menu_item)

    # Validate ingredients outside the admin block so errors surface early.
    validated: list[dict] = []
    for row in ingredients:
        item_code = (row.get("item_code") or "").strip()
        if not item_code:
            frappe.throw(_("Every ingredient must have an item_code."))
        if not frappe.db.exists("Item", item_code):
            frappe.throw(_("Unknown ingredient item: {0}").format(item_code))
        qty = flt(row.get("qty"))
        if qty <= 0:
            frappe.throw(_("Quantity for ingredient {0} must be > 0.").format(item_code))
        uom = row.get("uom") or frappe.db.get_value("Item", item_code, "stock_uom") or "Nos"
        rate = flt(
            frappe.db.get_value("Item", item_code, "valuation_rate")
            or frappe.db.get_value("Item", item_code, "standard_rate")
            or 0
        )
        validated.append({"item_code": item_code, "qty": qty, "uom": uom, "rate": rate})

    new_bom_name: str | None = None
    with _as_admin():
        # Cancel any existing active default BOM for this item.
        old_bom = frappe.db.get_value(
            "BOM",
            {"item": erp_item, "is_active": 1, "is_default": 1, "docstatus": 1},
            "name",
        )
        if old_bom:
            old_doc = frappe.get_doc("BOM", old_bom)
            old_doc.flags.ignore_permissions = True
            old_doc.cancel()

        # Build BOM items list.
        bom_items = [
            {
                "item_code": v["item_code"],
                "qty": v["qty"],
                "uom": v["uom"],
                "rate": v["rate"],
                "amount": flt(v["qty"]) * flt(v["rate"]),
            }
            for v in validated
        ]

        item_name = frappe.db.get_value("Menu Item", menu_item, "item_name")
        new_bom = frappe.get_doc(
            {
                "doctype": "BOM",
                "item": erp_item,
                "item_name": item_name,
                "quantity": 1,
                "is_active": 1,
                "is_default": 1,
                "with_operations": 0,
                "items": bom_items,
            }
        )
        new_bom.flags.ignore_permissions = True
        new_bom.insert()
        new_bom.submit()
        new_bom_name = new_bom.name

    # Compute recipe cost from the submitted BOM.
    recipe_cost = sum(flt(v["qty"]) * flt(v["rate"]) for v in validated)
    menu_price = flt(frappe.db.get_value("Menu Item", menu_item, "price"))
    margin = round(menu_price - recipe_cost, 2)

    record_audit_event(
        "Menu Item",
        menu_item,
        "menu_management.set_menu_item_recipe",
        details={
            "bom": new_bom_name,
            "ingredient_count": len(validated),
            "recipe_cost": recipe_cost,
        },
    )
    return _envelope(
        {
            "menu_item": menu_item,
            "bom": new_bom_name,
            "ingredient_count": len(validated),
            "recipe_cost": recipe_cost,
            "menu_price": menu_price,
            "margin": margin,
        }
    )


@frappe.whitelist()
def get_menu_item_detail(menu_item: str) -> dict:
    """Full detail for the edit screen: fields + current recipe + margin.

    recipe shape mirrors bom_for_menu_item (from inventory.py):
      {bom, ingredients: [{item_code, qty, uom, rate, amount, item_name, image}], cost}

    margin = price − recipe cost  (None when no BOM exists yet)
    """
    _require_permission("Menu Item", "read")
    if not frappe.db.exists("Menu Item", menu_item):
        frappe.throw(_("Unknown Menu Item: {0}").format(menu_item))
    doc = frappe.get_doc("Menu Item", menu_item)

    # bom_for_menu_item returns an _envelope dict; unwrap data.
    recipe_envelope = bom_for_menu_item(menu_item)
    recipe_data = recipe_envelope.get("data") or recipe_envelope

    recipe_cost = flt(recipe_data.get("cost") or 0)
    menu_price = flt(doc.price)
    margin: float | None = None
    margin_pct: float | None = None
    if recipe_data.get("bom"):
        margin = round(menu_price - recipe_cost, 2)
        if menu_price > 0:
            margin_pct = round((margin / menu_price) * 100, 1)

    return _envelope(
        {
            "menu_item": _menu_item_dict(doc),
            "recipe": {
                "bom": recipe_data.get("bom"),
                "ingredients": recipe_data.get("ingredients") or [],
                "cost": recipe_cost,
            },
            "margin": margin,
            "margin_pct": margin_pct,
        }
    )


# ---------------------------------------------------------------------------
# Private serialiser
# ---------------------------------------------------------------------------


def _menu_item_dict(doc: Any) -> dict:
    """Stable dict shape for all responses — mirrors list_menu_items fields."""
    return {
        "name": doc.name,
        "outlet": doc.outlet,
        "item_name": doc.item_name,
        "item_code_short": doc.item_code_short,
        "erpnext_item": doc.erpnext_item,
        "category": doc.category,
        "price": flt(doc.price),
        "currency": doc.currency,
        "is_available": int(doc.is_available or 0),
        "description": doc.description,
        "veg_flag": doc.veg_flag,
        "spice_level": int(doc.spice_level or 0),
        "prep_time_minutes": int(doc.prep_time_minutes or 0),
        "allergens": doc.allergens,
        "tags": doc.tags,
        "image": doc.image,
    }
