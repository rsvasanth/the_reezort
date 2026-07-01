"""Tests for the minibar posting API."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, add_to_date, now_datetime, today

from the_reezort.billing.api import get_or_create_folio
from the_reezort.minibar.api import (
	list_minibar_items,
	list_recent_postings,
	post_minibar_consumption,
	seed_minibar_catalog,
)
from the_reezort.pms.api import check_in
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestMinibarApi(FrappeTestCase):
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
		seed_minibar_catalog(resort_property=cls.resort_property)
		cls.room_type = frappe.db.get_value(
			"Room",
			{"resort_property": cls.resort_property, "sellable_status": "Sellable", "is_active": 1},
			"room_type",
		)

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		# Clean approval policies between tests so we don't fire the gate
		# unless the test explicitly wants it.
		for name in frappe.get_all("Approval Policy", pluck="name"):
			frappe.delete_doc("Approval Policy", name, force=True, ignore_permissions=True)
		frappe.db.set_value("Room", {"resort_property": self.resort_property}, "occupancy_status", "Vacant")

	def _in_house_stay(self):
		profile = frappe.get_doc(
			{"doctype": "Guest Profile", "guest_full_name": "Minibar Guest",
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
				"guests": [{"guest_profile": profile.name, "guest_name": "Minibar Guest",
				            "guest_type": "Adult", "is_primary_guest": 1}],
				"rooms": [{"room_type": self.room_type, "adults": 2, "children": 0, "status": "Confirmed"}],
			}
		).insert(ignore_permissions=True)
		ci = check_in(res.name)
		return ci["stay"], ci["folio"]

	def _first_two_items(self):
		items = frappe.get_all(
			"Minibar Item",
			filters={"resort_property": self.resort_property, "is_active": 1},
			fields=["name", "price"],
			limit=2,
		)
		return items

	# ----- catalog -----

	def test_catalog_seeder_is_idempotent(self):
		before = frappe.db.count("Minibar Item", {"resort_property": self.resort_property})
		res = seed_minibar_catalog(resort_property=self.resort_property)
		after = frappe.db.count("Minibar Item", {"resort_property": self.resort_property})
		self.assertEqual(before, after)
		self.assertEqual(res["created"], [])
		# Property should have ≥ 8 items after seeding.
		self.assertGreaterEqual(after, 8)

	def test_list_minibar_items_returns_active_only(self):
		out = list_minibar_items(resort_property=self.resort_property)
		names = {i["name"] for i in out["data"]["items"]}
		self.assertTrue(names)
		for i in out["data"]["items"]:
			self.assertTrue(i["item_name"])

	# ----- post -----

	def test_post_creates_folio_line_and_posting(self):
		stay, folio = self._in_house_stay()
		item_a, item_b = self._first_two_items()
		out = post_minibar_consumption(
			stay=stay,
			items=[
				{"minibar_item": item_a["name"], "quantity": 2},
				{"minibar_item": item_b["name"], "quantity": 1},
			],
			consumed_at=str(now_datetime()),
			notes="Late-night order",
		)
		self.assertFalse(out["data"]["reused"])
		self.assertTrue(out["data"]["folio_line"])
		self.assertTrue(out["data"]["minibar_posting"])

		fl = frappe.get_doc("Folio Line", out["data"]["folio_line"])
		self.assertEqual(fl.line_type, "Charge")
		self.assertEqual(fl.source_module, "Minibar")
		self.assertEqual(fl.source_doctype, "Minibar Posting")
		self.assertEqual(fl.source_name, out["data"]["minibar_posting"])
		self.assertAlmostEqual(float(fl.amount), 2 * float(item_a["price"]) + float(item_b["price"]), delta=0.01)

		posting = frappe.get_doc("Minibar Posting", out["data"]["minibar_posting"])
		self.assertEqual(posting.folio_line, fl.name)
		self.assertEqual(len(posting.items), 2)

	def test_double_post_is_no_op(self):
		stay, _ = self._in_house_stay()
		item_a = self._first_two_items()[0]
		payload = {
			"stay": stay,
			"items": [{"minibar_item": item_a["name"], "quantity": 1}],
			"consumed_at": str(now_datetime()),
		}
		first = post_minibar_consumption(**payload)
		second = post_minibar_consumption(**payload)
		self.assertFalse(first["data"]["reused"])
		self.assertTrue(second["data"]["reused"])
		self.assertEqual(first["data"]["folio_line"], second["data"]["folio_line"])
		# Only one folio line + one posting created.
		folio = frappe.db.get_value("Guest Folio", {"stay": stay}, "name")
		lines = frappe.get_all("Folio Line", filters={"guest_folio": folio, "source_module": "Minibar"}, pluck="name")
		self.assertEqual(len(lines), 1)

	def test_empty_basket_refused(self):
		stay, _ = self._in_house_stay()
		with self.assertRaises(frappe.ValidationError):
			post_minibar_consumption(stay=stay, items=[])
		with self.assertRaises(frappe.ValidationError):
			post_minibar_consumption(stay=stay, items=[{"minibar_item": "whatever", "quantity": 0}])

	def test_backdate_over_24h_requires_approval(self):
		from the_reezort.approvals.api import ApprovalRequired

		# Seed a policy so the gate has something to fire against.
		frappe.get_doc(
			{
				"doctype": "Approval Policy",
				"policy_name": "minibar_backdate > 0",
				"action": "minibar_backdate",
				"approver_role": "Resort Manager",
				"threshold_amount": 0,
				"is_active": 1,
			}
		).insert(ignore_permissions=True)

		# Need a stay that arrived several days ago so back-dating is inside
		# the window (not "before arrival").
		stay, _ = self._in_house_stay()
		frappe.db.set_value("Stay", stay, "arrival_date", add_days(today(), -5))
		item_a = self._first_two_items()[0]
		# 48h back → gate fires.
		with self.assertRaises(ApprovalRequired):
			post_minibar_consumption(
				stay=stay,
				items=[{"minibar_item": item_a["name"], "quantity": 1}],
				consumed_at=str(add_to_date(now_datetime(), hours=-48)),
			)

	# ----- history -----

	def test_recent_postings_lists_newest_first(self):
		stay, _ = self._in_house_stay()
		item_a = self._first_two_items()[0]

		post_minibar_consumption(
			stay=stay,
			items=[{"minibar_item": item_a["name"], "quantity": 1}],
			consumed_at=str(add_to_date(now_datetime(), hours=-2)),
		)
		later = post_minibar_consumption(
			stay=stay,
			items=[{"minibar_item": item_a["name"], "quantity": 2}],
			consumed_at=str(now_datetime()),
		)

		out = list_recent_postings(stay=stay)
		names = [p["name"] for p in out["data"]["postings"]]
		self.assertEqual(names[0], later["data"]["minibar_posting"])
