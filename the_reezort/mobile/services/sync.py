"""Offline sync: the single write path for queued mobile actions.

`sync_push` is the one place an offline-originated write enters the system. It
adds an envelope — idempotency, conflict detection, audit — and then dispatches
into the *existing* 003–015 services. No business rule is reimplemented here; if
a rule changes it changes once and both clients get it.
"""

import base64
import json

import frappe
from frappe import _
from frappe.utils import now_datetime

from the_reezort.mobile.allowlist import get_action
from the_reezort.mobile.services.auth import assert_not_version_blocked
from the_reezort.utils import as_dict, as_list, envelope

# Collections sync_pull can serve, mapped to their loader. Anything else is an
# error rather than an empty list — a typo must not look like "no work today".
PULLABLE = ("housekeeping_tasks", "maintenance_tickets", "rooms_summary")

# The only documents a mobile client may attach to. Mirrors the sync_push
# allowlist: the app photographs room readiness, inspections and tickets, and
# nothing else. An open `doctype` parameter is an open write to every record in
# the system.
ATTACHABLE_DOCTYPES = ("Housekeeping Task", "Room Inspection", "Maintenance Ticket")


def _settings():
	return frappe.get_cached_doc("Mobile Settings")


def _existing_log(client_request_id: str):
	name = frappe.db.get_value(
		"Mobile Sync Log", {"client_request_id": client_request_id}, "name"
	)
	return frappe.get_doc("Mobile Sync Log", name) if name else None


def _result_from_log(log) -> dict:
	"""Replay a recorded outcome. Used for the Duplicate short-circuit."""
	out = {
		"client_request_id": log.client_request_id,
		"status": "Duplicate",
		"original_status": log.sync_status,
	}
	if log.sync_status == "Conflict":
		out.update(
			{
				"conflict_reason": log.conflict_reason,
				"server_modified": str(log.server_modified) if log.server_modified else None,
				"server_values": json.loads(log.server_values) if log.server_values else {},
			}
		)
	if log.error_message:
		out["error_message"] = log.error_message
	return out


def _conflict_values(doctype: str, name: str) -> dict:
	"""The fields the review screen compares. Deliberately narrow.

	Sending the whole document would leak fields the attendant has no permission
	to see, and would give the conflict screen a record dump to render instead of
	the two or three values that actually differ.
	"""
	# Field names verified against the shipped doctypes, not the specs: 009's
	# data-model calls the ticket field `ticket_status`, but the doctype ships
	# `state` and `assigned_to`.
	fieldmap = {
		"Housekeeping Task": ("task_status", "assigned_user", "dnd_status"),
		"Room Inspection": ("inspection_status", "inspector_user"),
		"Maintenance Ticket": ("state", "assigned_to"),
	}
	fields = fieldmap.get(doctype, ())
	if not fields:
		return {}
	values = frappe.db.get_value(doctype, name, fields, as_dict=True) or {}
	return {k: v for k, v in values.items() if v is not None}


def _changed_by(doctype: str, name: str) -> str | None:
	return frappe.db.get_value(doctype, name, "modified_by")


