"""Tests for the F&B In-Room Dining API (Slice 1)."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, add_to_date, now_datetime, today

from the_reezort.fnb.api import (
	list_menu_items,
	list_outlets,
	list_recent_orders,
	post_room_charge_order,
	seed_fnb_catalog,
)
from the_reezort.pms.api import check_in
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestFnBApi(FrappeTestCase):
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
		cls.room_type = frappe.db.get_value(
			"Room",
			{"resort_property": cls.resort_property, "sellable_status": "Sellable", "is_active": 1},
			"room_type",
		)
		cls.ird_outlet = frappe.db.get_value(
			"FnB Outlet", {"resort_property": cls.resort_property, "outlet_code": "IRD"}, "name"
		)
		cls.restaurant = frappe.db.get_value(
			"FnB Outlet", {"resort_property": cls.resort_property, "outlet_code": "SIGREST"}, "name"
		)

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		for name in frappe.get_all("Approval Policy", pluck="name"):
			frappe.delete_doc("Approval Policy", name, force=True, ignore_permissions=True)
		frappe.db.set_value("Room", {"resort_property": self.resort_property}, "occupancy_status", "Vacant")

	def _in_house_stay(self):
		profile = frappe.get_doc(
			{"doctype": "Guest Profile", "guest_full_name": "F&B Guest",
			 "email": frappe.generate_hash(length=8) + "@example.com"}
		).insert(ignore_permissions=True)
		res = frappe.get_doc(
			{
				"doctype": "Reservation",
				"resort_property": self.resort_property,
				"status": "Confirmed",
				"booking_source": "Direct",
				"arrival_date": today(),
				"departure_date": add_days(today(), 2),
				"currency": self.currency,
				"staying_guest_profile": profile.name,
				"guests": [{"guest_profile": profile.name, "guest_name": "F&B Guest",
				            "guest_type": "Adult", "is_primary_guest": 1}],
				"rooms": [{"room_type": self.room_type, "adults": 2, "children": 0, "status": "Confirmed"}],
			}
		).insert(ignore_permissions=True)
		ci = check_in(res.name)
		return ci["stay"], ci["folio"]

	def _first_two_items(self, outlet):
		return frappe.get_all(
			"Menu Item",
			filters={"outlet": outlet, "is_available": 1},
			fields=["name", "price"],
			limit=2,
		)

	# ----- catalog -----

	def test_seeder_is_idempotent(self):
		before_outlets = frappe.db.count("FnB Outlet", {"resort_property": self.resort_property})
		before_items = frappe.db.count("Menu Item")
		res = seed_fnb_catalog(resort_property=self.resort_property)
		after_outlets = frappe.db.count("FnB Outlet", {"resort_property": self.resort_property})
		after_items = frappe.db.count("Menu Item")
		self.assertEqual(before_outlets, after_outlets)
		self.assertEqual(before_items, after_items)
		self.assertEqual(res["outlets"]["created"], [])
		self.assertEqual(res["items"]["created"], [])

	def test_list_outlets_returns_active_default_first(self):
		out = list_outlets(resort_property=self.resort_property)
		outlets = out["data"]["outlets"]
		self.assertGreaterEqual(len(outlets), 4)
		self.assertEqual(outlets[0]["is_default"], 1)  # IRD sorted to top

	def test_list_menu_items_returns_available_only(self):
		out = list_menu_items(outlet=self.ird_outlet)
		items = out["data"]["items"]
		self.assertGreater(len(items), 0)
		for i in items:
			self.assertTrue(i["item_name"])

	def test_86_item_hidden_from_list(self):
		item = frappe.get_all(
			"Menu Item", filters={"outlet": self.ird_outlet}, pluck="name", limit=1
		)[0]
		frappe.db.set_value("Menu Item", item, "is_available", 0)
		try:
			out = list_menu_items(outlet=self.ird_outlet)
			names = {i["name"] for i in out["data"]["items"]}
			self.assertNotIn(item, names)
		finally:
			frappe.db.set_value("Menu Item", item, "is_available", 1)

	# ----- post -----

	def test_post_creates_folio_line_and_order(self):
		stay, folio = self._in_house_stay()
		a, b = self._first_two_items(self.ird_outlet)
		res = post_room_charge_order(
			stay=stay,
			outlet=self.ird_outlet,
			items=[
				{"menu_item": a["name"], "quantity": 1},
				{"menu_item": b["name"], "quantity": 2},
			],
			chef_notes="No nuts — allergy",
			guest_note="~25 min ETA",
		)
		self.assertFalse(res["data"]["reused"])
		self.assertTrue(res["data"]["folio_line"])
		self.assertTrue(res["data"]["fnb_order"])

		fl = frappe.get_doc("Folio Line", res["data"]["folio_line"])
		self.assertEqual(fl.line_type, "Charge")
		self.assertEqual(fl.source_module, "Restaurant")
		self.assertEqual(fl.source_doctype, "FnB Order")
		self.assertEqual(fl.source_name, res["data"]["fnb_order"])
		self.assertAlmostEqual(float(fl.amount), float(a["price"]) + 2 * float(b["price"]), delta=0.01)

		order = frappe.get_doc("FnB Order", res["data"]["fnb_order"])
		self.assertEqual(order.folio_line, fl.name)
		self.assertEqual(len(order.items), 2)
		self.assertEqual(order.chef_notes, "No nuts — allergy")

	def test_double_post_is_no_op(self):
		stay, _ = self._in_house_stay()
		a = self._first_two_items(self.ird_outlet)[0]
		payload = {
			"stay": stay,
			"outlet": self.ird_outlet,
			"items": [{"menu_item": a["name"], "quantity": 1}],
			"ordered_at": str(now_datetime()),
		}
		first = post_room_charge_order(**payload)
		second = post_room_charge_order(**payload)
		self.assertFalse(first["data"]["reused"])
		self.assertTrue(second["data"]["reused"])
		self.assertEqual(first["data"]["folio_line"], second["data"]["folio_line"])

	def test_empty_basket_refused(self):
		stay, _ = self._in_house_stay()
		with self.assertRaises(frappe.ValidationError):
			post_room_charge_order(stay=stay, outlet=self.ird_outlet, items=[])
		with self.assertRaises(frappe.ValidationError):
			post_room_charge_order(
				stay=stay, outlet=self.ird_outlet,
				items=[{"menu_item": "unknown", "quantity": 0}],
			)

	def test_item_from_wrong_outlet_refused(self):
		stay, _ = self._in_house_stay()
		# Menu items from Signature Restaurant cannot be posted under IRD.
		rest_item = self._first_two_items(self.restaurant)[0]
		with self.assertRaises(frappe.ValidationError):
			post_room_charge_order(
				stay=stay, outlet=self.ird_outlet,
				items=[{"menu_item": rest_item["name"], "quantity": 1}],
			)

	def test_backdate_over_24h_requires_approval(self):
		from the_reezort.approvals.api import ApprovalRequired

		frappe.get_doc(
			{
				"doctype": "Approval Policy",
				"policy_name": "fnb_backdate > 0",
				"action": "fnb_backdate",
				"approver_role": "Resort Manager",
				"threshold_amount": 0,
				"is_active": 1,
			}
		).insert(ignore_permissions=True)

		stay, _ = self._in_house_stay()
		frappe.db.set_value("Stay", stay, "arrival_date", add_days(today(), -5))
		a = self._first_two_items(self.ird_outlet)[0]
		with self.assertRaises(ApprovalRequired):
			post_room_charge_order(
				stay=stay, outlet=self.ird_outlet,
				items=[{"menu_item": a["name"], "quantity": 1}],
				ordered_at=str(add_to_date(now_datetime(), hours=-48)),
			)

	# ----- history -----

	def test_recent_orders_lists_newest_first(self):
		stay, _ = self._in_house_stay()
		# Arrival back-shifted so a -2h order fits inside the window.
		frappe.db.set_value("Stay", stay, "arrival_date", add_days(today(), -3))
		a = self._first_two_items(self.ird_outlet)[0]
		post_room_charge_order(
			stay=stay, outlet=self.ird_outlet,
			items=[{"menu_item": a["name"], "quantity": 1}],
			ordered_at=str(add_to_date(now_datetime(), hours=-2)),
		)
		later = post_room_charge_order(
			stay=stay, outlet=self.ird_outlet,
			items=[{"menu_item": a["name"], "quantity": 2}],
			ordered_at=str(now_datetime()),
		)
		out = list_recent_orders(stay=stay)
		names = [o["name"] for o in out["data"]["orders"]]
		self.assertEqual(names[0], later["data"]["fnb_order"])
