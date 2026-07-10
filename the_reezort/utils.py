"""Shared helpers for the_reezort's whitelisted API layer.

Consolidates the API envelope shape, JSON-arg coercion, and generic
doctype-permission gate that used to be copy-pasted independently into
every module (11 copies of _envelope, 11 of _require_permission, 10 of
_as_dict, 9 of _as_list — 2026-07-10 audit). One definition each; every
module imports and locally aliases so call sites (`_envelope(...)`,
`_require_permission(...)`, etc.) are unchanged.
"""

import json

import frappe
from frappe import _


def envelope(data, warnings=None, blockers=None, next_actions=None):
	return {
		"ok": True,
		"data": data,
		"warnings": warnings or [],
		"blockers": blockers or [],
		"next_actions": next_actions or [],
	}


def as_dict(value):
	if isinstance(value, str):
		return json.loads(value) if value else {}
	return value or {}


def as_list(value):
	if isinstance(value, str):
		return json.loads(value) if value else []
	return value or []


def require_permission(doctype, permission_type="read"):
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)

	if not frappe.has_permission(doctype, permission_type):
		frappe.throw(
			_("You do not have {0} permission for {1}.").format(permission_type, doctype),
			frappe.PermissionError,
		)
