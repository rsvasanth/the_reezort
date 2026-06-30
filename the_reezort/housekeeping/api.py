import json

import frappe
from frappe import _
from frappe.utils import now

from the_reezort.housekeeping.condition import log_room_condition


OPEN_TASK_STATUSES = ("Queued", "Assigned", "In Progress", "Paused", "Inspection Required", "Rework Required")
DND_BLOCKING_STATUSES = {"DND", "Refused", "Access Issue"}
INSPECTION_OUTCOMES = {"Passed", "Failed", "Rework Required", "Maintenance Required", "Accepted With Exception"}


def _as_dict(value):
	if isinstance(value, str):
		return json.loads(value) if value else {}
	return value or {}


def _as_list(value):
	if isinstance(value, str):
		return json.loads(value) if value else []
	return value or []


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
		"checklist_template": task_doc.get("checklist_template"),
		"requires_inspection": task_doc.requires_inspection,
		"start_time": task_doc.start_time,
		"completed_at": task_doc.completed_at,
		"completion_notes": task_doc.completion_notes,
		"dnd_status": task_doc.dnd_status,
		"idempotency_key": task_doc.idempotency_key,
	}


def _inspection_data(inspection_doc):
	return {
		"name": inspection_doc.name,
		"resort_property": inspection_doc.resort_property,
		"room": inspection_doc.room,
		"housekeeping_task": inspection_doc.housekeeping_task,
		"inspection_status": inspection_doc.inspection_status,
		"inspector_user": inspection_doc.inspector_user,
		"inspected_at": inspection_doc.inspected_at,
		"rework_task": inspection_doc.rework_task,
		"exception_approval": inspection_doc.exception_approval,
		"notes": inspection_doc.notes,
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
			"checklist_template": payload.get("checklist_template"),
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


def _item_key(row):
	return (row.get("section") or "", row.get("item_label") or "")


def _photos_by_item(photos):
	photos = _as_list(photos)
	mapped = {}
	for index, photo in enumerate(photos):
		if isinstance(photo, str):
			mapped[("", str(index))] = photo
			continue

		key = (photo.get("section") or "", photo.get("item_label") or "")
		if key[1]:
			mapped[key] = photo.get("photo") or photo.get("file_url")
	return mapped


def _checklist_items(checklist):
	checklist = _as_dict(checklist)
	return _as_list(checklist.get("items") or checklist.get("result_items"))


def _validate_and_save_checklist_result(task_doc, checklist=None, notes=None, photos=None, exception_approval=None):
	template_name = task_doc.get("checklist_template")
	checklist_payload = _as_dict(checklist)
	if checklist_payload.get("template"):
		template_name = checklist_payload.get("template")

	if not template_name:
		return None

	template = frappe.get_doc("Housekeeping Checklist Template", template_name)
	template_items = list(template.get("checklist_items") or [])
	supplied_items = _checklist_items(checklist_payload)
	supplied_by_key = {_item_key(item): item for item in supplied_items}
	photo_by_key = _photos_by_item(photos)
	has_exception = bool(exception_approval or task_doc.exception_approval)

	for item in supplied_items:
		key = _item_key(item)
		if not item.get("photo") and key in photo_by_key:
			item["photo"] = photo_by_key[key]

	missing_mandatory = []
	missing_photos = []
	for template_item in template_items:
		key = (template_item.section or "", template_item.item_label or "")
		result_item = supplied_by_key.get(key)
		if template_item.mandatory and not result_item:
			missing_mandatory.append(template_item.item_label)
			continue
		if template_item.requires_photo and (not result_item or not result_item.get("photo")):
			missing_photos.append(template_item.item_label)

	if missing_mandatory and not has_exception:
		frappe.throw(_("Mandatory checklist items missing: {0}").format(", ".join(missing_mandatory)))
	if missing_photos and not has_exception:
		frappe.throw(_("Checklist photos missing: {0}").format(", ".join(missing_photos)))

	if not supplied_items and not has_exception:
		return None

	result = frappe.get_doc(
		{
			"doctype": "Housekeeping Checklist Result",
			"housekeeping_task": task_doc.name,
			"template": template.name,
			"result_status": "Exception Approved" if has_exception else "Completed",
			"completed_by": frappe.session.user,
			"completed_at": now(),
			"notes": notes,
		}
	)
	for item in supplied_items:
		result.append(
			"result_items",
			{
				"section": item.get("section"),
				"item_label": item.get("item_label"),
				"result": item.get("result"),
				"notes": item.get("notes"),
				"photo": item.get("photo"),
				"exception_flag": 1 if item.get("exception_flag") else 0,
			},
		)
	result.insert(ignore_permissions=True)
	return result


@frappe.whitelist()
def complete_task(task, checklist=None, notes=None, photos=None, exception_approval=None, completion_notes=None):
	_require_permission("Housekeeping Task", "write")
	task_doc = _get_task(task)
	if task_doc.dnd_status in DND_BLOCKING_STATUSES:
		frappe.throw(_("DND, refused, or access issue tasks cannot be completed without resolution."))

	completion_notes = notes if notes is not None else completion_notes
	if exception_approval:
		task_doc.exception_approval = exception_approval
		if not frappe.db.exists("DocType", "Housekeeping Exception Approval"):
			task_doc.flags.ignore_links = True
	checklist_result = _validate_and_save_checklist_result(
		task_doc,
		checklist=checklist,
		notes=completion_notes,
		photos=photos,
		exception_approval=exception_approval,
	)

	task_doc.task_status = "Completed"
	task_doc.completed_at = now()
	task_doc.completion_notes = completion_notes
	task_doc.save(ignore_permissions=True)

	room_condition = None
	if task_doc.room:
		room_condition = "Clean"
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
		{
			"task": _task_data(task_doc),
			"room_condition": room_condition,
			"checklist_result": checklist_result.name if checklist_result else None,
		},
		next_actions=["inspect_task"] if task_doc.requires_inspection else [],
	)


