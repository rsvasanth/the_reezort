import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.housekeeping.api import assign_task, complete_task, create_inspection, create_task, record_inspection, start_task


def insert_doc(doctype, **values):
	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True, ignore_links=True)
	return doc


class TestRoomInspectionAPI(FrappeTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def make_inventory_setup(self, suffix):
		property_doc = insert_doc(
			"Resort Property",
			property_name=f"HK Inspect Resort {suffix}",
			property_code=f"HKINS-{suffix}",
			company=f"HK Inspect Company {suffix}",
			timezone="Asia/Kolkata",
		)
		building = insert_doc(
			"Resort Building",
			resort_property=property_doc.name,
			building_name=f"HK Inspect Wing {suffix}",
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
			room_type_name=f"HK Inspect Deluxe {suffix}",
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
			room_number=f"HKINS-{suffix}",
			occupancy_status="Vacant",
			housekeeping_status="Dirty",
			maintenance_status="Available",
			sellable_status="Sellable",
		)
		return property_doc, room

	def make_inspection_ready_task(self, suffix):
		_property_doc, room = self.make_inventory_setup(suffix)
		task = create_task(
			{
				"room": room.name,
				"task_type": "Departure Cleaning",
				"priority": "Normal",
				"requires_inspection": True,
				"idempotency_key": f"hk-inspect-task-{suffix}",
			}
		)["data"]["task"]
		assign_task(task["name"], assigned_user="Administrator")
		start_task(task["name"])
		complete_task(task["name"], completion_notes="ready for inspection")
		return room, task["name"]

	def test_pass_marks_room_inspected_and_logs_condition(self):
		room, task_name = self.make_inspection_ready_task("PASS")
		inspection = create_inspection(task_name)["data"]["inspection"]

		result = record_inspection(inspection["name"], "Passed", notes="passed")["data"]["inspection"]
		room.reload()

		self.assertEqual(result["inspection_status"], "Passed")
		self.assertEqual(room.housekeeping_status, "Inspected")
		self.assertEqual(
			frappe.db.count(
				"Room Condition Log",
				{"room": room.name, "source_doctype": "Room Inspection", "source_name": inspection["name"]},
			),
			1,
		)

	def test_failed_inspection_creates_rework_task_and_links_it(self):
		_room, task_name = self.make_inspection_ready_task("FAIL")
		inspection = create_inspection(task_name)["data"]["inspection"]

		result = record_inspection(inspection["name"], "Failed", notes="bathroom needs rework")["data"]

		self.assertEqual(result["inspection"]["inspection_status"], "Rework Required")
		self.assertTrue(result["inspection"]["rework_task"])
		rework = frappe.get_doc("Housekeeping Task", result["inspection"]["rework_task"])
		self.assertEqual(rework.source_doctype, "Room Inspection")
		self.assertEqual(rework.source_name, inspection["name"])

	def test_invalid_inspection_transition_throws(self):
		_room, task_name = self.make_inspection_ready_task("INVALID")
		inspection = frappe.get_doc("Room Inspection", create_inspection(task_name)["data"]["inspection"]["name"])

		inspection.inspection_status = "Passed"
		with self.assertRaises(frappe.ValidationError):
			inspection.save(ignore_permissions=True)

	def test_accepted_with_exception_requires_approval(self):
		_room, task_name = self.make_inspection_ready_task("EXC")
		inspection = create_inspection(task_name)["data"]["inspection"]

		with self.assertRaises(frappe.ValidationError):
			record_inspection(inspection["name"], "Accepted With Exception", notes="temporary release")

		inspection_doc = frappe.get_doc("Room Inspection", inspection["name"])
		inspection_doc.exception_approval = "HK-EXCEPTION-APPROVAL"
		inspection_doc.flags.ignore_links = True
		inspection_doc.save(ignore_permissions=True)

		result = record_inspection(inspection["name"], "Accepted With Exception", notes="approved")["data"]["inspection"]
		self.assertEqual(result["inspection_status"], "Accepted With Exception")
