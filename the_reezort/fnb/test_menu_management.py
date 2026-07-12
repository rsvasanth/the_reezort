"""Tests for fnb/menu_management.py — spec 006 · Slice 2 menu-authoring gap.

Coverage targets:
  - create_menu_item: happy path, missing-field validation, duplicate-code dedup
  - set_menu_item_price: price + ERPNext Item Price upsert
  - toggle_menu_item_availability: 86 and un-86
  - set_menu_item_recipe: BOM create, BOM replace (cancel-then-recreate)
  - get_menu_item_detail: fields + recipe + margin assembly

We cannot run bench in this bare worktree so every ERPNext/Frappe call is
patched via unittest.mock.patch. The tests exercise the module's logic and
validate that the correct Frappe APIs are driven.
"""

from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

# ---------------------------------------------------------------------------
# Minimal stub of the frappe module so we can import menu_management without
# a live bench environment.
# ---------------------------------------------------------------------------

import sys
import types

# Build a minimal frappe stub only if frappe is not already importable.
if "frappe" not in sys.modules:
    frappe_stub = types.ModuleType("frappe")
    frappe_stub.session = SimpleNamespace(user="Administrator")
    frappe_stub._ = lambda s, *a: s
    frappe_stub.throw = MagicMock(side_effect=Exception)
    frappe_stub.whitelist = lambda fn=None, **kw: (fn if fn else lambda f: f)
    frappe_stub.db = MagicMock()
    frappe_stub.get_doc = MagicMock()
    frappe_stub.get_all = MagicMock(return_value=[])
    frappe_stub.get_roles = MagicMock(return_value=["System Manager"])
    frappe_stub.defaults = MagicMock()
    frappe_stub.defaults.get_global_default = MagicMock(return_value="Test Company")
    frappe_stub.log_error = MagicMock()
    frappe_stub.PermissionError = PermissionError

    # Sub-modules needed by transitive imports
    for sub in ("utils", "model", "model.document"):
        sys.modules[f"frappe.{sub}"] = types.ModuleType(f"frappe.{sub}")
    frappe_stub.utils = types.ModuleType("frappe.utils")
    frappe_stub.utils.flt = float
    frappe_stub.utils.now_datetime = MagicMock(return_value="2026-07-12 10:00:00")
    frappe_stub.utils.today = MagicMock(return_value="2026-07-12")

    sys.modules["frappe"] = frappe_stub
    sys.modules["frappe.utils"] = frappe_stub.utils

# Stub out transitive deps that don't exist in bare checkout.
for mod in [
    "the_reezort",
    "the_reezort.audit",
    "the_reezort.audit.api",
    "the_reezort.fnb",
    "the_reezort.fnb.restaurant",
    "the_reezort.fnb.inventory",
    "the_reezort.staff",
    "the_reezort.staff.api",
    "the_reezort.utils",
]:
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)

# Provide the actual helpers used by menu_management.
import frappe  # noqa: E402 (must come after stub registration)

sys.modules["the_reezort.utils"].require_permission = MagicMock()
sys.modules["the_reezort.staff.api"]._envelope = lambda data: {"ok": True, "data": data}
sys.modules["the_reezort.audit.api"].record_audit_event = MagicMock()
sys.modules["the_reezort.fnb.restaurant"]._as_admin = MagicMock()
sys.modules["the_reezort.fnb.restaurant"]._ensure_erpnext_item_for_menu = MagicMock(
    return_value="MENU-TEST"
)
sys.modules["the_reezort.fnb.inventory"].bom_for_menu_item = MagicMock(
    return_value={
        "ok": True,
        "data": {
            "menu_item": "test-item",
            "bom": None,
            "ingredients": [],
            "cost": 0,
            "menu_price": 500.0,
            "margin_pct": None,
        },
    }
)