@frappe.whitelist()
def get_housekeeping_board(resort_property=None):
	_require_permission("Housekeeping Task", "read")
	# Default to the first active property so the board works after the demo wipe.
	if not resort_property:
		resort_property = frappe.db.get_value("Resort Property", {"is_active": 1}, "name")
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


@frappe.whitelist()
def create_inspection(housekeeping_task):
	_require_permission("Room Inspection", "create")
	task_doc = _get_task(housekeeping_task)
	if not task_doc.room:
		frappe.throw(_("Room Inspection requires a room-linked housekeeping task."))

	existing = frappe.db.get_value(
		"Room Inspection",
		{"housekeeping_task": task_doc.name, "inspection_status": ["not in", ["Cancelled"]]},
		"name",
		order_by="creation asc",
	)
	if existing:
		return _envelope({"inspection": _inspection_data(frappe.get_doc("Room Inspection", existing)), "reused": True})

	inspection = frappe.get_doc(
		{
			"doctype": "Room Inspection",
			"resort_property": task_doc.resort_property,
			"room": task_doc.room,
			"housekeeping_task": task_doc.name,
			"inspection_status": "Draft",
			"inspector_user": frappe.session.user,
		}
	)
	inspection.insert(ignore_permissions=True)
	return _envelope({"inspection": _inspection_data(inspection), "reused": False}, next_actions=["record_inspection"])


def _create_rework_task(inspection_doc):
	source_key = f"room-inspection-rework:{inspection_doc.name}"
	existing = frappe.db.get_value("Housekeeping Task", {"idempotency_key": source_key}, "name")
	if existing:
		return frappe.get_doc("Housekeeping Task", existing)

	original_task = frappe.get_doc("Housekeeping Task", inspection_doc.housekeeping_task)
	rework = frappe.get_doc(
		{
			"doctype": "Housekeeping Task",
			"resort_property": inspection_doc.resort_property,
			"room": inspection_doc.room,
			"building": original_task.building,
			"floor": original_task.floor,
			"task_type": "Room Inspection",
			"task_status": "Queued",
			"priority": original_task.priority or "Normal",
			"assigned_user": original_task.assigned_user,
			"assigned_employee": original_task.assigned_employee,
			"source_doctype": "Room Inspection",
			"source_name": inspection_doc.name,
			"idempotency_key": source_key,
			"requires_inspection": 1,
		}
	)
	rework.insert(ignore_permissions=True)
	return rework


def _has_open_blocking_maintenance(room):
	# TODO: Replace this placeholder once the Maintenance module owns blocking maintenance documents.
	return False


@frappe.whitelist()
def record_inspection(inspection, outcome, notes=None, checklist_result=None):
	_require_permission("Room Inspection", "write")
	if outcome not in INSPECTION_OUTCOMES:
		frappe.throw(_("Unsupported inspection outcome: {0}").format(outcome))

	inspection_doc = frappe.get_doc("Room Inspection", inspection)
	if inspection_doc.inspection_status == "Draft":
		inspection_doc.inspection_status = "In Progress"
		inspection_doc.save(ignore_permissions=True)

	inspection_doc.notes = notes
	inspection_doc.inspected_at = now()
	if checklist_result:
		frappe.db.set_value("Housekeeping Checklist Result", checklist_result, "room_inspection", inspection_doc.name)

	if outcome == "Passed":
		if _has_open_blocking_maintenance(inspection_doc.room):
			frappe.throw(_("Room cannot become inspected while blocking maintenance is open."))
		inspection_doc.inspection_status = "Passed"
		inspection_doc.save(ignore_permissions=True)
		log_room_condition(
			inspection_doc.room,
			"Housekeeping",
			"Inspected",
			source_doctype="Room Inspection",
			source_name=inspection_doc.name,
			reason=notes,
		)
		# Close the task on a passed inspection so it leaves the open board.
		if inspection_doc.housekeeping_task:
			passed_task = frappe.get_doc("Housekeeping Task", inspection_doc.housekeeping_task)
			if passed_task.task_status != "Completed":
				passed_task.task_status = "Completed"
				passed_task.save(ignore_permissions=True)
		return _envelope({"inspection": _inspection_data(inspection_doc)}, next_actions=[])

	if outcome == "Accepted With Exception":
		inspection_doc.inspection_status = "Accepted With Exception"
		if not frappe.db.exists("DocType", "Housekeeping Exception Approval"):
			inspection_doc.flags.ignore_links = True
		inspection_doc.save(ignore_permissions=True)
		return _envelope({"inspection": _inspection_data(inspection_doc)}, next_actions=[])

	if outcome == "Maintenance Required":
		inspection_doc.inspection_status = "Maintenance Required"
		inspection_doc.save(ignore_permissions=True)
		return _envelope({"inspection": _inspection_data(inspection_doc)}, next_actions=[])

	if outcome == "Failed":
		inspection_doc.inspection_status = "Failed"
		inspection_doc.save(ignore_permissions=True)
	elif outcome == "Rework Required":
		inspection_doc.inspection_status = "Failed"
		inspection_doc.save(ignore_permissions=True)

	rework_task = _create_rework_task(inspection_doc)
	inspection_doc.inspection_status = "Rework Required"
	inspection_doc.rework_task = rework_task.name
	inspection_doc.save(ignore_permissions=True)
	return _envelope(
		{"inspection": _inspection_data(inspection_doc), "rework_task": _task_data(rework_task)},
		next_actions=["assign_task"],
	)
