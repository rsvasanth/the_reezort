import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.housekeeping.api import (
	assign_task,
	complete_task,
	create_task,
	get_housekeeping_board,
	list_my_tasks,
	list_tasks,
	mark_dnd_or_refused,
	pause_task,
	start_task,
)


def insert_doc(doctype, **values):
	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True, ignore_links=True)
	return doc


class TestHousekeepingAPI(FrappeTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def make_inventory_setup(self, suffix):
		property_doc = insert_doc(
			"Resort Property",
			property_name=f"HK API Resort {suffix}",
			property_code=f"HKAPI-{suffix}",
			company=f"HK API Company {suffix}",
			timezone="Asia/Kolkata",
		)
		building = insert_doc(
			"Resort Building",
			resort_property=property_doc.name,
			building_name=f"HK API Wing {suffix}",
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
			room_type_name=f"HK API Deluxe {suffix}",
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
			room_number=f"HKAPI-{suffix}",
			occupancy_status="Vacant",
			housekeeping_status="Dirty",
			maintenance_status="Available",
			sellable_status="Sellable",
		)
		return property_doc, room

	def task_payload(self, suffix, room, **overrides):
		payload = {
			"room": room.name,
			"task_type": "Departure Cleaning",
			"priority": "Normal",
			"idempotency_key": f"hk-api-task-{suffix}",
		}
		payload.update(overrides)
		return payload

	def test_full_lifecycle_updates_room_condition_and_audit_log(self):
		_property_doc, room = self.make_inventory_setup("LIFE")
		created = create_task(self.task_payload("LIFE", room))["data"]["task"]

		assigned = assign_task(created["name"], assigned_user="Administrator")["data"]["task"]
		started = start_task(assigned["name"])["data"]["task"]
		completed = complete_task(started["name"], completion_notes="cleaned")["data"]
		room.reload()

		self.assertEqual(created["task_status"], "Queued")
		self.assertEqual(assigned["task_status"], "Assigned")
		self.assertEqual(started["task_status"], "In Progress")
		self.assertEqual(completed["task"]["task_status"], "Completed")
		self.assertEqual(room.housekeeping_status, "Clean")
		self.assertEqual(
			frappe.db.count(
				"Room Condition Log",
				{"room": room.name, "source_doctype": "Housekeeping Task", "source_name": created["name"]},
			),
			1,
		)

	def test_completion_requiring_inspection_keeps_task_in_inspection_required(self):
		_property_doc, room = self.make_inventory_setup("INSP")
		task = create_task(self.task_payload("INSP", room, requires_inspection=True))["data"]["task"]
		assign_task(task["name"], assigned_user="Administrator")
		start_task(task["name"])

		result = complete_task(task["name"])["data"]
		room.reload()

		self.assertEqual(result["task"]["task_status"], "Inspection Required")
		# A room needing inspection must NOT be marked Clean (an allocatable
		# status) on completion — it becomes Inspected only when inspection passes.
		self.assertIsNone(result["room_condition"])
		self.assertNotEqual(room.housekeeping_status, "Clean")

	def test_create_task_is_idempotent_on_idempotency_key(self):
		_property_doc, room = self.make_inventory_setup("IDEMP")
		payload = self.task_payload("IDEMP", room)

		first = create_task(payload)["data"]
		second = create_task(payload)["data"]

		self.assertFalse(first["reused"])
		self.assertTrue(second["reused"])
		self.assertEqual(first["task"]["name"], second["task"]["name"])
		self.assertEqual(frappe.db.count("Housekeeping Task", {"idempotency_key": payload["idempotency_key"]}), 1)

	def test_guest_is_rejected(self):
		_property_doc, room = self.make_inventory_setup("GUEST")
		frappe.set_user("Guest")

		with self.assertRaises(frappe.PermissionError):
			create_task(self.task_payload("GUEST", room))

	def test_board_returns_rooms_with_open_tasks(self):
		property_doc, room = self.make_inventory_setup("BOARD")
		task = create_task(self.task_payload("BOARD", room))["data"]["task"]

		board = get_housekeeping_board(property_doc.name)["data"]["rooms"]
		board_room = next(row for row in board if row["name"] == room.name)

		self.assertEqual(board_room["housekeeping_status"], "Dirty")
		self.assertEqual(board_room["open_task"]["id"], task["name"])
		self.assertEqual(board_room["open_task"]["type"], "Departure Cleaning")
		self.assertEqual(board_room["open_task"]["status"], "Queued")

	def test_dnd_task_does_not_complete(self):
		_property_doc, room = self.make_inventory_setup("DND")
		task = create_task(self.task_payload("DND", room, dnd_status="DND"))["data"]["task"]
		assign_task(task["name"], assigned_user="Administrator")
		start_task(task["name"])

		with self.assertRaises(frappe.ValidationError):
			complete_task(task["name"])

		task_doc = frappe.get_doc("Housekeeping Task", task["name"])
		room.reload()
		self.assertEqual(task_doc.task_status, "In Progress")
		self.assertEqual(room.housekeeping_status, "Dirty")

	def test_mark_dnd_pauses_and_blocks_completion(self):
		_property_doc, room = self.make_inventory_setup("MARKDND")
		task = create_task(self.task_payload("MARKDND", room))["data"]["task"]
		assign_task(task["name"], assigned_user="Administrator")
		start_task(task["name"])

		out = mark_dnd_or_refused(task["name"], "Refused", notes="guest sleeping")["data"]["task"]
		self.assertEqual(out["dnd_status"], "Refused")
		self.assertEqual(out["task_status"], "Paused")
		# The existing DND guard now blocks completion until it's cleared.
		with self.assertRaises(frappe.ValidationError):
			complete_task(task["name"])

	def test_mark_dnd_rejects_bad_status(self):
		_property_doc, room = self.make_inventory_setup("BADDND")
		task = create_task(self.task_payload("BADDND", room))["data"]["task"]
		start_task(task["name"])
		with self.assertRaises(frappe.ValidationError):
			mark_dnd_or_refused(task["name"], "Sleeping")

	def test_pause_and_resume_lifecycle(self):
		_property_doc, room = self.make_inventory_setup("PAUSE")
		task = create_task(self.task_payload("PAUSE", room))["data"]["task"]
		assign_task(task["name"], assigned_user="Administrator")
		start_task(task["name"])

		paused = pause_task(task["name"])["data"]["task"]
		resumed = start_task(task["name"])["data"]["task"]

		self.assertEqual(paused["task_status"], "Paused")
		self.assertEqual(resumed["task_status"], "In Progress")

	def test_list_my_tasks_resolves_room_and_assignee_fields(self):
		"""Regression guard (2026-07-10 audit): list_my_tasks/list_tasks batch
		their room + assignee lookups instead of querying per row — assert the
		batched result still resolves the same fields _task_row used to."""
		_property_doc, room = self.make_inventory_setup("MYTASKS")
		task = create_task(self.task_payload("MYTASKS", room))["data"]["task"]
		assign_task(task["name"], assigned_user="Administrator")

		rows = list_my_tasks(scope="open")["data"]["tasks"]
		row = next(r for r in rows if r["name"] == task["name"])
		self.assertEqual(row["room"], room.name)
		self.assertEqual(row["room_number"], room.room_number)
		self.assertEqual(row["assigned_user"], "Administrator")
		self.assertTrue(row["assignee_name"])

	def test_list_tasks_resolves_room_and_assignee_fields_across_rows(self):
		_property_doc, room_a = self.make_inventory_setup("ALLTASKSA")
		_property_doc_b, room_b = self.make_inventory_setup("ALLTASKSB")
		task_a = create_task(self.task_payload("ALLTASKSA", room_a))["data"]["task"]
		task_b = create_task(self.task_payload("ALLTASKSB", room_b))["data"]["task"]
		assign_task(task_a["name"], assigned_user="Administrator")

		rows = {r["name"]: r for r in list_tasks(days=1)["data"]["tasks"]}
		self.assertEqual(rows[task_a["name"]]["room_number"], room_a.room_number)
		self.assertEqual(rows[task_a["name"]]["assignee_name"], "Administrator")
		self.assertEqual(rows[task_b["name"]]["room_number"], room_b.room_number)
		self.assertIsNone(rows[task_b["name"]]["assigned_user"])
		self.assertIsNone(rows[task_b["name"]]["assignee_name"])