# Now we can import the module under test.
from the_reezort.fnb import menu_management  # noqa: E402
from the_reezort.fnb.menu_management import (  # noqa: E402
    _do_set_price,
    _menu_item_dict,
    _slugify,
    _unique_item_code_short,
    _upsert_selling_item_price,
    create_menu_item,
    get_menu_item_detail,
    set_menu_item_price,
    set_menu_item_recipe,
    toggle_menu_item_availability,
    update_menu_item,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_doc(**kwargs):
    defaults = {
        "name": "menu-item-001",
        "outlet": "outlet-001",
        "item_name": "Test Dish",
        "item_code_short": "TEST-DISH",
        "erpnext_item": "MENU-TEST-DISH",
        "category": "Mains",
        "price": 500.0,
        "currency": "INR",
        "is_available": 1,
        "description": "A test dish",
        "veg_flag": "Veg",
        "spice_level": 1,
        "prep_time_minutes": 20,
        "allergens": None,
        "tags": None,
        "image": None,
    }
    defaults.update(kwargs)
    doc = MagicMock()
    for k, v in defaults.items():
        setattr(doc, k, v)
    return doc


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------


class TestSlugify(unittest.TestCase):
    def test_basic(self):
        assert _slugify("Butter Chicken") == "BUTTER-CHICKEN"

    def test_truncates_to_20(self):
        result = _slugify("A Very Very Long Dish Name Indeed")
        assert len(result) <= 20

    def test_special_chars_removed(self):
        result = _slugify("Café & Bistro!")
        assert "&" not in result and "!" not in result


class TestUniqueItemCodeShort(unittest.TestCase):
    def test_returns_base_when_unused(self):
        frappe.db.exists = MagicMock(return_value=False)
        result = _unique_item_code_short("BUTTER-CHICKEN")
        assert result == "BUTTER-CHICKEN"

    def test_appends_counter_when_clash(self):
        # First call exists, second doesn't.
        frappe.db.exists = MagicMock(side_effect=[True, False])
        result = _unique_item_code_short("DISH")
        assert result == "DISH-2"


class TestUpsertSellingItemPrice(unittest.TestCase):
    def test_creates_new_when_no_existing(self):
        frappe.db.get_value = MagicMock(side_effect=["Standard Selling", None])
        new_doc = MagicMock()
        frappe.get_doc = MagicMock(return_value=new_doc)
        _upsert_selling_item_price("MENU-TEST", 350.0)
        new_doc.insert.assert_called_once()

    def test_updates_existing(self):
        frappe.db.get_value = MagicMock(side_effect=["Standard Selling", "IP-001"])
        frappe.db.set_value = MagicMock()
        _upsert_selling_item_price("MENU-TEST", 400.0)
        frappe.db.set_value.assert_called_once_with(
            "Item Price", "IP-001", "price_list_rate", 400.0
        )

    def test_skips_when_price_zero(self):
        frappe.db.get_value = MagicMock()
        _upsert_selling_item_price("MENU-TEST", 0)
        frappe.db.get_value.assert_not_called()


class TestCreateMenuItem(unittest.TestCase):
    def _good_payload(self, **overrides):
        base = {
            "item_name": "Grilled Halloumi",
            "outlet": "outlet-001",
            "category": "Starters",
            "price": 450,
            "veg_flag": "Veg",
        }
        base.update(overrides)
        return base

    def _setup_happy(self):
        """Wire mocks for a clean create path."""
        frappe.db.exists = MagicMock(side_effect=lambda doctype, *a, **kw: {
            "FnB Outlet": True,
            "Menu Item": False,
        }.get(doctype, False))
        frappe.db.get_value = MagicMock(side_effect=lambda *a, **kw: "Standard Selling")
        new_menu_doc = _make_doc(
            name="menu-item-new",
            item_name="Grilled Halloumi",
            item_code_short="GRILLED-HALLOUMI",
            erpnext_item="MENU-GRILLED-HALLOUMI",
            category="Starters",
            price=450.0,
        )
        frappe.get_doc = MagicMock(return_value=new_menu_doc)
        sys.modules["the_reezort.fnb.restaurant"]._ensure_erpnext_item_for_menu = MagicMock(
            return_value="MENU-GRILLED-HALLOUMI"
        )
        # _as_admin context manager — just yield
        from contextlib import contextmanager
        @contextmanager
        def _fake_as_admin():
            yield
        sys.modules["the_reezort.fnb.restaurant"]._as_admin = _fake_as_admin
        # Reload the binding inside menu_management
        menu_management._as_admin = _fake_as_admin
        menu_management._ensure_erpnext_item_for_menu = sys.modules[
            "the_reezort.fnb.restaurant"
        ]._ensure_erpnext_item_for_menu
        return new_menu_doc

    def test_happy_path_returns_menu_item(self):
        doc = self._setup_happy()
        result = create_menu_item(self._good_payload())
        assert result["ok"] is True
        assert result["data"]["menu_item"]["item_name"] == "Grilled Halloumi"

    def test_missing_item_name_raises(self):
        payload = self._good_payload()
        del payload["item_name"]
        frappe.throw = MagicMock(side_effect=Exception("item_name is required."))
        with self.assertRaises(Exception) as ctx:
            create_menu_item(payload)
        assert "item_name" in str(ctx.exception)

    def test_invalid_category_raises(self):
        payload = self._good_payload(category="BreakfastXXX")
        frappe.throw = MagicMock(side_effect=Exception("Invalid category"))
        with self.assertRaises(Exception) as ctx:
            create_menu_item(payload)
        assert "Invalid category" in str(ctx.exception)

    def test_zero_price_raises(self):
        payload = self._good_payload(price=0)
        frappe.throw = MagicMock(side_effect=Exception("price must be"))
        with self.assertRaises(Exception) as ctx:
            create_menu_item(payload)
        assert "price" in str(ctx.exception)

    def test_json_payload_parsed(self):
        doc = self._setup_happy()
        result = create_menu_item(json.dumps(self._good_payload()))
        assert result["ok"] is True

    def test_item_code_short_auto_generated(self):
        self._setup_happy()
        frappe.db.exists = MagicMock(side_effect=lambda doctype, *a, **kw: {
            "FnB Outlet": True,
            "Menu Item": False,
        }.get(doctype, False))
        payload = self._good_payload()
        payload.pop("item_code_short", None)
        create_menu_item(payload)
        # Code short derived from "Grilled Halloumi" → GRILLED-HALLOUMI
        called_dict = frappe.get_doc.call_args[0][0]
        assert "item_code_short" in called_dict
        assert called_dict["item_code_short"].startswith("GRILLED")


class TestSetMenuItemPrice(unittest.TestCase):
    def _setup(self):
        frappe.db.exists = MagicMock(return_value=True)
        frappe.db.set_value = MagicMock()
        frappe.db.get_value = MagicMock(side_effect=[
            "MENU-TEST",     # erpnext_item lookup in _do_set_price
            "Standard Selling",  # price list lookup
            None,            # existing Item Price → None → will insert
        ])
        inserted_doc = MagicMock()
        frappe.get_doc = MagicMock(return_value=_make_doc())

        from contextlib import contextmanager
        @contextmanager
        def _fake_as_admin():
            yield
        menu_management._as_admin = _fake_as_admin

    def test_updates_menu_item_price_field(self):
        self._setup()
        new_ip_doc = MagicMock()
        frappe.get_doc = MagicMock(return_value=_make_doc(price=600.0))
        set_menu_item_price("menu-item-001", 600.0)
        # frappe.db.set_value should have been called with new price
        frappe.db.set_value.assert_any_call("Menu Item", "menu-item-001", "price", 600.0)

    def test_zero_price_raises(self):
        frappe.db.exists = MagicMock(return_value=True)
        frappe.throw = MagicMock(side_effect=Exception("price must be > 0"))
        with self.assertRaises(Exception):
            set_menu_item_price("menu-item-001", 0)


class TestToggleAvailability(unittest.TestCase):
    def test_sets_to_zero(self):
        frappe.db.exists = MagicMock(return_value=True)
        frappe.db.set_value = MagicMock()
        frappe.get_doc = MagicMock(return_value=_make_doc(is_available=0))
        result = toggle_menu_item_availability("menu-item-001", False)
        frappe.db.set_value.assert_called_once_with(
            "Menu Item", "menu-item-001", "is_available", 0
        )
        assert result["data"]["menu_item"]["is_available"] == 0

    def test_sets_to_one(self):
        frappe.db.exists = MagicMock(return_value=True)
        frappe.db.set_value = MagicMock()
        frappe.get_doc = MagicMock(return_value=_make_doc(is_available=1))
        result = toggle_menu_item_availability("menu-item-001", True)
        frappe.db.set_value.assert_called_once_with(
            "Menu Item", "menu-item-001", "is_available", 1
        )

    def test_unknown_menu_item_raises(self):
        frappe.db.exists = MagicMock(return_value=False)
        frappe.throw = MagicMock(side_effect=Exception("Unknown Menu Item"))
        with self.assertRaises(Exception):
            toggle_menu_item_availability("bad-name", True)

    def test_accepts_string_zero(self):
        frappe.db.exists = MagicMock(return_value=True)
        frappe.db.set_value = MagicMock()
        frappe.get_doc = MagicMock(return_value=_make_doc(is_available=0))
        toggle_menu_item_availability("menu-item-001", "0")
        frappe.db.set_value.assert_called_once_with(
            "Menu Item", "menu-item-001", "is_available", 0
        )


class TestSetMenuItemRecipe(unittest.TestCase):
    def _setup(self, old_bom=None):
        frappe.db.exists = MagicMock(side_effect=lambda doctype, *a, **kw: {
            "Menu Item": True,
            "Item": True,
        }.get(doctype, True))
        frappe.db.get_value = MagicMock(side_effect=lambda doctype, *a, **kw: {
            "Menu Item": "MENU-TEST",
            "BOM": old_bom,
            "Item": 50.0,  # valuation_rate
        }.get(doctype, None))

        from contextlib import contextmanager
        @contextmanager
        def _fake_as_admin():
            yield
        menu_management._as_admin = _fake_as_admin

    def test_creates_bom_when_none_exists(self):
        self._setup(old_bom=None)
        new_bom_doc = MagicMock()
        new_bom_doc.name = "BOM-MENU-TEST-001"
        frappe.get_doc = MagicMock(return_value=new_bom_doc)
        ingredients = [{"item_code": "RAW-TOMATO", "qty": 0.2, "uom": "Kg"}]
        result = set_menu_item_recipe("menu-item-001", ingredients)
        new_bom_doc.insert.assert_called_once()
        new_bom_doc.submit.assert_called_once()
        assert result["data"]["bom"] == "BOM-MENU-TEST-001"

    def test_cancels_old_bom_before_creating_new(self):
        self._setup(old_bom="BOM-MENU-TEST-OLD")
        old_bom_doc = MagicMock()
        old_bom_doc.name = "BOM-MENU-TEST-OLD"
        new_bom_doc = MagicMock()
        new_bom_doc.name = "BOM-MENU-TEST-002"

        call_count = [0]
        def _get_doc_side(*args, **kwargs):
            d = args[0] if args else kwargs
            if isinstance(d, str) and d == "BOM":
                return old_bom_doc
            if isinstance(d, dict) and d.get("doctype") == "BOM":
                return new_bom_doc
            return MagicMock()
        frappe.get_doc = MagicMock(side_effect=_get_doc_side)

        ingredients = [{"item_code": "RAW-ONION", "qty": 0.1}]
        result = set_menu_item_recipe("menu-item-001", ingredients)
        old_bom_doc.cancel.assert_called_once()
        new_bom_doc.submit.assert_called_once()

    def test_zero_quantity_ingredient_raises(self):
        frappe.db.exists = MagicMock(return_value=True)
        frappe.throw = MagicMock(side_effect=Exception("Quantity"))
        with self.assertRaises(Exception):
            set_menu_item_recipe("menu-item-001", [{"item_code": "RAW-TOMATO", "qty": 0}])

    def test_unknown_ingredient_raises(self):
        frappe.db.exists = MagicMock(side_effect=lambda doctype, *a, **kw: {
            "Menu Item": True,
            "Item": False,
        }.get(doctype, False))
        frappe.throw = MagicMock(side_effect=Exception("Unknown ingredient"))
        with self.assertRaises(Exception):
            set_menu_item_recipe("menu-item-001", [{"item_code": "FAKE-ING", "qty": 1}])

    def test_recipe_cost_computed(self):
        self._setup(old_bom=None)
        frappe.db.get_value = MagicMock(side_effect=lambda doctype, *a, **kw: {
            "Menu Item": "MENU-TEST",  # erpnext_item
            "BOM": None,              # no old bom
            "Item": 100.0,            # valuation_rate
        }.get(doctype, None))
        new_bom_doc = MagicMock()
        new_bom_doc.name = "BOM-001"
        frappe.get_doc = MagicMock(return_value=new_bom_doc)
        ingredients = [{"item_code": "RAW-CREAM", "qty": 0.5}]  # 0.5 × 100 = 50
        result = set_menu_item_recipe("menu-item-001", ingredients)
        assert result["data"]["recipe_cost"] == 50.0

    def test_empty_ingredients_raises(self):
        frappe.db.exists = MagicMock(return_value=True)
        frappe.throw = MagicMock(side_effect=Exception("At least one ingredient"))
        with self.assertRaises(Exception):
            set_menu_item_recipe("menu-item-001", [])


class TestGetMenuItemDetail(unittest.TestCase):
    def test_happy_path_no_recipe(self):
        frappe.db.exists = MagicMock(return_value=True)
        doc = _make_doc(price=500.0)
        frappe.get_doc = MagicMock(return_value=doc)
        sys.modules["the_reezort.fnb.inventory"].bom_for_menu_item = MagicMock(
            return_value={
                "ok": True,
                "data": {
                    "menu_item": "menu-item-001",
                    "bom": None,
                    "ingredients": [],
                    "cost": 0,
                    "menu_price": 500.0,
                    "margin_pct": None,
                },
            }
        )
        menu_management.bom_for_menu_item = sys.modules["the_reezort.fnb.inventory"].bom_for_menu_item
        result = get_menu_item_detail("menu-item-001")
        assert result["data"]["margin"] is None  # no BOM → no margin
        assert result["data"]["recipe"]["bom"] is None

    def test_happy_path_with_recipe(self):
        frappe.db.exists = MagicMock(return_value=True)
        doc = _make_doc(price=500.0)
        frappe.get_doc = MagicMock(return_value=doc)
        sys.modules["the_reezort.fnb.inventory"].bom_for_menu_item = MagicMock(
            return_value={
                "ok": True,
                "data": {
                    "menu_item": "menu-item-001",
                    "bom": "BOM-MENU-TEST-001",
                    "ingredients": [{"item_code": "RAW-CREAM", "qty": 0.5, "rate": 100, "amount": 50}],
                    "cost": 50.0,
                    "menu_price": 500.0,
                    "margin_pct": 90.0,
                },
            }
        )
        menu_management.bom_for_menu_item = sys.modules["the_reezort.fnb.inventory"].bom_for_menu_item
        result = get_menu_item_detail("menu-item-001")
        assert result["data"]["margin"] == 450.0  # 500 - 50
        assert result["data"]["margin_pct"] == 90.0

    def test_unknown_menu_item_raises(self):
        frappe.db.exists = MagicMock(return_value=False)
        frappe.throw = MagicMock(side_effect=Exception("Unknown Menu Item"))
        with self.assertRaises(Exception):
            get_menu_item_detail("bad-name")


class TestMenuItemDict(unittest.TestCase):
    def test_all_expected_keys_present(self):
        doc = _make_doc()
        d = _menu_item_dict(doc)
        expected_keys = {
            "name", "outlet", "item_name", "item_code_short", "erpnext_item",
            "category", "price", "currency", "is_available", "description",
            "veg_flag", "spice_level", "prep_time_minutes", "allergens", "tags", "image",
        }
        assert expected_keys == set(d.keys())


if __name__ == "__main__":
    unittest.main()
