"""Tests for the guest room-move (in-house room switch)."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.pms.api import check_in, move_guest_room
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestRoomMove(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]
		cls.room_type = frappe.db.get_value(
			"Room",
			{"resort_property": cls.resort_property, "sellable_status": "Sellable", "occupancy_status": "Vacant", "is_active": 1},
			"room_type",
		)

	def setUp(self):
		super().setUp()
		# check_in and move_guest_room commit, so reset room state before each test.
		frappe.db.set_value(
			"Room",
			{"resort_property": self.resort_property},
			{
				"occupancy_status": "Vacant",
				"housekeeping_status": "Clean",
				"maintenance_status": "Available",
				"sellable_status": "Sellable",
			},
		)

	def _checked_in_stay(self):
		profile = frappe.get_doc(
			{"doctype": "Guest Profile", "guest_full_name": "Move Guest", "email": frappe.generate_hash(length=8) + "@example.com"}
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
				"guests": [{"guest_profile": profile.name, "guest_name": "Move Guest", "guest_type": "Adult", "is_primary_guest": 1}],
				"rooms": [{"room_type": self.room_type, "adults": 2, "children": 0, "status": "Confirmed"}],
			}
		).insert(ignore_permissions=True)
		ci = check_in(res.name)
		return ci, res.name

	def _vacant_target(self, exclude):
		return frappe.db.get_value(
			"Room",
			{
				"resort_property": self.resort_property,
				"room_type": self.room_type,
				"name": ["!=", exclude],
				"occupancy_status": "Vacant",
				"sellable_status": "Sellable",
				"is_active": 1,
			},
			"name",
		)

	def test_move_flips_room_statuses_and_updates_stay(self):
		ci, res = self._checked_in_stay()
		from_room = ci["current_room"]
		to_room = self._vacant_target(from_room)
		self.assertTrue(to_room)

		result = move_guest_room(ci["stay"], to_room, "Guest Request")

		self.assertEqual(result["from_room"], from_room)
		self.assertEqual(result["to_room"], to_room)
		# Source room freed + dirty; not OOO.
		self.assertEqual(frappe.db.get_value("Room", from_room, "occupancy_status"), "Vacant")
		self.assertEqual(frappe.db.get_value("Room", from_room, "housekeeping_status"), "Dirty")
		self.assertEqual(frappe.db.get_value("Room", from_room, "maintenance_status"), "Available")
		# Target room occupied.
		self.assertEqual(frappe.db.get_value("Room", to_room, "occupancy_status"), "Occupied")
		# Stay points to new room.
		self.assertEqual(frappe.db.get_value("Stay", ci["stay"], "current_room"), to_room)
		# Reservation's first row mirrors the new room.
		self.assertEqual(frappe.db.get_value("Reservation Room", {"parent": res}, "room"), to_room)
		# Audit row written.
		self.assertTrue(frappe.db.exists("Room Move", result["move"]))

	def test_move_with_source_out_of_order_marks_room_and_creates_task(self):
		ci, _ = self._checked_in_stay()
		from_room = ci["current_room"]
		to_room = self._vacant_target(from_room)

		result = move_guest_room(
			ci["stay"], to_room, "Maintenance",
			notes="Power tripped in main socket panel; AC unusable.",
			source_out_of_order=1,
		)

		self.assertEqual(frappe.db.get_value("Room", from_room, "maintenance_status"), "Out of Order")
		self.assertEqual(frappe.db.get_value("Room", from_room, "sellable_status"), "Not Sellable")
		# Auto-created maintenance task on the source room.
		self.assertTrue(result["maintenance_task"])
		task = frappe.get_doc("Housekeeping Task", result["maintenance_task"])
		self.assertEqual(task.room, from_room)
		self.assertEqual(task.task_type, "Maintenance Follow-up")

	def test_move_to_occupied_room_is_blocked(self):
		ci, _ = self._checked_in_stay()
		from_room = ci["current_room"]
		# Pick another vacant room and manually mark it occupied to simulate.
		other = self._vacant_target(from_room)
		frappe.db.set_value("Room", other, "occupancy_status", "Occupied")
		with self.assertRaises(frappe.ValidationError):
			move_guest_room(ci["stay"], other, "Guest Request")

	def test_move_with_invalid_reason_is_blocked(self):
		ci, _ = self._checked_in_stay()
		to_room = self._vacant_target(ci["current_room"])
		with self.assertRaises(frappe.ValidationError):
			move_guest_room(ci["stay"], to_room, "Whatever")

	def test_move_blocked_for_non_in_house_stay(self):
		ci, _ = self._checked_in_stay()
		frappe.db.set_value("Stay", ci["stay"], "stay_status", "Checked Out")
		to_room = self._vacant_target(ci["current_room"])
		with self.assertRaises(frappe.ValidationError):
			move_guest_room(ci["stay"], to_room, "Guest Request")

	def test_folio_carries_over_unchanged(self):
		ci, _ = self._checked_in_stay()
		folio_before = frappe.get_doc("Guest Folio", ci["folio"])
		charges_before = folio_before.total_charges
		to_room = self._vacant_target(ci["current_room"])

		move_guest_room(ci["stay"], to_room, "Upgrade")

		# Same folio, charges intact, still linked to the same stay.
		folio_after = frappe.get_doc("Guest Folio", ci["folio"])
		self.assertEqual(folio_after.stay, ci["stay"])
		self.assertEqual(folio_after.total_charges, charges_before)
