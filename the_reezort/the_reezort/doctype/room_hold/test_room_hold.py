import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, now_datetime, today

from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


def insert_doc(doctype: str, ignore_links=False, **values):
	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True, ignore_links=ignore_links)
	return doc


class TestRoomHold(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		if not cls.company:
			frappe.throw("A Company is required before running Room Hold tests.")

		currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]
		cls.room_type = f"{cls.resort_property}-DLX"

	def make_hold(self, **overrides):
		values = {
			"resort_property": self.resort_property,
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

	def test_end_date_must_be_after_start_date(self):
		with self.assertRaises(frappe.ValidationError):
			self.make_hold(start_date=today(), end_date=today())

	def test_end_date_before_start_date_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			self.make_hold(start_date=today(), end_date=add_days(today(), -1))

	def test_quantity_defaults_to_one_when_missing(self):
		hold = self.make_hold(quantity=None)
		self.assertEqual(hold.quantity, 1)

	def test_quantity_defaults_to_one_when_zero_or_negative(self):
		hold = self.make_hold(quantity=0)
		self.assertEqual(hold.quantity, 1)

	def test_room_type_must_belong_to_the_hold_property(self):
		mismatched_property = insert_doc(
			"Resort Property",
			ignore_links=True,
			property_name="Mismatch Test Property",
			property_code=frappe.generate_hash(length=6).upper(),
			company=self.company,
			default_currency="INR",
			timezone="Asia/Kolkata",
		)
		with self.assertRaises(frappe.ValidationError):
			self.make_hold(resort_property=mismatched_property.name, room_type=self.room_type)

	def test_active_hold_past_expiry_is_flipped_to_expired_on_save(self):
		hold = self.make_hold(expires_at=add_days(now_datetime(), -1), status="Active")
		self.assertEqual(hold.status, "Expired")

	def test_active_hold_not_yet_expired_stays_active(self):
		hold = self.make_hold(expires_at=add_days(now_datetime(), 1), status="Active")
		self.assertEqual(hold.status, "Active")

	def test_non_active_status_is_not_overridden_by_expiry_check(self):
		# A Released/Consumed/Cancelled hold with a past expires_at must not be
		# silently rewritten back to "Expired" — the expiry check only applies
		# to holds that are still Active.
		hold = self.make_hold(expires_at=add_days(now_datetime(), -1), status="Released")
		self.assertEqual(hold.status, "Released")