def _apply_one(operation: dict) -> dict:
	client_request_id = (operation or {}).get("client_request_id")
	if not client_request_id:
		return {"client_request_id": None, "status": "Rejected", "error_message": _("Missing client_request_id")}

	# 1. Idempotency. A retry over a dropped connection must replay, not re-apply.
	existing = _existing_log(client_request_id)
	if existing:
		return _result_from_log(existing)

	action_name = operation.get("action") or ""
	action = get_action(action_name)
	target_name = operation.get("target_name")

	log = frappe.new_doc("Mobile Sync Log")
	log.client_request_id = client_request_id
	log.user = frappe.session.user
	log.action = action_name
	log.target_doctype = action.target_doctype if action else operation.get("target_doctype")
	log.target_name = target_name
	log.base_modified = operation.get("base_modified")
	log.queued_at = operation.get("queued_at")
	log.received_at = now_datetime()
	log.sync_status = "Received"
	log.payload_snapshot = json.dumps(operation.get("payload") or {})

	# 2. Allowlist. An unrecognised action is rejected, never dispatched.
	if not action:
		log.sync_status = "Rejected"
		log.error_message = _("Unknown action: {0}").format(action_name)
		log.insert(ignore_permissions=True)
		return {"client_request_id": client_request_id, "status": "Rejected",
		        "error_message": log.error_message}

	if not target_name or not frappe.db.exists(action.target_doctype, target_name):
		log.sync_status = "Rejected"
		log.error_message = _("{0} {1} not found").format(action.target_doctype, target_name)
		log.insert(ignore_permissions=True)
		return {"client_request_id": client_request_id, "status": "Rejected",
		        "error_message": log.error_message}

	# 3. Conflict. Reject rather than clobber.
	server_modified = frappe.db.get_value(action.target_doctype, target_name, "modified")
	if action.hard_conflict and log.base_modified:
		if str(server_modified) != str(log.base_modified):
			server_values = _conflict_values(action.target_doctype, target_name)
			changed_by = _changed_by(action.target_doctype, target_name)
			log.sync_status = "Conflict"
			log.server_modified = server_modified
			log.changed_by = changed_by
			log.server_values = json.dumps(server_values, default=str)
			log.conflict_reason = _("{0} was changed after this was queued").format(
				action.target_doctype
			)
			log.insert(ignore_permissions=True)
			return {
				"client_request_id": client_request_id,
				"status": "Conflict",
				"conflict_reason": log.conflict_reason,
				"changed_by": changed_by,
				"changed_by_name": frappe.db.get_value("User", changed_by, "full_name")
				if changed_by
				else None,
				"server_modified": str(server_modified),
				"server_values": server_values,
				"your_values": operation.get("payload") or {},
			}

	# 4. Dispatch into the existing service. All business validation, approval
	#    gates and ERPNext posting run unchanged.
	payload = operation.get("payload") or {}
	kwargs = {k: payload[k] for k in action.payload_fields if k in payload}

	# Savepoint, not a bare rollback. A plain `frappe.db.rollback()` here would
	# undo the *whole* transaction, including the Mobile Sync Log rows written by
	# earlier operations in this same batch — and losing an idempotency record
	# means a retried batch re-applies work that already succeeded, which is the
	# one failure the ledger exists to prevent.
	savepoint = "mobile_sync_op"
	frappe.db.savepoint(savepoint)
	try:
		action.service(target_name, **kwargs)
	except Exception as exc:
		# A business rule said no. The payload is unchanged, so a retry cannot
		# help — this needs a person, which is why it is Rejected not Failed.
		frappe.db.rollback(save_point=savepoint)
		log.sync_status = "Rejected"
		log.error_message = str(exc)[:500]
		log.insert(ignore_permissions=True)
		return {"client_request_id": client_request_id, "status": "Rejected",
		        "error_message": log.error_message}

	log.sync_status = "Applied"
	log.applied_at = now_datetime()
	log.server_modified = frappe.db.get_value(action.target_doctype, target_name, "modified")
	log.insert(ignore_permissions=True)

	# Support triage: which mobile write last touched this document.
	if action.target_doctype in ("Housekeeping Task", "Maintenance Ticket"):
		frappe.db.set_value(
			action.target_doctype, target_name, "last_mobile_sync_log", log.name,
			update_modified=False,
		)

	return {"client_request_id": client_request_id, "status": "Applied",
	        "server_modified": str(log.server_modified)}


@frappe.whitelist()
def sync_push(operations):
	"""Apply a batch of queued writes, independently.

	A failure in one operation does not abort the batch. The client reconciles
	row by row, and one poisoned row must not block an attendant's whole round.
	"""
	results = []
	for operation in as_list(operations):
		try:
			results.append(_apply_one(operation))
			# Commit per operation. The batch is explicitly not atomic — one
			# poisoned row must not cost an attendant the rest of their round —
			# and an unexpected failure later must not erase what already landed.
			frappe.db.commit()
		except Exception as exc:
			frappe.db.rollback()
			frappe.log_error(frappe.get_traceback(), "mobile.sync_push")
			results.append(
				{
					"client_request_id": (operation or {}).get("client_request_id"),
					"status": "Failed",
					"error_message": str(exc)[:500],
				}
			)
	return envelope({"results": results})


