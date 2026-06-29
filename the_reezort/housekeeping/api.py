import json

import frappe
from frappe import _
from frappe.utils import now

from the_reezort.housekeeping.condition import log_room_condition


OPEN_TASK_STATUSES = ("Queued", "Assigned", "In Progress", "Paused", "Inspection Required", "Rework Required")
DND_BLOCKING_STATUSES = {"DND", "Refused", "Access Issue"}


def _as_dict(value):
	if isinstance(value, str):
		return json.loads(value) if value else {}
	return value or {}


def _envelope(data, warnings=None, blockers=None, next_actions=None):
	return {
		"ok": True,
		"data": data,
		"warnings": warnings or [],
		"blockers": blockers or [],
		"next_actions": next_actions or [],
	}


def _require_permission(doctype, permission_type="read"):
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)

	if not frappe.has_permission(doctype, permission_type):
		frappe.throw(
			_("You do not have {0} permission for {1}.").format(permission_type, doctype),
			frappe.PermissionError,
		)


def _task_data(task_doc):
	return {
		"name": task_doc.name,
		"resort_property": task_doc.resort_property,
		"room": task_doc.room,
		"building": task_doc.building,
		"floor": task_doc.floor,
		"task_type": task_doc.task_type,
		"task_status": task_doc.task_status,
		"priority": task_doc.priority,
		"due_at": task_doc.due_at,
		"assigned_user": task_doc.assigned_user,
		"assigned_employee": task_doc.assigned_employee,
		"requires_inspection": task_doc.requires_inspection,
		"start_time": task_doc.start_time,
		"completed_at": task_doc.completed_at,
		"completion_notes": task_doc.completion_notes,
		"dnd_status": task_doc.dnd_status,
		"idempotency_key": task_doc.idempotency_key,
	}


def _get_task(task):
	return frappe.get_doc("Housekeeping Task", task)


def _room_defaults(payload):
	room = payload.get("room")
	if not room:
		return {}

	room_doc = frappe.db.get_value("Room", room, ["resort_property", "building", "floor"], as_dict=True)
	if not room_doc:
		return {}

	return {
		"resort_property": payload.get("resort_property") or room_doc.resort_property,
		"building": payload.get("building") or room_doc.building,
		"floor": payload.get("floor") or room_doc.floor,
	}


@frappe.whitelist()
def create_task(payload):
	_require_permission("Housekeeping Task", "create")
	payload = _as_dict(payload)
	idempotency_key = payload.get("idempotency_key")
	if not idempotency_key:
		frappe.throw(_("idempotency_key is required."))

	existing = frappe.db.get_value("Housekeeping Task", {"idempotency_key": idempotency_key}, "name")
	if existing:
		return _envelope({"task": _task_data(frappe.get_doc("Housekeeping Task", existing)), "reused": True})

	defaults = _room_defaults(payload)
	task = frappe.get_doc(
		{
			"doctype": "Housekeeping Task",
			"resort_property": defaults.get("resort_property") or payload.get("resort_property"),
			"room": payload.get("room"),
			"building": defaults.get("building") or payload.get("building"),
			"floor": defaults.get("floor") or payload.get("floor"),
			"task_type": payload.get("task_type"),
			"task_status": payload.get("task_status") or "Queued",
			"priority": payload.get("priority") or "Normal",
			"due_at": payload.get("due_at"),
			"assigned_user": payload.get("assigned_user"),
			"assigned_employee": payload.get("assigned_employee"),
			"stay": payload.get("stay"),
			"reservation": payload.get("reservation"),
			"source_doctype": payload.get("source_doctype"),
			"source_name": payload.get("source_name"),
			"idempotency_key": idempotency_key,
			"requires_inspection": 1 if payload.get("requires_inspection") else 0,
			"dnd_status": payload.get("dnd_status") or "None",
		}
	)
	task.insert(ignore_permissions=True)
	return _envelope({"task": _task_data(task), "reused": False}, next_actions=["assign_task"])


@frappe.whitelist()
def assign_task(task, assigned_user=None, assigned_employee=None):
	_require_permission("Housekeeping Task", "write")
	task_doc = _get_task(task)
	task_doc.assigned_user = assigned_user
	task_doc.assigned_employee = assigned_employee
	task_doc.task_status = "Assigned"
	task_doc.save(ignore_permissions=True)
	return _envelope({"task": _task_data(task_doc)}, next_actions=["start_task"])


@frappe.whitelist()
def start_task(task):
	_require_permission("Housekeeping Task", "write")
	task_doc = _get_task(task)
	task_doc.task_status = "In Progress"
	if not task_doc.start_time:
		task_doc.start_time = now()
	task_doc.save(ignore_permissions=True)
	return _envelope({"task": _task_data(task_doc)}, next_actions=["pause_task", "complete_task"])


@frappe.whitelist()
def pause_task(task):
	_require_permission("Housekeeping Task", "write")
	task_doc = _get_task(task)
	task_doc.task_status = "Paused"
	task_doc.save(ignore_permissions=True)
	return _envelope({"task": _task_data(task_doc)}, next_actions=["start_task"])


@frappe.whitelist()
def complete_task(task, completion_notes=None):
	_require_permission("Housekeeping Task", "write")
	task_doc = _get_task(task)
	if task_doc.dnd_status in DND_BLOCKING_STATUSES:
		frappe.throw(_("DND, refused, or access issue tasks cannot be completed without resolution."))

	task_doc.task_status = "Completed"
	task_doc.completed_at = now()
	task_doc.completion_notes = completion_notes
	task_doc.save(ignore_permissions=True)

	room_condition = None
	if task_doc.room:
		room_condition = "Inspected-pending" if task_doc.requires_inspection else "Clean"
		log_room_condition(
			task_doc.room,
			"Housekeeping",
			room_condition,
			source_doctype="Housekeeping Task",
			source_name=task_doc.name,
			reason=completion_notes,
		)

	if task_doc.requires_inspection:
		task_doc.task_status = "Inspection Required"
		task_doc.save(ignore_permissions=True)

	return _envelope(
		{"task": _task_data(task_doc), "room_condition": room_condition},
		next_actions=["inspect_task"] if task_doc.requires_inspection else [],
	)


@frappe.whitelist()
def get_housekeeping_board(resort_property):
	_require_permission("Housekeeping Task", "read")
	rooms = frappe.get_all(
		"Room",
		filters={"resort_property": resort_property, "is_active": 1},
		fields=[
			"name",
			"room_number",
			"room_name",
			"building",
			"floor",
			"room_type",
			"housekeeping_status",
			"occupancy_status",
			"maintenance_status",
			"sellable_status",
		],
		order_by="building asc, floor asc, display_order asc, room_number asc",
	)
	tasks = frappe.get_all(
		"Housekeeping Task",
		filters={"resort_property": resort_property, "task_status": ["in", OPEN_TASK_STATUSES]},
		fields=["name", "room", "task_type", "task_status", "assigned_user", "assigned_employee", "priority", "due_at"],
		order_by="due_at asc, modified desc",
	)
	task_by_room = {}
	for task in tasks:
		if task.room and task.room not in task_by_room:
			task_by_room[task.room] = {
				"id": task.name,
				"type": task.task_type,
				"status": task.task_status,
				"assignee": task.assigned_user or task.assigned_employee,
				"assigned_user": task.assigned_user,
				"assigned_employee": task.assigned_employee,
				"priority": task.priority,
				"due_at": task.due_at,
			}

	return _envelope({"rooms": [{**room, "open_task": task_by_room.get(room.name)} for room in rooms]})
