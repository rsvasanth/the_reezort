import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, now_datetime, today

from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


def insert_doc(doctype: str, ignore_links=False, **values):
	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True, ignore_links=ignore_links)
	return doc


class TestReservation(FrappeTestCase):
	"""Reservation Room is a plain child table with no controller logic of its
	own — everything it contributes (nights, room totals, status-driven hold
	handling) is computed by the parent Reservation. These tests exercise that
	parent controller through real child rows.
	"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		if not cls.company:
			frappe.throw("A Company is required before running Reservation tests.")

		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]
		cls.room_type = f"{cls.resort_property}-DLX"

	def make_reservation(self, **overrides):
		values = {
			"resort_property": self.resort_property,
			"status": "Draft",
			"booking_source": "Direct",
			"arrival_date": today(),
			"departure_date": add_days(today(), 3),
			"rooms": [{"room_type": self.room_type, "adults": 2, "estimated_amount": 1000}],
		}
		values.update(overrides)
		return insert_doc("Reservation", ignore_links=True, **values)

	def make_hold(self, reservation, **overrides):
		values = {
			"resort_property": self.resort_property,
			"reservation": reservation,
			"hold_scope": "Room Type",
			"room_type": self.room_type,
			"start_date": today(),
			"end_date": add_days(today(), 2),
			"quantity": 1,
			"status": "Active",
			"expires_at": add_days(now_datetime(), 1),
		}
		values.update(overrides)
		return insert_doc("Room Hold", **values)

	# ---- dates / nights / currency ----

	def test_departure_before_arrival_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			self.make_reservation(arrival_date=today(), departure_date=today())

	def test_departure_equal_to_arrival_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			self.make_reservation(arrival_date=today(), departure_date=add_days(today(), -1))

	def test_nights_are_computed_from_arrival_and_departure(self):
		res = self.make_reservation(arrival_date=today(), departure_date=add_days(today(), 5))
		self.assertEqual(res.nights, 5)

	def test_currency_defaults_from_the_resort_property(self):
		res = self.make_reservation(currency=None)
		self.assertEqual(res.currency, self.currency)

	def test_explicit_currency_is_not_overridden(self):
		res = self.make_reservation(currency="USD")
		self.assertEqual(res.currency, "USD")

	# ---- room totals ----

	def test_total_estimated_amount_sums_room_rows(self):
		res = self.make_reservation(
			rooms=[
				{"room_type": self.room_type, "adults": 2, "estimated_amount": 1000},
				{"room_type": self.room_type, "adults": 1, "estimated_amount": 1500},
			]
		)
		self.assertEqual(res.total_estimated_amount, 2500)

	def test_total_estimated_amount_treats_missing_amount_as_zero(self):
		res = self.make_reservation(rooms=[{"room_type": self.room_type, "adults": 2}])
		self.assertEqual(res.total_estimated_amount, 0)

	# ---- guest validation ----

	def test_confirmed_reservation_requires_at_least_one_guest(self):
		with self.assertRaises(frappe.ValidationError):
			self.make_reservation(status="Confirmed", guests=[])

	def test_draft_reservation_does_not_require_a_guest(self):
		res = self.make_reservation(status="Draft", guests=[])
		self.assertEqual(res.status, "Draft")

	def test_exactly_one_primary_guest_is_required_when_guests_present(self):
		with self.assertRaises(frappe.ValidationError):
			self.make_reservation(
				status="Draft",
				guests=[
					{"guest_name": "A Guest", "guest_type": "Adult", "is_primary_guest": 1},
					{"guest_name": "B Guest", "guest_type": "Adult", "is_primary_guest": 1},
				],
			)

	def test_no_primary_guest_among_multiple_guests_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			self.make_reservation(
				status="Draft",
				guests=[
					{"guest_name": "A Guest", "guest_type": "Adult", "is_primary_guest": 0},
					{"guest_name": "B Guest", "guest_type": "Adult", "is_primary_guest": 0},
				],
			)

	# ---- Room Hold consume / release wiring ----

	def test_confirming_a_reservation_consumes_its_active_room_hold(self):
		res = self.make_reservation(
			status="Draft",
			guests=[{"guest_name": "A Guest", "guest_type": "Adult", "is_primary_guest": 1}],
		)
		hold = self.make_hold(res.name)

		res.status = "Confirmed"
		res.save(ignore_permissions=True)

		hold.reload()
		self.assertEqual(hold.status, "Consumed")

	def test_cancelling_a_reservation_releases_its_active_room_hold(self):
		res = self.make_reservation(
			status="Draft",
			guests=[{"guest_name": "A Guest", "guest_type": "Adult", "is_primary_guest": 1}],
		)
		hold = self.make_hold(res.name)

		res.status = "Cancelled"
		res.save(ignore_permissions=True)

		hold.reload()
		self.assertEqual(hold.status, "Released")

	def test_confirmed_at_is_stamped_once_on_first_confirmation(self):
		res = self.make_reservation(
			status="Draft",
			guests=[{"guest_name": "A Guest", "guest_type": "Adult", "is_primary_guest": 1}],
		)
		self.assertFalse(res.confirmed_at)

		res.status = "Confirmed"
		res.save(ignore_permissions=True)
		first_stamp = res.confirmed_at
		self.assertTrue(first_stamp)

		# Saving again while still Confirmed must not move the timestamp.
		res.reload()
		res.save(ignore_permissions=True)
		self.assertEqual(res.confirmed_at, first_stamp)
