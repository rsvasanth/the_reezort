import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.billing.api import add_folio_line, get_active_folios, get_folio_detail, get_or_create_folio
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestBillingAPI(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		if not cls.company:
			frappe.throw("A Company is required before running Billing API tests.")

		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]
		cls.room_type = frappe.db.get_value(
			"Room Type", {"resort_property": cls.resort_property, "room_type_code": "DLX"}, "name"
		)
		cls.item_code = frappe.db.get_value("Item", {"item_code": "ROOM-DLX"}, "name")
		cls.initial_sales_invoice_count = frappe.db.count("Sales Invoice")
		cls.initial_payment_entry_count = frappe.db.count("Payment Entry")

	def test_image_fields_are_available_on_metadata(self):
		for doctype in ("Guest Profile", "Room", "Resort Property", "Room Type"):
			self.assertTrue(frappe.get_meta(doctype).has_field("image"), doctype)

	def make_reservation(self, suffix):
		guest = frappe.get_doc(
			{
				"doctype": "Guest Profile",
				"guest_full_name": f"Billing Guest {suffix}",
				"email": f"billing.guest.{suffix.lower()}@example.com",
				"phone": f"+91000{frappe.generate_hash(length=6)}",
			}
		)
		guest.insert(ignore_permissions=True)

		reservation = frappe.get_doc(
			{
				"doctype": "Reservation",
				"resort_property": self.resort_property,
				"status": "Confirmed",
				"booking_source": "Staff",
				"arrival_date": add_days(today(), 30),
				"departure_date": add_days(today(), 32),
				"currency": self.currency,
				"booker_guest_profile": guest.name,
				"staying_guest_profile": guest.name,
				"rooms": [
					{
						"room_type": self.room_type,
						"adults": 2,
						"children": 0,
						"estimated_amount": 2000,
						"status": "Confirmed",
					}
				],
				"guests": [
					{
						"guest_profile": guest.name,
						"guest_name": guest.guest_full_name,
						"email": guest.email,
						"phone": guest.phone,
						"is_primary_guest": 1,
					}
				],
			}
		)
		reservation.insert(ignore_permissions=True)
		return reservation

	def test_get_or_create_folio_creates_open_primary_folio(self):
		reservation = self.make_reservation("CREATE")

		result = get_or_create_folio(reservation=reservation.name)
		folio = result["data"]["folio"]

		self.assertTrue(result["ok"])
		self.assertEqual(folio["reservation"], reservation.name)
		self.assertEqual(folio["resort_property"], self.resort_property)
		self.assertEqual(folio["company"], self.company)
		self.assertEqual(folio["currency"], self.currency)
		self.assertEqual(folio["folio_status"], "Open")
		self.assertEqual(folio["primary_folio"], 1)
		self.assertTrue(folio["customer"])
		self.assertIn("guest_image", folio)
		self.assertIsNone(folio["guest_image"])

	def test_get_or_create_folio_is_idempotent_for_reservation(self):
		reservation = self.make_reservation("IDEMPOTENT")

		first = get_or_create_folio(reservation=reservation.name)
		second = get_or_create_folio(reservation=reservation.name)

		self.assertEqual(first["data"]["folio"]["name"], second["data"]["folio"]["name"])
		self.assertEqual(
			frappe.db.count("Guest Folio", {"reservation": reservation.name, "primary_folio": 1}),
			1,
		)

	def test_customer_resolution_creates_valid_erpnext_customer_link(self):
		reservation = self.make_reservation("CUSTOMER")

		result = get_or_create_folio(reservation=reservation.name)
		customer = result["data"]["folio"]["customer"]

		self.assertTrue(frappe.db.exists("Customer", customer))
		self.assertEqual(frappe.db.get_value("Reservation", reservation.name, "erpnext_customer"), customer)

	def test_add_folio_line_rolls_up_totals(self):
		reservation = self.make_reservation("LINE")
		folio = get_or_create_folio(reservation=reservation.name)["data"]["folio"]

		result = add_folio_line(
			folio["name"],
			{
				"item_code": self.item_code,
				"description": "Operational room charge",
				"qty": 2,
				"rate": 750,
			},
		)

		self.assertTrue(result["ok"])
		self.assertTrue(result["data"]["folio_line"])
		self.assertEqual(result["data"]["folio_totals"]["total_charges"], 1500)
		self.assertEqual(result["data"]["folio_totals"]["outstanding_amount"], 1500)

	def test_add_folio_line_to_closed_folio_raises_validation_error(self):
		reservation = self.make_reservation("CLOSED")
		folio_name = get_or_create_folio(reservation=reservation.name)["data"]["folio"]["name"]
		folio = frappe.get_doc("Guest Folio", folio_name)
		folio.folio_status = "Closed"
		folio.save(ignore_permissions=True)

		with self.assertRaises(frappe.ValidationError):
			add_folio_line(
				folio_name,
				{
					"item_code": self.item_code,
					"description": "Rejected closed folio charge",
					"qty": 1,
					"rate": 500,
				},
			)

	def test_get_folio_detail_returns_grouped_lines_totals_and_actions(self):
		reservation = self.make_reservation("DETAIL")
		folio = get_or_create_folio(reservation=reservation.name)["data"]["folio"]
		add_folio_line(
			folio["name"],
			{
				"item_code": self.item_code,
				"description": "Detailed line",
				"qty": 1,
				"rate": 900,
			},
		)

		result = get_folio_detail(folio["name"])

		self.assertTrue(result["ok"])
		self.assertEqual(result["data"]["folio"]["name"], folio["name"])
		self.assertEqual(result["data"]["totals"]["total_charges"], 900)
		self.assertEqual(result["next_actions"], ["add_line"])
		self.assertIn("guest_image", result["data"]["folio"])
		self.assertIsNone(result["data"]["folio"]["guest_image"])
		self.assertEqual(str(result["data"]["lines"][0]["service_date"]), today())
		self.assertEqual(result["data"]["lines"][0]["description"], "Detailed line")

	def test_get_active_folios_returns_guest_image_key(self):
		reservation = self.make_reservation("ACTIVEIMG")
		folio = get_or_create_folio(reservation=reservation.name)["data"]["folio"]

		result = get_active_folios(limit=100)
		active_folio = next(row for row in result["data"]["folios"] if row["name"] == folio["name"])

		self.assertIn("guest_image", active_folio)
		self.assertIsNone(active_folio["guest_image"])

	def test_no_erpnext_financial_documents_are_created_for_operational_folio(self):
		reservation = self.make_reservation("NOFINANCE")
		folio = get_or_create_folio(reservation=reservation.name)["data"]["folio"]
		add_folio_line(
			folio["name"],
			{
				"item_code": self.item_code,
				"description": "Operational only charge",
				"qty": 1,
				"rate": 600,
			},
		)

		lines = frappe.get_all(
			"Folio Line",
			filters={"guest_folio": folio["name"]},
			fields=["erpnext_sales_invoice", "erpnext_payment_entry"],
		)

		self.assertEqual(frappe.db.count("Sales Invoice"), self.initial_sales_invoice_count)
		self.assertEqual(frappe.db.count("Payment Entry"), self.initial_payment_entry_count)
		self.assertTrue(all(not row.erpnext_sales_invoice and not row.erpnext_payment_entry for row in lines))
