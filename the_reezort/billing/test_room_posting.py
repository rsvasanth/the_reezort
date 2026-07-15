"""Generic outlet → room posting tests (spec 004)."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, today

from the_reezort.billing.room_posting import (
	post_charge_to_room,
	validate_room_posting_target,
	list_postable_rooms,
)
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestRoomPosting(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]

	def _in_house_stay(self):
		cname = f"ZZ Room Charge {frappe.generate_hash(length=6)}"
		customer = frappe.get_doc(
			{"doctype": "Customer", "customer_name": cname, "customer_group": "Individual", "territory": "All Territories"}
		).insert(ignore_permissions=True).name
		room = frappe.db.get_value("Room", {"resort_property": self.resort_property}, ["name", "room_type"], as_dict=True)
		stay = frappe.get_doc(
			{
				"doctype": "Stay",
				"resort_property": self.resort_property,
				"customer": customer,
				"primary_guest_name": "Room Charge Guest",
				"stay_status": "In House",
				"current_room": room.name,
				"arrival_date": today(),
				"departure_date": frappe.utils.add_days(today(), 2),
				"room_type": room.room_type,
				"adult_count": 1,
				"folio_status": "Not Created",
			}
		).insert(ignore_permissions=True)
		return stay.name, room.name

	def test_validate_target_in_house_is_postable(self):
		stay, room = self._in_house_stay()
		out = validate_room_posting_target(room=room)["data"]
		self.assertTrue(out["postable"])
		self.assertEqual(out["stay"], stay)
		self.assertEqual(out["guest_name"], "Room Charge Guest")

	def test_post_charge_creates_folio_line(self):
		stay, _room = self._in_house_stay()
		out = post_charge_to_room(stay=stay, description="Spa massage", amount=2500, department="Spa")["data"]
		self.assertTrue(out["folio"])
		self.assertTrue(out["folio_line"])
		line = frappe.get_doc("Folio Line", out["folio_line"])
		self.assertEqual(line.line_type, "Charge")
		self.assertEqual(line.department, "Spa")
		self.assertEqual(flt(line.amount), 2500)

	def test_post_by_room_number_resolves_stay(self):
		_stay, room = self._in_house_stay()
		out = post_charge_to_room(room=room, description="Laundry", amount=400, department="Laundry")["data"]
		self.assertTrue(out["folio_line"])

	def test_post_rejects_zero_amount(self):
		stay, _room = self._in_house_stay()
		with self.assertRaises(frappe.ValidationError):
			post_charge_to_room(stay=stay, description="Nope", amount=0, department="Misc")

	def test_post_rejects_non_in_house(self):
		stay, _room = self._in_house_stay()
		frappe.db.set_value("Stay", stay, "stay_status", "Checked Out")
		with self.assertRaises(frappe.ValidationError):
			post_charge_to_room(stay=stay, description="Late spa", amount=1000, department="Spa")

	def test_list_postable_rooms_includes_in_house(self):
		stay, _room = self._in_house_stay()
		rooms = list_postable_rooms()["data"]["rooms"]
		self.assertIn(stay, [r["name"] for r in rooms])
