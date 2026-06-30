"""Tests for extend_stay (R3): push departure + charge extra nights."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, getdate

from the_reezort.setup import api as setup_api
from the_reezort.pms import api as pms_api


class TestExtendStay(FrappeTestCase):
	def setUp(self):
		company = frappe.db.get_value("Company", {}, "name")
		self.prop = setup_api.create_property(
			{"property_name": "ZZ EX", "property_code": "ZZEX", "company": company, "timezone": "Asia/Kolkata"}
		)["data"]["property"]["name"]
		b = setup_api.create_building({"resort_property": self.prop, "building_name": "B", "building_code": "B"})["data"]["building"]["name"]
		f = setup_api.create_floor({"resort_property": self.prop, "building": b, "floor_label": "F1", "floor_code": "1"})["data"]["floor"]["name"]
		self.rt = setup_api.create_room_type(
			{"resort_property": self.prop, "room_type_name": "Std", "room_type_code": "STD", "standard_adults": 2, "max_occupancy": 2}
		)["data"]["room_type"]["name"]
		setup_api.create_rooms_bulk({"resort_property": self.prop, "building": b, "floor": f, "room_type": self.rt, "room_numbers": ["E01"]})
		self.room = f"{self.prop}-E01"
		self.customer = frappe.db.get_value("Customer", {}, "name") or frappe.get_doc({"doctype": "Customer", "customer_name": "ZZ EX Guest"}).insert(ignore_permissions=True).name
		self.dep = add_days(getdate(), 2)
		self.stay = frappe.get_doc(
			{
				"doctype": "Stay", "resort_property": self.prop, "customer": self.customer,
				"primary_guest_name": "Extend Guest", "stay_status": "In House",
				"arrival_date": add_days(getdate(), -1), "departure_date": self.dep,
				"room_type": self.rt, "current_room": self.room, "folio_status": "Active",
			}
		).insert(ignore_permissions=True).name
		self.folio = frappe.get_doc(
			{"doctype": "Guest Folio", "resort_property": self.prop, "customer": self.customer, "stay": self.stay, "folio_status": "Open"}
		).insert(ignore_permissions=True).name
		frappe.get_doc(
			{
				"doctype": "Folio Line", "guest_folio": self.folio, "line_type": "Charge",
				"source_module": "Room", "source_doctype": "Stay", "source_name": self.stay,
				"idempotency_key": f"seed-room-{self.stay}", "service_date": getdate(),
				"qty": 3, "rate": 5000, "amount": 15000, "tax_treatment": "Standard", "description": "Room",
			}
		).insert(ignore_permissions=True)

	def test_extend_updates_dates_and_charges_extra_nights(self):
		new_dep = add_days(self.dep, 2)
		out = pms_api.extend_stay(self.stay, str(new_dep))
		self.assertEqual(out["extra_nights"], 2)
		self.assertTrue(out["charge_added"])
		self.assertEqual(getdate(frappe.db.get_value("Stay", self.stay, "departure_date")), getdate(new_dep))
		# A new Room charge line for 2 nights @ 5000 was added.
		line = frappe.get_doc("Folio Line", out["charge_added"])
		self.assertEqual(line.qty, 2)
		self.assertEqual(line.rate, 5000)
		self.assertEqual(line.amount, 10000)

	def test_reject_past_departure(self):
		with self.assertRaises(frappe.ValidationError):
			pms_api.extend_stay(self.stay, str(self.dep))  # same date, not after

	def test_reject_non_in_house(self):
		frappe.db.set_value("Stay", self.stay, "stay_status", "Checked Out")
		with self.assertRaises(frappe.ValidationError):
			pms_api.extend_stay(self.stay, str(add_days(self.dep, 2)))