@frappe.whitelist()
def _collection_query(name: str, user: str):
	"""(doctype, filters, fields) for one pullable collection.

	Field names come from the shipped doctypes, not the specs: Maintenance Ticket
	ships `state`/`assigned_to`, not the `ticket_status`/`assigned_user` that 009's
	data-model names.
	"""
	if name == "housekeeping_tasks":
		return (
			"Housekeeping Task",
			{"assigned_user": user},
			["name", "room", "task_type", "task_status", "priority", "dnd_status",
			 "assigned_user", "due_at", "modified"],
		)
	if name == "maintenance_tickets":
		return (
			"Maintenance Ticket",
			{"assigned_to": user},
			["name", "room", "state", "priority", "assigned_to", "modified"],
		)
	return (None, None, None)


def _tombstones(name: str, user: str, known_ids: list) -> list:
	"""Of the ids this device still holds, which are no longer the caller's.

	The client supplies what it has cached, because the server cannot answer
	otherwise: a task reassigned away simply stops matching the `assigned_user`
	filter, and nothing records that it once matched. Without this the row sits in
	the device cache for good — and on BYOD that is somebody else's work sitting
	on a phone the resort does not control.

	Bounded by the cache, which by design holds only the user's own work.
	"""
	doctype, filters, _fields = _collection_query(name, user)
	if not doctype or not known_ids:
		return []

	still_mine = {
		row["name"]
		for row in frappe.get_all(
			doctype, filters={**filters, "name": ["in", known_ids]}, fields=["name"]
		)
	}
	return [name_ for name_ in known_ids if name_ not in still_mine]


@frappe.whitelist()
def sync_pull(collections=None, since=None, known=None):
	"""The caller's own assigned work only, scoped by role.

	On BYOD that scoping is a security control rather than a bandwidth
	optimisation (AD-016-007): whatever this returns may sit on a phone the
	resort does not own and cannot wipe.

	`since` and the returned `watermarks` are **per collection**. A single shared
	watermark was wrong: `rooms_summary` timestamps move whenever the web SPA
	touches a room, so a room newer than the newest task would advance the
	watermark past task changes the client had never seen, and the next pull would
	filter them out. Nothing would error; the attendant would simply not be told.

	`known` maps a collection to the ids the device currently holds, and comes
	back as `tombstones` for those that are no longer the caller's.
	"""
	# A fresh read is not draining. A stale build must not pull new work against
	# a contract it no longer understands.
	assert_not_version_blocked()

	requested = as_list(collections) or list(PULLABLE)
	unknown = [c for c in requested if c not in PULLABLE]
	if unknown:
		frappe.throw(_("Unknown sync collection: {0}").format(", ".join(unknown)))

	since = as_dict(since)
	known = as_dict(known)
	limit = _settings().sync_page_size or 200
	user = frappe.session.user

	data: dict = {}
	watermarks: dict = {}
	tombstones: dict = {}
	has_more = False

	for name in ("housekeeping_tasks", "maintenance_tickets"):
		if name not in requested:
			continue
		doctype, filters, fields = _collection_query(name, user)
		mark = since.get(name)
		rows = frappe.get_all(
			doctype,
			filters={**filters, **({"modified": [">", mark]} if mark else {})},
			fields=fields,
			order_by="modified asc",
			limit=limit + 1,
		)
		has_more = has_more or len(rows) > limit
		rows = rows[:limit]
		data[name] = rows
		# Per collection, and never rolled back below what the caller already had.
		watermarks[name] = str(rows[-1]["modified"]) if rows else mark
		tombstones[name] = _tombstones(name, user, as_list(known.get(name)))

	if "rooms_summary" in requested:
		# Derived from the tasks just returned, so it carries no watermark of its
		# own — its timestamps belong to Rooms, not to the caller's work.
		room_names = {r.get("room") for r in data.get("housekeeping_tasks", []) if r.get("room")}
		data["rooms_summary"] = (
			frappe.get_all(
				"Room",
				filters={"name": ["in", list(room_names)]},
				fields=["name", "room_number", "housekeeping_status", "occupancy_status", "modified"],
			)
			if room_names
			else []
		)

	return envelope(
		{
			"collections": data,
			"watermarks": watermarks,
			"tombstones": tombstones,
			"has_more": has_more,
		}
	)


