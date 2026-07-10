"""Audit Event write + query.

Any endpoint that gates an action (correction, override, approval, room-move
OOO, KYC override, rate override, discount, void, transfer, refund, credit
note) SHOULD call `record_audit_event()` on success. Failures to record must
never break the caller — audit is best-effort.
"""

import frappe
from frappe import _
from frappe.utils import add_days, now, today

from the_reezort.utils import envelope as _envelope


def record_audit_event(
	source_doctype: str,
	source_name: str,
	action: str,
	reason: str = "",
	details: dict | None = None,
	actor: str | None = None,
):
	"""Best-effort append to the audit log. Swallows exceptions."""
	try:
		event = frappe.get_doc(
			{
				"doctype": "Audit Event",
				"at": now(),
				"actor": actor or frappe.session.user,
				"action": action,
				"source_doctype": source_doctype,
				"source_name": source_name,
				"reason": reason,
				"details": frappe.as_json(details or {}),
			}
		).insert(ignore_permissions=True)
		return event.name
	except Exception:
		frappe.log_error(title="Audit Event insert failed", message=frappe.get_traceback())
		return None


def _require_read():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)
	if not frappe.has_permission("Audit Event", "read"):
		frappe.throw(_("You do not have permission to view audit events."), frappe.PermissionError)


@frappe.whitelist()
def list_audit_events(action=None, actor=None, source_doctype=None, days=14, limit=500):
	"""Filterable audit list. Filters combine; days defaults to 14."""
	_require_read()
	filters = {"at": [">=", add_days(today(), -int(days))]}
	if action:
		filters["action"] = ["in", [a.strip() for a in str(action).split(",") if a.strip()]]
	if actor:
		filters["actor"] = actor
	if source_doctype:
		filters["source_doctype"] = source_doctype

	rows = frappe.get_all(
		"Audit Event",
		filters=filters,
		fields=["name", "at", "actor", "action", "source_doctype", "source_name", "reason", "details"],
		order_by="at desc",
		limit=int(limit),
	)
	for r in rows:
		# Pre-parse the JSON so the SPA doesn't have to.
		try:
			r["details_parsed"] = frappe.parse_json(r.get("details") or "{}")
		except Exception:
			r["details_parsed"] = {}
		r["actor_name"] = frappe.db.get_value("User", r.actor, "full_name") if r.actor else None
	return _envelope({"events": rows})


@frappe.whitelist()
def list_actions():
	"""Distinct action names in the last 90 days — drives the filter dropdown."""
	_require_read()
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT action FROM `tabAudit Event`
		WHERE at >= %(cutoff)s ORDER BY action ASC
		""",
		{"cutoff": add_days(today(), -90)},
		as_dict=True,
	)
	return _envelope({"actions": [r.action for r in rows]})
