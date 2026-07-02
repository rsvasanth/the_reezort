"""Tests for the linen count / restock API."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import now_datetime, today

from the_reezort.housekeeping.linen import (
	get_linen_catalog,
	get_room_par,
	list_recent_counts,
	post_linen_count,
	seed_linen_catalog,
)
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestLinenApi(FrappeTestCase):
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
		seed_linen_catalog(resort_property=cls.resort_property)
		cls.room = frappe.db.get_value(
			"Room", {"resort_property": cls.resort_property, "is_active": 1}, "name"
		)

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		# Clear approval policies + any Linen Movements for this room today.
		for name in frappe.get_all("Approval Policy", pluck="name"):
			frappe.delete_doc("Approval Policy", name, force=True, ignore_permissions=True)
		for name in frappe.get_all(
			"Linen Movement",
			filters={"room": self.room, "counted_at": ["between", [f"{today()} 00:00:00", f"{today()} 23:59:59"]]},
			pluck="name",
		):
			try:
				frappe.delete_doc("Linen Movement", name, force=True, ignore_permissions=True)
			except Exception:
				pass
		# Clear any restock tasks tied to this room today.
		for name in frappe.get_all(
			"Housekeeping Task",
			filters={"room": self.room, "task_type": "Linen Restock"},
			pluck="name",
		):
			try:
				frappe.delete_doc("Housekeeping Task", name, force=True, ignore_permissions=True)
			except Exception:
				pass
		frappe.db.commit()

	# ----- catalog -----

	def test_seeder_is_idempotent(self):
		before = frappe.db.count("Linen Item", {"resort_property": self.resort_property})
		out = seed_linen_catalog(resort_property=self.resort_property)
		after = frappe.db.count("Linen Item", {"resort_property": self.resort_property})
		self.assertEqual(before, after)
		self.assertEqual(out["created"], [])
		self.assertGreaterEqual(after, 5)

	def test_get_catalog_returns_active(self):
		out = get_linen_catalog(resort_property=self.resort_property)
		self.assertGreater(len(out["data"]["items"]), 0)

	# ----- par resolution -----

	def test_get_room_par_returns_room_type_default(self):
		out = get_room_par(room=self.room)
		items = out["data"]["items"]
		self.assertGreater(len(items), 0)
		# Every seeded item has a par > 0 because the seeder pre-populated
		# room-type pars.
		self.assertTrue(all(int(i["par"]) > 0 for i in items))

	def test_get_room_par_room_override_wins(self):
		items = frappe.get_all(
			"Linen Item", filters={"resort_property": self.resort_property}, pluck="name", limit=1
		)
		item = items[0]
		# Override par for this specific room.
		frappe.get_doc(
			{
				"doctype": "Linen Par",
				"resort_property": self.resort_property,
				"linen_item": item,
				"room": self.room,
				"par_quantity": 99,
			}
		).insert(ignore_permissions=True)
		out = get_room_par(room=self.room)
		match = next(i for i in out["data"]["items"] if i["name"] == item)
		self.assertEqual(match["par"], 99)

	# ----- post -----

	def _first_two_linen_items(self):
		return frappe.get_all(
			"Linen Item",
			filters={"resort_property": self.resort_property, "is_active": 1},
			fields=["name", "unit_cost"],
			limit=2,
		)

	def test_full_count_no_shortage_no_restock(self):
		a, b = self._first_two_linen_items()
		out = post_linen_count(
			room=self.room,
			counts=[
				{"linen_item": a["name"], "par": 4, "found": 4},
				{"linen_item": b["name"], "par": 4, "found": 4},
			],
			phase="Departure",
			notes="Clean departure",
		)
		self.assertFalse(out["data"]["reused"])
		self.assertIsNone(out["data"]["restock_task"])
		self.assertEqual(out["data"]["short_count"], 0)

	def test_below_par_creates_restock_task(self):
		a, _ = self._first_two_linen_items()
		out = post_linen_count(
			room=self.room,
			counts=[{"linen_item": a["name"], "par": 4, "found": 3, "missing": 1}],
			phase="Departure",
		)
		self.assertIsNotNone(out["data"]["restock_task"])
		self.assertEqual(out["data"]["short_count"], 1)
		self.assertEqual(out["data"]["missing_count"], 1)
		# Task exists in the HK board.
		task = frappe.db.get_value(
			"Housekeeping Task",
			out["data"]["restock_task"],
			["task_type", "room", "task_status"],
			as_dict=True,
		)
		self.assertEqual(task["task_type"], "Linen Restock")
		self.assertEqual(task["room"], self.room)

	def test_double_post_same_day_is_no_op(self):
		a, _ = self._first_two_linen_items()
		payload = {
			"room": self.room,
			"counts": [{"linen_item": a["name"], "par": 4, "found": 4}],
			"phase": "Departure",
		}
		first = post_linen_count(**payload)
		second = post_linen_count(**payload)
		self.assertFalse(first["data"]["reused"])
		self.assertTrue(second["data"]["reused"])
		self.assertEqual(first["data"]["linen_movement"], second["data"]["linen_movement"])

	def test_empty_counts_refused(self):
		with self.assertRaises(frappe.ValidationError):
			post_linen_count(room=self.room, counts=[], phase="Departure")
		with self.assertRaises(frappe.ValidationError):
			post_linen_count(
				room=self.room,
				counts=[{"linen_item": "whatever", "par": 4, "found": 0, "damaged": 0, "missing": 0}],
				phase="Departure",
			)

	def test_damage_over_threshold_requires_approval(self):
		from the_reezort.approvals.api import ApprovalRequired

		frappe.get_doc(
			{
				"doctype": "Approval Policy",
				"policy_name": "linen_writeoff > 0",
				"action": "linen_writeoff",
				"approver_role": "Resort Manager",
				"threshold_amount": 0,
				"is_active": 1,
			}
		).insert(ignore_permissions=True)

		# Bathrobe ₹1800 × 5 damaged = ₹9000 > ₹5000 threshold.
		robe = frappe.db.get_value(
			"Linen Item", {"resort_property": self.resort_property, "item_code_short": "BATHROBE"}, "name"
		)
		with self.assertRaises(ApprovalRequired):
			post_linen_count(
				room=self.room,
				counts=[{"linen_item": robe, "par": 2, "found": 2, "damaged": 5}],
				phase="Departure",
			)

	# ----- history -----

	def test_list_recent_counts_lists_newest_first(self):
		a, b = self._first_two_linen_items()
		post_linen_count(
			room=self.room,
			counts=[{"linen_item": a["name"], "par": 4, "found": 4}],
			phase="Mid-stay",
		)
		later = post_linen_count(
			room=self.room,
			counts=[{"linen_item": b["name"], "par": 4, "found": 4}],
			phase="Departure",
		)
		out = list_recent_counts(room=self.room)
		self.assertGreaterEqual(len(out["data"]["movements"]), 2)
		self.assertEqual(out["data"]["movements"][0]["name"], later["data"]["linen_movement"])