@frappe.whitelist()
def attach_mobile_file(client_request_id, doctype, name, filename, content):
	"""Thin wrapper over the standard upload, made idempotent.

	A retried upload over a dropped connection must not leave two copies of the
	same readiness photo on a room record, so the same `client_request_id` or the
	same content hash short-circuits.
	"""
	# Permission first, before anything reads or writes on the caller's behalf.
	#
	# `ignore_permissions=False` on the insert below looks like the guard, but is
	# not: Frappe's File.has_permission short-circuits on create
	# (`frappe/core/doctype/file/file.py`) and checks only generic File-create
	# permission, never the document being attached to. Without this check a
	# housekeeping token could plant attachments on reservations, folios, or User
	# records — verified before it was added.
	if doctype not in ATTACHABLE_DOCTYPES:
		frappe.throw(
			_("Attachments are not accepted for {0}").format(doctype), frappe.PermissionError
		)
	if not frappe.db.exists(doctype, name):
		frappe.throw(_("{0} {1} not found").format(doctype, name))
	if not frappe.has_permission(doctype, "write", doc=name):
		frappe.throw(
			_("Not permitted to attach to {0} {1}").format(doctype, name), frappe.PermissionError
		)

	existing = _existing_log(client_request_id)
	if existing:
		return envelope({"status": "Duplicate", "file_url": existing.error_message or None})

	# Hash exactly what Frappe hashes, or the guard silently never matches.
	# `File.content_hash` is MD5 over the *decoded* bytes
	# (`frappe/core/doctype/file/utils.py:get_content_hash`); hashing the base64
	# text instead produced a second attachment for byte-identical photos, which
	# is precisely the duplicate this endpoint exists to prevent.
	from frappe.core.doctype.file.utils import get_content_hash

	payload = content.split(",", 1)[1] if content.startswith("data:") else content
	try:
		raw = base64.b64decode(payload)
	except Exception:
		frappe.throw(_("Attachment content must be base64"))

	content_hash = get_content_hash(raw)
	duplicate = frappe.db.get_value(
		"File",
		{"attached_to_doctype": doctype, "attached_to_name": name, "content_hash": content_hash},
		"file_url",
	)

	log = frappe.new_doc("Mobile Sync Log")
	log.client_request_id = client_request_id
	log.user = frappe.session.user
	log.action = "file.attach"
	log.target_doctype = doctype
	log.target_name = name
	log.received_at = now_datetime()

	if duplicate:
		log.sync_status = "Duplicate"
		log.error_message = f"content_hash {content_hash}"
		log.insert(ignore_permissions=True)
		frappe.db.commit()
		return envelope({"status": "Duplicate", "file_url": duplicate})

	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": filename,
			"attached_to_doctype": doctype,
			"attached_to_name": name,
			"content": content,
			"decode": True,
			"is_private": 1,
		}
	).insert(ignore_permissions=False)

	log.sync_status = "Applied"
	log.applied_at = now_datetime()
	log.insert(ignore_permissions=True)
	frappe.db.commit()
	return envelope({"status": "Applied", "file_url": file_doc.file_url})


def purge_sync_logs():
	"""Scheduled. Sync logs are audit, not state."""
	days = _settings().sync_log_retention_days or 90
	frappe.db.delete(
		"Mobile Sync Log",
		{"received_at": ["<", frappe.utils.add_days(now_datetime(), -days)]},
	)
	frappe.db.commit()
