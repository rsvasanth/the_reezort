import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.pms.api import capture_room_condition, check_in, get_room_condition_captures
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestRoomConditionCapture(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.created_users = []
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

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		for user in cls.created_users:
			if frappe.db.exists("User", user):
				frappe.delete_doc("User", user, force=1, ignore_permissions=True)
		super().tearDownClass()

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		frappe.db.set_value("Room", {"resort_property": self.resort_property}, "occupancy_status", "Vacant")

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def make_confirmed_reservation(self, suffix):
		profile = frappe.get_doc(
			{
				"doctype": "Guest Profile",
				"guest_full_name": f"Condition Capture Guest {suffix}",
				"email": f"condition.capture.{suffix.lower()}.{frappe.generate_hash(length=6)}@example.com",
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
						"guest_name": profile.guest_full_name,
						"guest_type": "Adult",
						"is_primary_guest": 1,
					}
				],
				"rooms": [{"room_type": self.room_type, "adults": 2, "children": 0, "status": "Confirmed"}],
			}
		).insert(ignore_permissions=True)

	def make_stay(self, suffix):
		reservation = self.make_confirmed_reservation(suffix)
		return check_in(reservation.name)["stay"]

	def make_front_desk_user(self, suffix):
		if not frappe.db.exists("Role", "Front Desk"):
			frappe.get_doc({"doctype": "Role", "role_name": "Front Desk"}).insert(ignore_permissions=True)

		email = f"front.desk.capture.{suffix.lower()}.{frappe.generate_hash(length=8)}@example.com"
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": "Front",
				"last_name": f"Desk {suffix}",
				"enabled": 1,
				"user_type": "System User",
				"send_welcome_email": 0,
				"roles": [{"role": "Front Desk"}],
			}
		)
		user.insert(ignore_permissions=True)
		self.created_users.append(user.name)
		return user.name

	def photos(self, suffix):
		return [{"image": f"/files/room-{suffix}.jpg", "caption": "Entry view", "area": "Entrance"}]

	def test_capture_creates_with_photos(self):
		stay = self.make_stay("CREATE")

		result = capture_room_condition(stay, "Check-In", self.photos("create"), overall_condition="Good")

		capture = result["capture"]
		self.assertFalse(result["reused"])
		self.assertEqual(capture["stay"], stay)
		self.assertEqual(capture["capture_stage"], "Check-In")
		self.assertEqual(capture["photos"][0]["image"], "/files/room-create.jpg")

	def test_zero_photos_is_blocked(self):
		stay = self.make_stay("NOPHOTO")

		with self.assertRaises(frappe.ValidationError):
			capture_room_condition(stay, "Check-In", [])

	def test_capture_is_idempotent_per_stay_and_stage(self):
		stay = self.make_stay("IDEMP")

		first = capture_room_condition(stay, "Check-In", self.photos("idem-1"))
		second = capture_room_condition(stay, "Check-In", self.photos("idem-2"))

		self.assertFalse(first["reused"])
		self.assertTrue(second["reused"])
		self.assertEqual(first["capture"]["name"], second["capture"]["name"])
		self.assertEqual(frappe.db.count("Room Condition Capture", {"stay": stay, "capture_stage": "Check-In"}), 1)

	def test_both_stages_are_allowed(self):
		stay = self.make_stay("BOTH")

		check_in_capture = capture_room_condition(stay, "Check-In", self.photos("in"))
		check_out_capture = capture_room_condition(stay, "Check-Out", self.photos("out"), overall_condition="Minor Issues")
		captures = get_room_condition_captures(stay)["captures"]

		self.assertNotEqual(check_in_capture["capture"]["name"], check_out_capture["capture"]["name"])
		self.assertEqual({row["capture_stage"] for row in captures}, {"Check-In", "Check-Out"})

	def test_edit_after_insert_is_blocked(self):
		stay = self.make_stay("LOCK")
		capture_name = capture_room_condition(stay, "Check-In", self.photos("lock"))["capture"]["name"]
		front_desk_user = self.make_front_desk_user("LOCK")

		frappe.set_user(front_desk_user)
		capture = frappe.get_doc("Room Condition Capture", capture_name)
		capture.notes = "changed after insert"
		with self.assertRaises(frappe.ValidationError):
			capture.save(ignore_permissions=True)
