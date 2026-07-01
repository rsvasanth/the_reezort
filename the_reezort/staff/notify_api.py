"""User notifications — bell + follow-ups (spec 008 / N1).

Reuses Frappe's built-in **Notification Log** doctype (has for_user / read /
subject / document_type + name / type) so we don't invent a parallel system.
Adds a thin SPA-facing surface with per-user list, mark-read, mark-all-read,
and role-based fan-out helpers. Realtime badge updates go through
`frappe.publish_realtime("new_notification", user=...)` — the bell listens
on that event.

Emitters are wired into the write endpoints in leave_api / advance_api /
approvals so the person who should act finds out immediately.
"""

from __future__ import annotations

import frappe
from frappe import _

from the_reezort.staff.api import _envelope

NOTIFY_KINDS = {"Assignment", "Alert", "Mention", "Share", "Event", "Energy Point"}
DEFAULT_KIND = "Alert"


# ---------- login guard ----------


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


# ---------- emitters (server-side; not whitelisted) ----------


def notify_user(
	*,
	user: str,
	subject: str,
	body: str | None = None,
	source_doctype: str | None = None,
	source_name: str | None = None,
	kind: str = DEFAULT_KIND,
	dedupe_key: str | None = None,
) -> str | None:
	"""Create one Notification Log row for `user`. Idempotent if `dedupe_key`
	is supplied — we drop a row when the same key already exists as unread for
	the same user. Returns the row name, or None if suppressed."""
	if not user or user == "Guest":
		return None
	if not frappe.db.exists("User", user):
		return None
	if kind not in NOTIFY_KINDS:
		kind = DEFAULT_KIND

	if dedupe_key:
		existing = frappe.db.get_value(
			"Notification Log",
			{"for_user": user, "read": 0, "email_content": ["like", f"%{dedupe_key}%"]},
			"name",
		)
		if existing:
			return existing

	doc = frappe.get_doc(
		{
			"doctype": "Notification Log",
			"for_user": user,
			"subject": subject,
			"email_content": (body or "") + (f"\n\n[dedupe:{dedupe_key}]" if dedupe_key else ""),
			"type": kind,
			"document_type": source_doctype,
			"document_name": source_name,
			"from_user": frappe.session.user,
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert(ignore_permissions=True)

	try:
		frappe.publish_realtime(
			event="new_notification",
			user=user,
			message={
				"name": doc.name,
				"subject": subject,
				"document_type": source_doctype,
				"document_name": source_name,
				"type": kind,
			},
		)
	except Exception:
		pass
	return doc.name


def notify_role(
	*,
	role: str | list[str],
	subject: str,
	body: str | None = None,
	source_doctype: str | None = None,
	source_name: str | None = None,
	kind: str = DEFAULT_KIND,
	dedupe_key: str | None = None,
	exclude_users: set[str] | None = None,
) -> list[str]:
	"""Fan out to every enabled User that holds any of the given roles."""
	roles = [role] if isinstance(role, str) else list(role)
	users = frappe.db.sql(
		"""
		SELECT DISTINCT hr.parent AS user
		FROM `tabHas Role` hr
		JOIN `tabUser` u ON u.name = hr.parent
		WHERE hr.role IN %(roles)s AND u.enabled = 1 AND u.name NOT IN ('Guest','Administrator')
		""",
		{"roles": tuple(roles) if roles else ("__none__",)},
		as_dict=True,
	)
	exclude = exclude_users or set()
	created = []
	for row in users:
		if row["user"] in exclude:
			continue
		name = notify_user(
			user=row["user"],
			subject=subject,
			body=body,
			source_doctype=source_doctype,
			source_name=source_name,
			kind=kind,
			dedupe_key=dedupe_key,
		)
		if name:
			created.append(name)
	return created


# ---------- SPA-facing (whitelisted) ----------


@frappe.whitelist()
def list_my_notifications(unread_only: int = 0, limit: int = 30) -> dict:
	_require_login()
	filters = {"for_user": frappe.session.user}
	if int(unread_only or 0):
		filters["read"] = 0
	rows = frappe.get_all(
		"Notification Log",
		filters=filters,
		fields=[
			"name", "subject", "type", "read",
			"document_type", "document_name", "creation", "from_user",
		],
		order_by="creation desc",
		limit=int(limit or 30),
	)
	for r in rows:
		r["creation"] = str(r["creation"]) if r["creation"] else None
	unread_count = frappe.db.count(
		"Notification Log", {"for_user": frappe.session.user, "read": 0}
	)
	return _envelope({"notifications": rows, "unread_count": int(unread_count or 0)})


@frappe.whitelist()
def get_unread_count() -> dict:
	_require_login()
	count = frappe.db.count(
		"Notification Log", {"for_user": frappe.session.user, "read": 0}
	)
	return _envelope({"unread_count": int(count or 0)})


@frappe.whitelist()
def mark_read(name: str) -> dict:
	_require_login()
	owner = frappe.db.get_value("Notification Log", name, "for_user")
	if not owner:
		frappe.throw(_("Notification not found."))
	if owner != frappe.session.user:
		frappe.throw(_("Not your notification."), frappe.PermissionError)
	frappe.db.set_value("Notification Log", name, "read", 1)
	return _envelope({"name": name, "read": True})


@frappe.whitelist()
def mark_all_read() -> dict:
	_require_login()
	unread = frappe.get_all(
		"Notification Log",
		filters={"for_user": frappe.session.user, "read": 0},
		pluck="name",
	)
	for n in unread:
		frappe.db.set_value("Notification Log", n, "read", 1)
	return _envelope({"cleared": len(unread)})
