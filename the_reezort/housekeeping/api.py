import frappe
from frappe import _
from frappe.utils import now

from the_reezort.housekeeping.condition import log_room_condition
from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import as_list as _as_list
from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission


OPEN_TASK_STATUSES = ("Queued", "Assigned", "In Progress", "Paused", "Inspection Required", "Rework Required")
DND_BLOCKING_STATUSES = {"DND", "Refused", "Access Issue"}
INSPECTION_OUTCOMES = {"Passed", "Failed", "Rework Required", "Maintenance Required", "Accepted With Exception"}


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


def _photo_row_data(row):
	return {"image": row.image, "caption": row.caption, "area": row.area}


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
		"photos": [_photo_row_data(row) for row in (inspection_doc.get("photos") or [])],
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
def list_housekeepers():
	"""Active staff who can be assigned a housekeeping task (Housekeeping role).

	Any user with read permission on Housekeeping Task can call this — the
	Front Desk sees the same picker options as the Housekeeping supervisor.
	Also includes Maintenance staff since the auto-generated 'Maintenance
	Follow-up' tasks from a room-move are best routed to them.
	"""
	_require_permission("Housekeeping Task", "read")
	targets = ("Housekeeping", "Maintenance")
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT u.name, u.full_name, u.email, GROUP_CONCAT(hr.role) AS roles
		FROM `tabUser` u
		JOIN `tabHas Role` hr ON hr.parent = u.name
		WHERE u.enabled = 1 AND hr.role IN %(roles)s
		GROUP BY u.name, u.full_name, u.email
		ORDER BY u.full_name
		""",
		{"roles": targets},
		as_dict=True,
	)
	for r in rows:
		r["roles"] = [x for x in (r.get("roles") or "").split(",") if x]
		r["employee"] = frappe.db.get_value("Employee", {"user_id": r["name"]}, "name")
	return _envelope({"staff": rows})


@frappe.whitelist()
def assign_task(task, assigned_user=None, assigned_employee=None):
	_require_permission("Housekeeping Task", "write")
	task_doc = _get_task(task)
	# When the user picks a person, backfill the linked Employee (if any) so
	# both the SPA view and any ERPNext HR report see the assignment.
	if assigned_user and not assigned_employee:
		assigned_employee = frappe.db.get_value("Employee", {"user_id": assigned_user}, "name")
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
def mark_dnd_or_refused(task, dnd_status, notes=None):
	"""Record a Do-Not-Disturb / refused-entry / access-issue so the task doesn't
	sit In Progress forever. Pauses it (a supervisor can re-queue or reschedule);
	the DND guard on complete_task then blocks completion until it's cleared.
	`dnd_status` ∈ {DND, Refused, Access Issue}."""
	_require_permission("Housekeeping Task", "write")
	if dnd_status not in DND_BLOCKING_STATUSES:
		frappe.throw(_("dnd_status must be one of: {0}.").format(", ".join(sorted(DND_BLOCKING_STATUSES))))
	task_doc = _get_task(task)
	if task_doc.task_status in {"Completed", "Cancelled"}:
		frappe.throw(_("Task {0} is {1}; it can't be marked {2}.").format(task, task_doc.task_status, dnd_status))
	task_doc.dnd_status = dnd_status
	task_doc.task_status = "Paused"
	if notes:
		task_doc.completion_notes = "\n".join(
			filter(None, [task_doc.completion_notes, f"[{dnd_status}] {notes}"])
		)
	task_doc.save(ignore_permissions=True)
	from the_reezort.audit.api import record_audit_event

	record_audit_event(
		"Housekeeping Task", task_doc.name, f"housekeeping.{dnd_status.lower().replace(' ', '_')}",
		notes or "", {"dnd_status": dnd_status, "room": task_doc.room},
	)
	return _envelope({"task": _task_data(task_doc)}, next_actions=["start_task", "assign_task"])


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


def _append_photo_rows(doc, photos):
	"""Normalize photo payload entries (bare file URLs or {image|photo|file_url,
	caption, area} dicts) into Room Condition Photo child rows on `doc.photos`.
	Entries carrying an item_label belong to the checklist mapping, not here."""
	appended = 0
	for entry in _as_list(photos):
		if isinstance(entry, str):
			image, caption, area = entry, None, None
		elif isinstance(entry, dict) and not entry.get("item_label"):
			image = entry.get("image") or entry.get("photo") or entry.get("file_url")
			caption = entry.get("caption")
			area = entry.get("area")
		else:
			continue
		if not image:
			continue
		doc.append("photos", {"image": image, "caption": caption, "area": area})
		appended += 1
	return appended


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

	# Photos without a checklist item_label are completion evidence — keep them
	# on the task itself so templateless tasks don't silently drop them.
	_append_photo_rows(task_doc, photos)

	task_doc.task_status = "Completed"
	task_doc.completed_at = now()
	task_doc.completion_notes = completion_notes
	task_doc.save(ignore_permissions=True)

	# Only advance the room to Clean (an allocatable status) when no inspection
	# is required. When it is, the room must NOT become sellable until inspection
	# passes — record_inspection sets it to Inspected then. Marking it Clean here
	# would let a not-yet-inspected room re-enter sellable inventory.
	room_condition = None
	if task_doc.room and not task_doc.requires_inspection:
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
			"image",
		],
		order_by="building asc, floor asc, display_order asc, room_number asc",
	)
	# Room Type image is the safety net so every card has a thumb.
	room_types_with_image = {
		rt["name"]: rt["image"]
		for rt in frappe.get_all("Room Type", filters={"is_active": 1}, fields=["name", "image"])
	}
	for r in rooms:
		if not r.get("image") and r.get("room_type"):
			r["image"] = room_types_with_image.get(r["room_type"])
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


# An open High/Urgent maintenance ticket keeps a room out of sellable service —
# it must not pass inspection until the work is Resolved or Closed.
BLOCKING_MAINTENANCE_STATES = ("Reported", "Assigned", "In Progress")
BLOCKING_MAINTENANCE_PRIORITIES = ("High", "Urgent")


def _has_open_blocking_maintenance(room):
	if not room or not frappe.db.exists("DocType", "Maintenance Ticket"):
		return False
	return bool(
		frappe.db.exists(
			"Maintenance Ticket",
			{
				"room": room,
				"state": ["in", BLOCKING_MAINTENANCE_STATES],
				"priority": ["in", BLOCKING_MAINTENANCE_PRIORITIES],
			},
		)
	)


@frappe.whitelist()
def record_inspection(inspection, outcome, notes=None, checklist_result=None, photos=None):
	_require_permission("Room Inspection", "write")
	if outcome not in INSPECTION_OUTCOMES:
		frappe.throw(_("Unsupported inspection outcome: {0}").format(outcome))

	inspection_doc = frappe.get_doc("Room Inspection", inspection)
	if inspection_doc.inspection_status == "Draft":
		inspection_doc.inspection_status = "In Progress"
		inspection_doc.save(ignore_permissions=True)

	inspection_doc.notes = notes
	inspection_doc.inspected_at = now()
	_append_photo_rows(inspection_doc, photos)
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


# ---------- room readiness (front desk check-in) ----------

READY_INSPECTION_STATUSES = ("Passed", "Accepted With Exception")


@frappe.whitelist()
def get_room_readiness(room):
	"""Latest housekeeping readiness evidence for a room — shown to front desk
	at check-in. Gated on Room read (front-office roles have it) because Room
	Inspection itself is housekeeping-scoped."""
	_require_permission("Room", "read")
	room_doc = frappe.db.get_value(
		"Room",
		room,
		["name", "room_number", "room_name", "housekeeping_status", "occupancy_status"],
		as_dict=True,
	)
	if not room_doc:
		frappe.throw(_("Room {0} not found.").format(room))

	inspection_name = frappe.db.get_value(
		"Room Inspection",
		{"room": room, "inspection_status": ["in", READY_INSPECTION_STATUSES]},
		"name",
		order_by="inspected_at desc, creation desc",
	)

	inspection = None
	photos = []
	if inspection_name:
		inspection_doc = frappe.get_doc("Room Inspection", inspection_name)
		inspection = _inspection_data(inspection_doc)
		inspection["inspector_name"] = frappe.db.get_value("User", inspection_doc.inspector_user, "full_name")
		photos = [dict(_photo_row_data(row), source="Inspection") for row in (inspection_doc.get("photos") or [])]

		if inspection_doc.housekeeping_task:
			task_doc = frappe.get_doc("Housekeeping Task", inspection_doc.housekeeping_task)
			photos += [dict(_photo_row_data(row), source="Cleaning") for row in (task_doc.get("photos") or [])]
			result_names = frappe.get_all(
				"Housekeeping Checklist Result",
				filters={"housekeeping_task": task_doc.name},
				pluck="name",
			)
			for result_name in result_names:
				result_doc = frappe.get_doc("Housekeeping Checklist Result", result_name)
				for item in result_doc.get("result_items") or []:
					if item.photo:
						photos.append(
							{"image": item.photo, "caption": item.item_label, "area": item.section, "source": "Checklist"}
						)

	return _envelope(
		{
			"room": room_doc.name,
			"room_number": room_doc.room_number,
			"room_name": room_doc.room_name,
			"housekeeping_status": room_doc.housekeeping_status,
			"occupancy_status": room_doc.occupancy_status,
			"ready": room_doc.housekeeping_status in ("Inspected", "Clean"),
			"inspection": inspection,
			"photos": photos,
		}
	)


# ---------- task lists (my tasks + all tasks) ----------

OPEN_TASK_STATUSES = ("Queued", "Assigned", "In Progress", "Paused", "Inspection Required", "Rework Required")
CLOSED_TASK_STATUSES = ("Completed", "Cancelled", "Skipped")


def _task_rows(rows):
	"""Batch-resolve room + assignee display fields for a list of task rows —
	a handful of queries total instead of up to 3 queries per row (2026-07-10
	audit: list_my_tasks/list_tasks were issuing 2 Room lookups + 1 User lookup
	per row, ~600 extra queries at their 200/500 row limits)."""
	room_names = list({row.room for row in rows if row.room})
	room_by_name = {
		room.name: room
		for room in (
			frappe.get_all("Room", filters={"name": ["in", room_names]}, fields=["name", "room_name", "room_number"])
			if room_names
			else []
		)
	}
	user_names = list({row.assigned_user for row in rows if row.assigned_user})
	full_name_by_user = {
		u.name: u.full_name
		for u in (frappe.get_all("User", filters={"name": ["in", user_names]}, fields=["name", "full_name"]) if user_names else [])
	}
	out = []
	for row in rows:
		room = room_by_name.get(row.room)
		out.append(
			{
				"name": row.name,
				"room": row.room,
				"room_number": room.room_number if room else None,
				"room_name": room.room_name if room else None,
				"task_type": row.task_type,
				"task_status": row.task_status,
				"priority": row.priority,
				"assigned_user": row.assigned_user,
				"assigned_employee": row.assigned_employee,
				"assignee_name": full_name_by_user.get(row.assigned_user) if row.assigned_user else None,
				"start_time": row.start_time,
				"completed_at": row.completed_at,
				"due_at": row.due_at,
				"stay": row.stay,
			}
		)
	return out


@frappe.whitelist()
def list_my_tasks(scope="open", limit=200):
	"""Tasks assigned to the current user (staff self-service).

	scope='open'   → Queued / Assigned / In Progress / Paused / Inspection Required
	scope='history' → Completed / Cancelled / Skipped (last {limit}, most recent first)
	"""
	_require_permission("Housekeeping Task", "read")
	statuses = OPEN_TASK_STATUSES if scope == "open" else CLOSED_TASK_STATUSES
	order = "creation desc" if scope == "history" else "priority desc, creation asc"
	rows = frappe.get_all(
		"Housekeeping Task",
		filters={"assigned_user": frappe.session.user, "task_status": ["in", statuses]},
		fields=[
			"name", "room", "task_type", "task_status", "priority",
			"assigned_user", "assigned_employee", "start_time", "completed_at",
			"due_at", "stay",
		],
		order_by=order,
		limit=int(limit),
	)
	return _envelope({"tasks": _task_rows(rows), "scope": scope})


@frappe.whitelist()
def list_tasks(status=None, task_type=None, assigned_user=None, days=14, limit=500):
	"""Manager view — all tasks across the property, filterable.

	Defaults to the last {days} days by creation. Not gated to staff admin — any
	user with Housekeeping Task read permission can browse (Front Desk needs it
	to route calls); the doctype's own perms enforce write access downstream.
	"""
	from frappe.utils import add_days, today

	_require_permission("Housekeeping Task", "read")
	filters = {"creation": [">=", add_days(today(), -int(days))]}
	if status:
		filters["task_status"] = ["in", [s.strip() for s in str(status).split(",") if s.strip()]]
	if task_type:
		filters["task_type"] = task_type
	if assigned_user:
		filters["assigned_user"] = assigned_user
	rows = frappe.get_all(
		"Housekeeping Task",
		filters=filters,
		fields=[
			"name", "room", "task_type", "task_status", "priority",
			"assigned_user", "assigned_employee", "start_time", "completed_at",
			"due_at", "stay", "creation",
		],
		order_by="creation desc",
		limit=int(limit),
	)
	return _envelope({"tasks": _task_rows(rows)})
