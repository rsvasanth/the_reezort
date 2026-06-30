"""Tests for checkout orchestration (R1): free room + auto housekeeping task."""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.setup import api as setup_api
from the_reezort.pms import api as pms_api


class TestCheckout(FrappeTestCase):
	def setUp(self):
		company = frappe.db.get_value("Company", {}, "name")
		prop = setup_api.create_property(
			{"property_name": "ZZ CO", "property_code": "ZZCO", "company": company, "timezone": "Asia/Kolkata"}
		)["data"]["property"]["name"]
		building = setup_api.create_building(
			{"resort_property": prop, "building_name": "B", "building_code": "B"}
		)["data"]["building"]["name"]
		floor = setup_api.create_floor(
			{"resort_property": prop, "building": building, "floor_label": "F1", "floor_code": "1"}
		)["data"]["floor"]["name"]
		rt = setup_api.create_room_type(
			{"resort_property": prop, "room_type_name": "Std", "room_type_code": "STD", "standard_adults": 2, "max_occupancy": 2}
		)["data"]["room_type"]["name"]
		setup_api.create_rooms_bulk(
			{"resort_property": prop, "building": building, "floor": floor, "room_type": rt, "room_numbers": ["C01"]}
		)
		self.prop = prop
		self.room = f"{prop}-C01"
		# Occupy the room as settlement would have left it.
		frappe.db.set_value("Room", self.room, {"occupancy_status": "Checked Out", "housekeeping_status": "Clean"})
		self.stay = frappe.get_doc(
			{
				"doctype": "Stay",
				"resort_property": prop,
				"customer": frappe.db.get_value("Customer", {}, "name") or self._make_customer(),
				"primary_guest_name": "Test Guest",
				"stay_status": "Checked Out",
				"arrival_date": "2026-06-25",
				"departure_date": "2026-06-29",
				"room_type": rt,
				"current_room": self.room,
				"folio_status": "Settled",
			}
		).insert(ignore_permissions=True).name

	def _make_customer(self):
		return frappe.get_doc({"doctype": "Customer", "customer_name": "ZZ CO Guest"}).insert(ignore_permissions=True).name

	def test_checkout_frees_room_and_creates_departure_task(self):
		out = pms_api.check_out(self.stay)
		self.assertEqual(out["stay_status"], "Checked Out")
		self.assertFalse(out["reused"])
		self.assertTrue(out["housekeeping_task"])

		room = frappe.db.get_value("Room", self.room, ["occupancy_status", "housekeeping_status"], as_dict=True)
		self.assertEqual(room.occupancy_status, "Vacant")
		self.assertEqual(room.housekeeping_status, "Dirty")

		task = frappe.get_doc("Housekeeping Task", out["housekeeping_task"])
		self.assertEqual(task.task_type, "Departure Cleaning")
		self.assertEqual(task.task_status, "Queued")
		self.assertEqual(task.requires_inspection, 1)
		self.assertEqual(task.room, self.room)

	def test_checkout_idempotent(self):
		first = pms_api.check_out(self.stay)
		again = pms_api.check_out(self.stay)
		self.assertTrue(again["reused"])
		self.assertEqual(first["housekeeping_task"], again["housekeeping_task"])
		# Only one departure task for this stay.
		self.assertEqual(
			frappe.db.count("Housekeeping Task", {"idempotency_key": f"checkout-clean:{self.stay}"}), 1
		)

	def test_checkout_blocked_when_folio_open(self):
		# An open (un-invoiced) folio blocks checkout.
		frappe.get_doc(
			{
				"doctype": "Guest Folio",
				"resort_property": self.prop,
				"customer": frappe.db.get_value("Stay", self.stay, "customer"),
				"stay": self.stay,
				"folio_status": "Open",
			}
		).insert(ignore_permissions=True)
		with self.assertRaises(frappe.ValidationError):
			pms_api.check_out(self.stay)
