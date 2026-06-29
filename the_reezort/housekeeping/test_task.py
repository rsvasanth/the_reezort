import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.housekeeping.condition import log_room_condition


def insert_doc(doctype, **values):
	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True, ignore_links=True)
	return doc


class TestHousekeepingTask(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.created_users = []

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		for user in cls.created_users:
			if frappe.db.exists("User", user):
				frappe.delete_doc("User", user, force=1, ignore_permissions=True)
		super().tearDownClass()

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def make_inventory_setup(self, suffix):
		property_doc = insert_doc(
			"Resort Property",
			property_name=f"HK Resort {suffix}",
			property_code=f"HK-{suffix}",
			company=f"HK Company {suffix}",
			timezone="Asia/Kolkata",
		)
		building = insert_doc(
			"Resort Building",
			resort_property=property_doc.name,
			building_name=f"HK Wing {suffix}",
			building_code="MAIN",
		)
		floor = insert_doc(
			"Resort Floor",
			resort_property=property_doc.name,
			building=building.name,
			floor_label="Ground",
			floor_code="G",
		)
		room_type = insert_doc(
			"Room Type",
			resort_property=property_doc.name,
			room_type_name=f"HK Deluxe {suffix}",
			room_type_code="DLX",
			standard_adults=2,
			standard_children=0,
			max_occupancy=3,
		)
		room = insert_doc(
			"Room",
			resort_property=property_doc.name,
			building=building.name,
			floor=floor.name,
			room_type=room_type.name,
			room_number=f"HK-{suffix}",
			occupancy_status="Vacant",
			housekeeping_status="Dirty",
			maintenance_status="Available",
			sellable_status="Sellable",
		)
		return property_doc, building, floor, room

	def make_task(self, suffix, status="Queued", exception_approval=None):
		property_doc, building, floor, room = self.make_inventory_setup(suffix)
		return insert_doc(
			"Housekeeping Task",
			resort_property=property_doc.name,
			room=room.name,
			building=building.name,
			floor=floor.name,
			task_type="Departure Cleaning",
			task_status=status,
			priority="Normal",
			idempotency_key=f"hk-task-{suffix}",
			exception_approval=exception_approval,
		)

	def make_housekeeping_user(self, suffix):
		if not frappe.db.exists("Role", "Housekeeping"):
			frappe.get_doc({"doctype": "Role", "role_name": "Housekeeping"}).insert(ignore_permissions=True)

		email = f"hk.user.{suffix.lower()}.{frappe.generate_hash(length=8)}@example.com"
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": "HK",
				"last_name": suffix,
				"enabled": 1,
				"user_type": "System User",
				"send_welcome_email": 0,
				"roles": [{"role": "Housekeeping"}],
			}
		)
		user.insert(ignore_permissions=True)
		self.created_users.append(user.name)
		return user.name

	def test_create_task_and_reject_duplicate_idempotency_key(self):
		task = self.make_task("DUP")
		property_doc, building, floor, room = self.make_inventory_setup("DUP2")

		self.assertEqual(task.task_status, "Queued")
		with self.assertRaises(frappe.UniqueValidationError):
			insert_doc(
				"Housekeeping Task",
				resort_property=property_doc.name,
				room=room.name,
				building=building.name,
				floor=floor.name,
				task_type="Departure Cleaning",
				task_status="Queued",
				priority="Normal",
				idempotency_key=task.idempotency_key,
			)

	def test_valid_transitions_pass_and_invalid_transition_throws(self):
		task = self.make_task("STATE")

		task.task_status = "Assigned"
		task.save(ignore_permissions=True)
		task.task_status = "In Progress"
		task.save(ignore_permissions=True)
		task.task_status = "Completed"
		task.save(ignore_permissions=True)

		invalid = self.make_task("INVALID")
		invalid.task_status = "Completed"
		with self.assertRaises(frappe.ValidationError):
			invalid.save(ignore_permissions=True)

	def test_skipped_requires_exception_approval(self):
		task = self.make_task("SKIPNO")
		task.task_status = "Assigned"
		task.save(ignore_permissions=True)
		task.task_status = "Skipped"
		with self.assertRaises(frappe.ValidationError):
			task.save(ignore_permissions=True)

		approved = self.make_task("SKIPYES")
		approved.task_status = "Assigned"
		approved.save(ignore_permissions=True)
		approved.task_status = "Skipped"
		approved.exception_approval = "HK-APPROVAL-TEST"
		approved.flags.ignore_links = True
		approved.save(ignore_permissions=True)
		self.assertEqual(approved.task_status, "Skipped")

	def test_log_room_condition_updates_housekeeping_status_and_noops_when_unchanged(self):
		_property_doc, _building, _floor, room = self.make_inventory_setup("COND")
		before_count = frappe.db.count("Room Condition Log", {"room": room.name})

		log = log_room_condition(
			room.name,
			"Housekeeping",
			"Clean",
			source_doctype="Housekeeping Task",
			source_name="HK-TASK-TEST",
			reason="cleaning complete",
		)
		room.reload()

		self.assertTrue(log.name)
		self.assertEqual(room.housekeeping_status, "Clean")
		self.assertEqual(frappe.db.count("Room Condition Log", {"room": room.name}), before_count + 1)
		self.assertIsNone(log_room_condition(room.name, "Housekeeping", "Clean"))
		self.assertEqual(frappe.db.count("Room Condition Log", {"room": room.name}), before_count + 1)

	def test_room_condition_log_is_append_only(self):
		_property_doc, _building, _floor, room = self.make_inventory_setup("LOGLOCK")
		log = log_room_condition(room.name, "Housekeeping", "Clean")
		housekeeping_user = self.make_housekeeping_user("LOGLOCK")

		frappe.set_user(housekeeping_user)
		log.reason = "changed after insert"
		with self.assertRaises(frappe.ValidationError):
			log.save(ignore_permissions=True)
