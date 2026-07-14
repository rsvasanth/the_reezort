"""Split-bill settlement tests — spec 006 Workflow 5."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, today

from the_reezort.fnb.api import seed_fnb_catalog
from the_reezort.fnb.restaurant import add_items, open_walk_in_order, send_to_kitchen
from the_reezort.fnb.split import (
	create_split_plan,
	list_splits,
	settle_split,
	cancel_split_plan,
)
from the_reezort.fnb.table_seed import seed_restaurant_tables
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestSplitBill(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]
		seed_fnb_catalog(resort_property=cls.resort_property)
		seed_restaurant_tables(resort_property=cls.resort_property)
		cls.outlet = frappe.db.get_value(
			"FnB Outlet", {"resort_property": cls.resort_property, "outlet_code": "SIGREST"}, "name"
		)

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		for name in frappe.get_all("Restaurant Order", filters={"outlet": self.outlet}, pluck="name"):
			frappe.delete_doc("Restaurant Order", name, force=True, ignore_permissions=True)

	# ---------- fixtures ----------

	def _items(self, n=2):
		return frappe.get_all(
			"Menu Item", filters={"outlet": self.outlet, "is_available": 1}, fields=["name", "price"], limit=n
		)

	def _table(self):
		return frappe.db.get_value("Restaurant Table", {"outlet": self.outlet, "is_active": 1}, "name")

	def _served_order(self, qtys=(2, 1)):
		"""Open an order with len(qtys) distinct items at the given quantities,
		fire it, and mark it Served — ready to split."""
		items = self._items(len(qtys))
		order = open_walk_in_order(self.outlet, self._table())["data"]["order"]["name"]
		add_items(order, [{"menu_item": items[i]["name"], "quantity": q} for i, q in enumerate(qtys)])
		send_to_kitchen(order)
		frappe.db.set_value("Restaurant Order", order, "state", "Served")
		return frappe.get_doc("Restaurant Order", order)

	def _in_house_stay(self):
		cname = f"ZZ Split Guest {frappe.generate_hash(length=6)}"
		customer = frappe.get_doc(
			{"doctype": "Customer", "customer_name": cname, "customer_group": "Individual", "territory": "All Territories"}
		).insert(ignore_permissions=True).name
		room = frappe.db.get_value("Room", {"resort_property": self.resort_property}, ["name", "room_type"], as_dict=True)
		stay = frappe.get_doc(
			{
				"doctype": "Stay",
				"resort_property": self.resort_property,
				"customer": customer,
				"primary_guest_name": "Split Guest",
				"stay_status": "In House",
				"current_room": room.name,
				"arrival_date": today(),
				"departure_date": frappe.utils.add_days(today(), 2),
				"room_type": room.room_type,
				"adult_count": 1,
				"folio_status": "Not Created",
			}
		).insert(ignore_permissions=True)
		return stay.name

	def _rows(self, order):
		return [{"row": r.name, "qty": flt(r.quantity)} for r in order.items]

	# ---------- item split ----------

	def test_item_split_two_direct_portions_settle_and_finalize(self):
		order = self._served_order(qtys=(2, 1))
		rows = self._rows(order)
		# Portion A takes item 0 (qty 2); portion B takes item 1 (qty 1).
		plan = create_split_plan(
			order.name,
			"Item",
			[
				{"label": "Alice", "settlement_mode": "Direct", "items": [{"order_item": rows[0]["row"], "qty": 2}]},
				{"label": "Bob", "settlement_mode": "Direct", "items": [{"order_item": rows[1]["row"], "qty": 1}]},
			],
		)["data"]["splits"]
		self.assertEqual(len(plan), 2)

		# Settling the first does NOT finalize the order.
		r1 = settle_split(plan[0]["name"], payments=[{"mode_of_payment": "Cash"}])["data"]
		self.assertFalse(r1["order_settled"])
		self.assertTrue(r1["split"]["erpnext_sales_invoice"])
		self.assertEqual(frappe.db.get_value("Restaurant Order", order.name, "state"), "Served")

		# Settling the last finalizes the parent order.
		r2 = settle_split(plan[1]["name"], payments=[{"mode_of_payment": "Cash"}])["data"]
		self.assertTrue(r2["order_settled"])
		self.assertEqual(frappe.db.get_value("Restaurant Order", order.name, "state"), "Settled")

	def test_item_split_rejects_incomplete_coverage(self):
		order = self._served_order(qtys=(2, 1))
		rows = self._rows(order)
		# Only allocate item 0 — item 1 is left uncovered.
		with self.assertRaises(frappe.ValidationError):
			create_split_plan(
				order.name,
				"Item",
				[{"label": "Alice", "settlement_mode": "Direct", "items": [{"order_item": rows[0]["row"], "qty": 2}]}],
			)

	def test_item_split_rejects_over_allocation(self):
		order = self._served_order(qtys=(2, 1))
		rows = self._rows(order)
		with self.assertRaises(frappe.ValidationError):
			create_split_plan(
				order.name,
				"Item",
				[
					{"label": "A", "settlement_mode": "Direct", "items": [{"order_item": rows[0]["row"], "qty": 3}]},
					{"label": "B", "settlement_mode": "Direct", "items": [{"order_item": rows[1]["row"], "qty": 1}]},
				],
			)

	# ---------- mixed direct + room ----------

	def test_item_split_direct_plus_room(self):
		order = self._served_order(qtys=(2, 1))
		rows = self._rows(order)
		stay = self._in_house_stay()
		plan = create_split_plan(
			order.name,
			"Item",
			[
				{"label": "Pay now", "settlement_mode": "Direct", "items": [{"order_item": rows[0]["row"], "qty": 2}]},
				{"label": "To room", "settlement_mode": "Room", "stay": stay, "items": [{"order_item": rows[1]["row"], "qty": 1}]},
			],
		)["data"]["splits"]

		direct = settle_split(plan[0]["name"], payments=[{"mode_of_payment": "Cash"}])["data"]["split"]
		self.assertTrue(direct["erpnext_sales_invoice"])

		room = settle_split(plan[1]["name"], stay=stay)["data"]
		self.assertTrue(room["split"]["guest_folio"])
		self.assertTrue(room["order_settled"])
		# Folio carries the room portion's charge line.
		lines = frappe.get_all(
			"Folio Line",
			filters={"guest_folio": room["split"]["guest_folio"], "source_doctype": "FnB Bill Split"},
			pluck="name",
		)
		self.assertTrue(lines)

	# ---------- amount split ----------

	def test_amount_split_must_sum_to_grand_total(self):
		order = self._served_order(qtys=(2, 1))
		grand = flt(order.grand_total)
		# Wrong sum → rejected.
		with self.assertRaises(frappe.ValidationError):
			create_split_plan(
				order.name,
				"Amount",
				[
					{"label": "A", "settlement_mode": "Direct", "amount": grand - 100},
					{"label": "B", "settlement_mode": "Direct", "amount": 50},
				],
			)
		# Correct sum → two value portions, no item detail.
		plan = create_split_plan(
			order.name,
			"Amount",
			[
				{"label": "A", "settlement_mode": "Direct", "amount": grand / 2},
				{"label": "B", "settlement_mode": "Direct", "amount": grand / 2},
			],
		)["data"]["splits"]
		self.assertEqual(len(plan), 2)
		self.assertEqual(plan[0]["items"], [])

	# ---------- percentage split ----------

	def test_percentage_split_apportions_and_sums(self):
		order = self._served_order(qtys=(2, 1))
		plan = create_split_plan(
			order.name,
			"Percentage",
			[
				{"label": "A", "settlement_mode": "Direct", "percentage": 60},
				{"label": "B", "settlement_mode": "Direct", "percentage": 40},
			],
		)["data"]["splits"]
		total = sum(flt(p["grand_total"]) for p in plan)
		self.assertAlmostEqual(total, flt(order.grand_total), delta=0.05)

	def test_percentage_must_sum_to_100(self):
		order = self._served_order()
		with self.assertRaises(frappe.ValidationError):
			create_split_plan(
				order.name,
				"Percentage",
				[
					{"label": "A", "settlement_mode": "Direct", "percentage": 60},
					{"label": "B", "settlement_mode": "Direct", "percentage": 30},
				],
			)

	# ---------- re-plan + idempotency ----------

	def test_replan_replaces_draft_but_not_after_settle(self):
		order = self._served_order(qtys=(2, 1))
		rows = self._rows(order)
		full = [
			{"label": "A", "settlement_mode": "Direct", "items": [{"order_item": rows[0]["row"], "qty": 2}]},
			{"label": "B", "settlement_mode": "Direct", "items": [{"order_item": rows[1]["row"], "qty": 1}]},
		]
		p1 = create_split_plan(order.name, "Item", full)["data"]["splits"]
		# Re-plan while all Draft → replaces (still 2 splits, fresh names).
		p2 = create_split_plan(order.name, "Item", full)["data"]["splits"]
		self.assertEqual(len(list_splits(order.name)["data"]["splits"]), 2)
		self.assertNotEqual({s["name"] for s in p1}, {s["name"] for s in p2})

		# Settle one, then re-planning must fail.
		settle_split(p2[0]["name"], payments=[{"mode_of_payment": "Cash"}])
		with self.assertRaises(frappe.ValidationError):
			create_split_plan(order.name, "Item", full)

	def test_settling_twice_is_idempotent(self):
		order = self._served_order(qtys=(2, 1))
		rows = self._rows(order)
		plan = create_split_plan(
			order.name,
			"Item",
			[
				{"label": "A", "settlement_mode": "Direct", "items": [{"order_item": rows[0]["row"], "qty": 2}]},
				{"label": "B", "settlement_mode": "Direct", "items": [{"order_item": rows[1]["row"], "qty": 1}]},
			],
		)["data"]["splits"]
		first = settle_split(plan[0]["name"], payments=[{"mode_of_payment": "Cash"}])["data"]["split"]
		again = settle_split(plan[0]["name"], payments=[{"mode_of_payment": "Cash"}])["data"]
		self.assertTrue(again["reused"])
		self.assertEqual(first["erpnext_sales_invoice"], again["split"]["erpnext_sales_invoice"])

	def test_cancel_plan_removes_draft_splits(self):
		order = self._served_order(qtys=(2, 1))
		rows = self._rows(order)
		create_split_plan(
			order.name,
			"Item",
			[
				{"label": "A", "settlement_mode": "Direct", "items": [{"order_item": rows[0]["row"], "qty": 2}]},
				{"label": "B", "settlement_mode": "Direct", "items": [{"order_item": rows[1]["row"], "qty": 1}]},
			],
		)
		cancel_split_plan(order.name)
		self.assertEqual(list_splits(order.name)["data"]["splits"], [])
