import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.pms.api import check_in
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestPMSCheckIn(FrappeTestCase):
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
			{
				"resort_property": cls.resort_property,
				"sellable_status": "Sellable",
				"occupancy_status": "Vacant",
				"is_active": 1,
			},
			"room_type",
		)
		cls.initial_sales_invoice_count = frappe.db.count("Sales Invoice")
		cls.initial_payment_entry_count = frappe.db.count("Payment Entry")

	def setUp(self):
		super().setUp()
		# check_in commits, so reset room occupancy before each test for isolation.
		frappe.db.set_value("Room", {"resort_property": self.resort_property}, "occupancy_status", "Vacant")

	def _make_confirmed_reservation(self):
		profile = frappe.get_doc(
			{
				"doctype": "Guest Profile",
				"guest_full_name": "PMS Test Guest",
				"email": frappe.generate_hash(length=8) + "@example.com",
			}
		).insert(ignore_permissions=True)

		return frappe.get_doc(
			{
				"doctype": "Reservation",
				"resort_property": self.resort_property,
				"status": "Confirmed",
				"booking_source": "Direct",
				"arrival_date": add_days(today(), 1),
				"departure_date": add_days(today(), 3),
				"currency": self.currency,
				"staying_guest_profile": profile.name,
				"guests": [
					{
						"guest_profile": profile.name,
						"guest_name": "PMS Test Guest",
						"guest_type": "Adult",
						"is_primary_guest": 1,
					}
				],
				"rooms": [{"room_type": self.room_type, "adults": 2, "children": 0, "status": "Confirmed"}],
			}
		).insert(ignore_permissions=True)

	def test_check_in_creates_in_house_stay_and_opens_folio(self):
		reservation = self._make_confirmed_reservation()
		result = check_in(reservation.name)

		stay = frappe.get_doc("Stay", result["stay"])
		self.assertEqual(stay.stay_status, "In House")
		self.assertTrue(stay.current_room)
		self.assertEqual(stay.resort_property, self.resort_property)
		self.assertEqual(frappe.db.get_value("Room", stay.current_room, "occupancy_status"), "Occupied")
		self.assertEqual(frappe.db.get_value("Reservation", reservation.name, "status"), "Checked In")
		self.assertEqual(frappe.db.get_value("Guest Folio", result["folio"], "stay"), stay.name)

	def test_check_in_is_idempotent(self):
		reservation = self._make_confirmed_reservation()
		first = check_in(reservation.name)
		second = check_in(reservation.name)

		self.assertEqual(first["stay"], second["stay"])
		self.assertEqual(first["folio"], second["folio"])
		self.assertTrue(second["reused"])

	def test_check_in_requires_confirmed_reservation(self):
		reservation = self._make_confirmed_reservation()
		reservation.db_set("status", "Hold")

		with self.assertRaises(frappe.ValidationError):
			check_in(reservation.name)

	def test_check_in_creates_no_financial_documents(self):
		reservation = self._make_confirmed_reservation()
		check_in(reservation.name)

		self.assertEqual(frappe.db.count("Sales Invoice"), self.initial_sales_invoice_count)
		self.assertEqual(frappe.db.count("Payment Entry"), self.initial_payment_entry_count)
