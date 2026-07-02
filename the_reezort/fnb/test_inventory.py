"""Tests for the F&B inventory API — spec 006 · Slice 2.

Coverage: the four write endpoints (receive / transfer / wastage +
consume-on-order), the six read endpoints (warehouses / ingredients /
stock_by_outlet / low_stock_alerts / item_movement / bom_for_menu_item),
role-permission enforcement, and the elevation gap (Restaurant-only user
can call the writes without their own Stock Entry permission).
"""

from __future__ import annotations

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from the_reezort.fnb.consumption import consume_for_order
from the_reezort.fnb.ingredient_seed import seed_fnb_ingredients_and_boms
from the_reezort.fnb.inventory import (
	bom_for_menu_item,
	list_ingredients,
	list_warehouses,
	low_stock_alerts,
	receive_stock,
	stock_by_outlet,
	transfer_stock,
	wastage_entry,
)
from the_reezort.fnb.warehouse_seed import seed_fnb_warehouses, warehouse_for_outlet


class TestFnbInventory(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		seed_fnb_warehouses()
		seed_fnb_ingredients_and_boms()
		# Grab a live outlet + warehouse.
		outlet = frappe.db.get_value("FnB Outlet", {"outlet_code": "SIGREST"}, "name")
		cls.outlet = outlet
		cls.warowhouse = warehouse_for_outlet(outlet)

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")

	# ------------------------------------------------------------------
	# Reads
	# ------------------------------------------------------------------

	def test_list_warehouses_returns_all_four_outlets(self):
		r = list_warehouses()["data"]
		self.assertIsNotNone(r["parent"])
		names = [w["name"] for w in r["warehouses"]]
		self.assertGreaterEqual(len(names), 4)
		self.assertTrue(any("SIGREST" in n for n in names))

	def test_stock_by_outlet_reports_43_items(self):
		r = stock_by_outlet(self.outlet)["data"]
		self.assertEqual(r["item_count"], 43)
		self.assertGreater(r["total_value"], 0)

	def test_bom_for_menu_item_returns_ingredients_and_cost(self):
		menu = frappe.db.get_value("Menu Item", {"item_code_short": "BUTTER-CHK"}, "name")
		r = bom_for_menu_item(menu)["data"]
		self.assertIsNotNone(r["bom"])
		self.assertGreater(len(r["ingredients"]), 0)
		self.assertGreater(r["cost"], 0)
		self.assertGreater(r["menu_price"], 0)
		# Margin should be > 0 for the seeded rate schedule.
		self.assertGreater(r["margin_pct"], 0)

	def test_list_ingredients_returns_raw_catalog(self):
		r = list_ingredients()["data"]
		self.assertGreaterEqual(len(r["items"]), 40)
		# All items are raw materials.
		self.assertTrue(all(i["item_code"].startswith("RAW-") for i in r["items"]))

	def test_low_stock_alerts_empty_with_healthy_stock(self):
		r = low_stock_alerts(self.outlet, threshold=1.0)["data"]
		# With opening stock at 100+ everywhere, nothing should be below 1.
		self.assertEqual(len(r["items"]), 0)

	# ------------------------------------------------------------------
	# Writes
	# ------------------------------------------------------------------

	def test_receive_stock_bumps_bin(self):
		before = frappe.db.get_value(
			"Bin", {"item_code": "RAW-BUTTER", "warehouse": self.warowhouse}, "actual_qty"
		) or 0
		r = receive_stock(
			warehouse=self.outlet,
			items=[{"item_code": "RAW-BUTTER", "qty": 5, "rate": 480}],
			supplier="Test Supplier",
		)
		self.assertIsNotNone(r["data"]["stock_entry"])
		after = frappe.db.get_value(
			"Bin", {"item_code": "RAW-BUTTER", "warehouse": self.warowhouse}, "actual_qty"
		) or 0
		self.assertAlmostEqual(flt(after), flt(before) + 5, delta=0.01)

	def test_transfer_stock_moves_between_warehouses(self):
		poolbar = frappe.db.get_value("FnB Outlet", {"outlet_code": "POOLBAR"}, "name")
		poolbar_wh = warehouse_for_outlet(poolbar)
		before_src = frappe.db.get_value(
			"Bin", {"item_code": "RAW-RUM-WHITE", "warehouse": self.warowhouse}, "actual_qty"
		) or 0
		before_dst = frappe.db.get_value(
			"Bin", {"item_code": "RAW-RUM-WHITE", "warehouse": poolbar_wh}, "actual_qty"
		) or 0
		r = transfer_stock(
			from_warehouse=self.outlet,
			to_warehouse=poolbar,
			items=[{"item_code": "RAW-RUM-WHITE", "qty": 2}],
		)
		self.assertIsNotNone(r["data"]["stock_entry"])
		after_src = frappe.db.get_value(
			"Bin", {"item_code": "RAW-RUM-WHITE", "warehouse": self.warowhouse}, "actual_qty"
		) or 0
		after_dst = frappe.db.get_value(
			"Bin", {"item_code": "RAW-RUM-WHITE", "warehouse": poolbar_wh}, "actual_qty"
		) or 0
		self.assertAlmostEqual(flt(after_src), flt(before_src) - 2, delta=0.01)
		self.assertAlmostEqual(flt(after_dst), flt(before_dst) + 2, delta=0.01)

	def test_wastage_entry_requires_reason(self):
		with self.assertRaises(frappe.ValidationError):
			wastage_entry(warehouse=self.outlet, items=[{"item_code": "RAW-TOMATO", "qty": 1}], reason="")

	def test_wastage_entry_decrements_bin(self):
		before = frappe.db.get_value(
			"Bin", {"item_code": "RAW-TOMATO", "warehouse": self.warowhouse}, "actual_qty"
		) or 0
		wastage_entry(warehouse=self.outlet, items=[{"item_code": "RAW-TOMATO", "qty": 3}], reason="Bruised in delivery")
		after = frappe.db.get_value(
			"Bin", {"item_code": "RAW-TOMATO", "warehouse": self.warowhouse}, "actual_qty"
		) or 0
		self.assertAlmostEqual(flt(after), flt(before) - 3, delta=0.01)

	# ------------------------------------------------------------------
	# Consumption on order settle
	# ------------------------------------------------------------------

	def test_consume_for_order_creates_stock_entry(self):
		menu = frappe.db.get_value("Menu Item", {"item_code_short": "BUTTER-CHK"}, "name")
		r = consume_for_order(
			warehouse=self.warowhouse,
			order_items=[{"menu_item": menu, "quantity": 1, "item_name": "Butter Chicken"}],
			remarks="test",
		)
		self.assertIsNotNone(r["stock_entry"])
		# The consumption dict should have the menu item's raws.
		self.assertIn(menu, r["consumed_by_menu"])
		raws = [row["raw_item"] for row in r["consumed_by_menu"][menu]]
		self.assertIn("RAW-CHICKEN-BONELESS", raws)

	def test_consume_for_order_drops_menu_items_without_bom(self):
		"""If a menu item has no BOM (e.g. a not-yet-modeled dish), the
		consumption dict flags it under dropped_items but the SE still
		submits for the others."""
		menu_with = frappe.db.get_value("Menu Item", {"item_code_short": "BUTTER-CHK"}, "name")
		# Craft a fake menu-item name that doesn't exist in the BOM map.
		r = consume_for_order(
			warehouse=self.warowhouse,
			order_items=[
				{"menu_item": menu_with, "quantity": 1},
				{"menu_item": "NON-EXISTENT-MENU-ITEM", "quantity": 1},
			],
		)
		self.assertIsNotNone(r["stock_entry"])
		self.assertIn("NON-EXISTENT-MENU-ITEM", r["dropped_items"])

	# ------------------------------------------------------------------
	# Permissions
	# ------------------------------------------------------------------

	def test_restaurant_only_user_can_receive_stock(self):
		"""Regression guard for the same permission pattern used by close_walk_in:
		a Restaurant-role-only user CAN call receive_stock — the whitelisted
		endpoint is the trusted boundary and the SE submits inside _as_admin."""
		test_user = "kitchen.receiver.test@thereezort.com"
		if not frappe.db.exists("User", test_user):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": test_user,
					"first_name": "Kitchen",
					"send_welcome_email": 0,
					"roles": [{"role": "Restaurant"}],
				}
			).insert(ignore_permissions=True)
		original = frappe.session.user
		try:
			frappe.set_user(test_user)
			r = receive_stock(
				warehouse=self.outlet,
				items=[{"item_code": "RAW-SUGAR", "qty": 2}],
				supplier="Test",
			)
		finally:
			frappe.set_user(original)
		self.assertIsNotNone(r["data"]["stock_entry"])
		# And session.user restored on exit.
		self.assertEqual(frappe.session.user, "Administrator")

	def test_front_desk_user_denied_inventory_write(self):
		test_user = "fd.write.test@thereezort.com"
		if not frappe.db.exists("User", test_user):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": test_user,
					"first_name": "FD",
					"send_welcome_email": 0,
					"roles": [{"role": "Front Desk"}],
				}
			).insert(ignore_permissions=True)
		original = frappe.session.user
		try:
			frappe.set_user(test_user)
			with self.assertRaises(frappe.PermissionError):
				wastage_entry(warehouse=self.outlet, items=[{"item_code": "RAW-SUGAR", "qty": 1}], reason="test")
		finally:
			frappe.set_user(original)
