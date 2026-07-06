"""Shared authorization guards for whitelisted endpoints.

`system_manager_only` gates the seed/reset/bootstrap endpoints — administrative
operations that create master data, wipe operational/financial records, or set
passwords. They must never be reachable by an ordinary operational login.
"""

import functools

import frappe
from frappe import _


def system_manager_only(fn):
	"""Reject any caller that is not a System Manager (or Administrator).

	Stack directly under ``@frappe.whitelist()`` so the guard runs before the
	endpoint body. Administrator always passes; every other user must hold the
	System Manager role or a ``PermissionError`` (HTTP 403) is raised.
	"""

	@functools.wraps(fn)
	def wrapper(*args, **kwargs):
		if frappe.session.user != "Administrator":
			frappe.only_for("System Manager")
		return fn(*args, **kwargs)

	return wrapper
