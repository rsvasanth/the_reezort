"""Push triggers, wired as document observers.

Deliberately *not* calls planted inside 003–015 service functions. Observing the
documents keeps this module's blast radius to its own files: no existing service
changes, nothing to unpick if push is disabled, and no risk of a notification
call sitting inside a business transaction it could fail.

Every handler is defensive to the point of paranoia. A push is worth strictly
less than the transaction that triggered it, so a handler that raises would be a
worse bug than a notification nobody receives.
"""

import frappe

from the_reezort.mobile.services.push import dispatch_push


def _changed(doc, field: str):
	"""Previous value of a field, or None on insert."""
	before = doc.get_doc_before_save()
	if not before:
		return None
	old, new = before.get(field), doc.get(field)
	return old if old != new else None


def _room_label(doc) -> str:
	room = doc.get("room")
	if not room:
		return doc.name
	number = frappe.db.get_value("Room", room, "room_number")
	return f"Room {number}" if number else room


def on_housekeeping_task_update(doc, method=None):
	"""005: a task assigned to someone is a push to that someone."""
	try:
		if not doc.get("assigned_user"):
			return
		before = doc.get_doc_before_save()
		if before and before.get("assigned_user") == doc.assigned_user:
			return
		dispatch_push(
			user=doc.assigned_user,
			event_type="Task Assigned",
			title=f"{doc.task_type} · {_room_label(doc)}",
			# Guest-safe and PII-minimal: room number and task type only. Android
			# renders this on a lock screen anyone holding the handset can read.
			body=f"Priority {doc.get('priority') or 'Normal'}",
			deep_link=f"ops://task/{doc.name}",
			source_doctype=doc.doctype,
			source_name=doc.name,
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "mobile.on_housekeeping_task_update")


def on_maintenance_ticket_update(doc, method=None):
	"""009: same, for the technician.

	The ticket doctype ships `assigned_to` and `state` — not the `assigned_user`
	and `ticket_status` that spec 009's data-model names.
	"""
	try:
		if not doc.get("assigned_to"):
			return
		before = doc.get_doc_before_save()
		if before and before.get("assigned_to") == doc.assigned_to:
			return
		dispatch_push(
			user=doc.assigned_to,
			event_type="Task Assigned",
			title=f"Ticket · {_room_label(doc)}",
			# Reference and priority only — never the ticket's free-text summary.
			# That field is user-authored and routinely carries guest detail
			# ("Mr Sharma complained, comping the night"), and Android renders push
			# bodies on the lock screen of a personal phone where anyone holding it
			# can read them. The deep link carries them to the detail; the
			# notification does not need to.
			body=f"{doc.get('priority') or 'Normal'} · {doc.name}",
			deep_link=f"ops://ticket/{doc.name}",
			source_doctype=doc.doctype,
			source_name=doc.name,
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "mobile.on_maintenance_ticket_update")


def on_approval_request_update(doc, method=None):
	"""015: pending approvals chase the approver; decisions go back to the requester.

	Approvals are online-only on the client (a stale approval applied from an
	outbox is a control failure), so the push is how a manager learns there is
	something waiting at all.
	"""
	try:
		# Field names taken from the shipped doctype. An earlier version read
		# `approval_status`/`status`/`request_type`/`approver_role`, none of which
		# exist here: both sides of the change check came back None, compared equal,
		# and the handler returned before dispatching anything. Approval push was
		# wired but inert.
		state = doc.get("state")
		before = doc.get_doc_before_save()
		if before and before.get("state") == state:
			return

		# The action name is an internal policy identifier, not guest text — safe
		# for a lock screen, unlike a free-text summary or reason.
		detail = doc.get("action") or doc.doctype

		if state == "Pending":
			# approver_role lives on the policy, not on the request.
			approver_role = frappe.db.get_value("Approval Policy", doc.get("policy"), "approver_role")
			for user in _users_with_role(approver_role):
				dispatch_push(
					user=user,
					event_type="Approval Pending",
					title="Approval needed",
					body=detail,
					deep_link=f"ops://approval/{doc.name}",
					source_doctype=doc.doctype,
					source_name=doc.name,
				)
		elif state in ("Approved", "Rejected"):
			requester = doc.get("requester") or doc.owner
			if requester:
				dispatch_push(
					user=requester,
					event_type="Approval Decided",
					title=f"Request {state.lower()}",
					body=detail,
					deep_link=f"ops://approval/{doc.name}",
					source_doctype=doc.doctype,
					source_name=doc.name,
				)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "mobile.on_approval_request_update")


def _users_with_role(role: str | None) -> list[str]:
	if not role:
		return []
	return [
		row["parent"]
		for row in frappe.get_all(
			"Has Role", filters={"role": role, "parenttype": "User"}, fields=["parent"]
		)
		if row["parent"] not in ("Administrator", "Guest")
	]
