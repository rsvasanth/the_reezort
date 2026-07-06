"""Tests for the F&B POS depth cluster (006):
multi-round KOT, multi-payment settlement, service charge on the invoice,
and charge-to-room posting.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, today

from the_reezort.fnb.api import seed_fnb_catalog
from the_reezort.fnb.restaurant import (
	add_items,
	close_walk_in,
	create_room_service_order,
	list_active_kots,
	mark_kot_status,
	open_walk_in_order,
	post_order_to_room,
	send_to_kitchen,
)
from the_reezort.fnb.table_seed import seed_restaurant_tables
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestPosDepth(FrappeTestCase):
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
		# These endpoints commit, so F&B folio lines persist across tests and can
		# collide on the global idempotency_key constraint — clear them each test.
		for name in frappe.get_all("Folio Line", filters={"source_doctype": "Restaurant Order"}, pluck="name"):
			frappe.delete_doc("Folio Line", name, force=True, ignore_permissions=True)
		frappe.db.commit()

	def _items(self, n=2):
		return frappe.get_all(
			"Menu Item", filters={"outlet": self.outlet, "is_available": 1}, fields=["name", "price"], limit=n
		)

	def _table(self):
		return frappe.db.get_value("Restaurant Table", {"outlet": self.outlet, "is_active": 1}, "name")

	def _open_with_items(self, item_rows):
		order = open_walk_in_order(self.outlet, self._table())["data"]["order"]["name"]
		add_items(order, [{"menu_item": r["name"], "quantity": 1} for r in item_rows])
		return order

	# ---------- multi-round KOT ----------

	def test_second_round_after_kitchen_send(self):
		items = self._items(2)
		order = self._open_with_items([items[0]])
		send_to_kitchen(order)  # round 1
		state_after_r1 = frappe.db.get_value("Restaurant Order", order, "state")

		# Add a second round and fire it — previously this raised on non-Draft state.
		add_items(order, [{"menu_item": items[1]["name"], "quantity": 2}])
		out = send_to_kitchen(order)["data"]["order"]
		# The order kept its progressed state and now has both items, all Sent.
		self.assertEqual(frappe.db.get_value("Restaurant Order", order, "state"), state_after_r1)
		self.assertEqual(len(out["items"]), 2)
		doc = frappe.get_doc("Restaurant Order", order)
		self.assertTrue(all(i.line_status != "Draft" for i in doc.items))

	def test_send_with_no_new_items_is_rejected(self):
		order = self._open_with_items(self._items(1))
		send_to_kitchen(order)
		with self.assertRaises(frappe.ValidationError):
			send_to_kitchen(order)  # nothing new to fire

	# ---------- service charge on the invoice ----------

	def test_service_charge_is_billed_on_invoice(self):
		items = self._items(1)
		order = self._open_with_items([items[0]])
		# Set the service-charge rate and re-save so the controller rolls it up.
		doc = frappe.get_doc("Restaurant Order", order)
		doc.service_charge_pct = 10
		doc.save(ignore_permissions=True)
		self.assertGreater(flt(doc.service_charge_amount), 0)
		send_to_kitchen(order)
		frappe.db.set_value("Restaurant Order", order, "state", "Served")

		out = close_walk_in(order, payments=[{"mode_of_payment": "Cash"}])["data"]
		si = frappe.get_doc("Sales Invoice", out["sales_invoice"])
		# The service-charge item appears as its own invoice line.
		self.assertTrue(any(row.item_code == "FNB-SERVICE-CHARGE" for row in si.items))

	# ---------- multi-payment ----------

	def test_multi_payment_creates_multiple_entries(self):
		items = self._items(2)
		order = self._open_with_items(items)
		send_to_kitchen(order)
		frappe.db.set_value("Restaurant Order", order, "state", "Served")

		# First a fixed small cash payment, then card clears the rest — two
		# entries, invoice fully settled regardless of tax rounding.
		out = close_walk_in(
			order,
			payments=[
				{"mode_of_payment": "Cash", "amount": 50},
				{"mode_of_payment": "Cash"},  # no amount -> clears remaining
			],
		)["data"]
		self.assertEqual(len(out["payment_entries"]), 2)
		si = frappe.get_doc("Sales Invoice", out["sales_invoice"])
		self.assertEqual(flt(si.outstanding_amount), 0)

	# ---------- charge to room ----------

	def _in_house_stay(self):
		# Unique customer per stay — these endpoints commit, so a shared customer
		# would reuse a prior test's folio and collide on idempotency keys.
		cname = f"ZZ Dine Guest {frappe.generate_hash(length=6)}"
		customer = frappe.get_doc(
			{
				"doctype": "Customer",
				"customer_name": cname,
				"customer_group": "Individual",
				"territory": "All Territories",
			}
		).insert(ignore_permissions=True).name
		room = frappe.db.get_value("Room", {"resort_property": self.resort_property}, ["name", "room_type"], as_dict=True)
		stay = frappe.get_doc({
			"doctype": "Stay",
			"resort_property": self.resort_property,
			"customer": customer,
			"primary_guest_name": "Dine In Guest",
			"stay_status": "In House",
			"current_room": room.name,
			"arrival_date": today(),
			"departure_date": frappe.utils.add_days(today(), 2),
			"room_type": room.room_type,
			"adult_count": 1,
			"folio_status": "Not Created",
		}).insert(ignore_permissions=True)
		return stay.name

	def test_charge_to_room_posts_folio_lines(self):
		items = self._items(2)
		order = self._open_with_items(items)
		send_to_kitchen(order)
		frappe.db.set_value("Restaurant Order", order, "state", "Served")
		stay = self._in_house_stay()

		out = post_order_to_room(order, stay)["data"]
		folio = out["guest_folio"]
		self.assertTrue(folio)
		self.assertGreaterEqual(len(out["folio_lines"]), 2)
		# Order is settled and linked to the folio; lines carry item codes for GST.
		self.assertEqual(frappe.db.get_value("Restaurant Order", order, "state"), "Settled")
		lines = frappe.get_all(
			"Folio Line", filters={"guest_folio": folio, "source_doctype": "Restaurant Order"},
			fields=["item_code", "amount"],
		)
		self.assertTrue(all(line.item_code for line in lines))

	def test_charge_to_room_rejects_non_in_house(self):
		order = self._open_with_items(self._items(1))
		send_to_kitchen(order)
		frappe.db.set_value("Restaurant Order", order, "state", "Served")
		stay = self._in_house_stay()
		frappe.db.set_value("Stay", stay, "stay_status", "Checked Out")
		with self.assertRaises(frappe.ValidationError):
			post_order_to_room(order, stay)

	# ---------- in-room dining → kitchen KOT bridge ----------

	def test_room_service_order_hits_the_kitchen_queue(self):
		stay = self._in_house_stay()
		items = self._items(2)
		out = create_room_service_order(
			stay=stay,
			outlet=self.outlet,
			items=[{"menu_item": r["name"], "quantity": 1} for r in items],
			guest_note="no onions",
		)["data"]["order"]
		# It's a Room-billed order, fired to the kitchen with a KOT.
		self.assertEqual(out["bill_type"], "Room")
		self.assertEqual(out["stay"], stay)
		self.assertTrue(out["kot_number"])
		self.assertEqual(out["state"], "Sent to Kitchen")
		# It appears on the SAME kitchen queue as POS table orders.
		kot_names = [o["name"] for o in list_active_kots(self.outlet)["data"]["orders"]]
		self.assertIn(out["name"], kot_names)

	def test_room_service_order_closes_to_folio_not_invoice(self):
		stay = self._in_house_stay()
		order = create_room_service_order(
			stay=stay, outlet=self.outlet, items=[{"menu_item": self._items(1)[0]["name"], "quantity": 1}]
		)["data"]["order"]["name"]
		frappe.db.set_value("Restaurant Order", order, "state", "Served")
		# close_walk_in routes a Room order to the folio, not a POS Sales Invoice.
		out = close_walk_in(order)["data"]
		self.assertTrue(out.get("guest_folio"))
		self.assertIsNone(frappe.db.get_value("Restaurant Order", order, "erpnext_sales_invoice"))
		self.assertEqual(frappe.db.get_value("Restaurant Order", order, "state"), "Settled")

	def test_room_service_auto_charges_folio_on_served(self):
		stay = self._in_house_stay()
		order = create_room_service_order(
			stay=stay, outlet=self.outlet, items=[{"menu_item": self._items(1)[0]["name"], "quantity": 1}]
		)["data"]["order"]["name"]
		# Walk it through the kitchen; marking Served auto-charges the folio.
		mark_kot_status(order, "Preparing")
		mark_kot_status(order, "Ready")
		out = mark_kot_status(order, "Served")["data"]["order"]
		self.assertTrue(out["guest_folio"])
		self.assertEqual(frappe.db.get_value("Restaurant Order", order, "state"), "Settled")

	def test_room_service_rejects_non_in_house(self):
		stay = self._in_house_stay()
		frappe.db.set_value("Stay", stay, "stay_status", "Checked Out")
		with self.assertRaises(frappe.ValidationError):
			create_room_service_order(
				stay=stay, outlet=self.outlet, items=[{"menu_item": self._items(1)[0]["name"], "quantity": 1}]
			)
