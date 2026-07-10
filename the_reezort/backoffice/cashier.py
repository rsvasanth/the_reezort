"""Cashier Close — shift reconciliation (spec 008).

A cashier opens a shift, the system aggregates the payments actually collected
during the window (from submitted ERPNext Payment Entries), the cashier declares
what they physically counted per payment mode, and the system computes the
variance. Variance above the threshold needs a reason and manager approval;
self-approval is blocked.

Flow: open_cashier_close → get_cashier_close (live expected) → submit_cashier_close
→ approve_cashier_close.
"""

import frappe
from frappe import _
from frappe.utils import flt, now_datetime

CLOSE_TYPES = {"Front Desk", "F&B", "Event", "Night Audit", "Other"}
DEFAULT_VARIANCE_THRESHOLD = 100.0
CASHIER_MANAGER_ROLES = {"Accounts Manager", "Resort Manager", "System Manager"}


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


def _default_company():
	return frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
		"Company", {}, "name"
	)


def _variance_threshold(company):
	"""Cash variance approval threshold. Reads a config override if present,
	else a sane default. (The Back Office Settings doctype can supply this later.)"""
	return flt(frappe.conf.get("cashier_variance_threshold") or DEFAULT_VARIANCE_THRESHOLD)


def _is_cashier_manager():
	return bool(CASHIER_MANAGER_ROLES.intersection(frappe.get_roles(frappe.session.user)))


def _collected_by_mode(company, opening_time, closing_time):
	"""Sum submitted Payment Entries received in the window, grouped by mode.

	This is the money the system believes was collected during the shift — the
	'expected' side of the reconciliation.
	"""
	rows = frappe.get_all(
		"Payment Entry",
		filters={
			"company": company,
			"payment_type": "Receive",
			"docstatus": 1,
			"creation": ["between", [opening_time, closing_time]],
		},
		fields=["mode_of_payment", "paid_amount"],
	)
	totals = {}
	for row in rows:
		mode = row.mode_of_payment or "Unknown"
		totals[mode] = flt(totals.get(mode, 0)) + flt(row.paid_amount)
	return totals


def _seed_payment_rows(doc, totals):
	"""Replace the payment rows with the given expected totals (declared cleared)."""
	doc.set("payments", [])
	for mode, expected in sorted(totals.items()):
		doc.append("payments", {"payment_mode": mode, "expected_amount": flt(expected)})
	if not totals:
		# Always give the cashier at least a Cash line to declare against.
		doc.append("payments", {"payment_mode": "Cash", "expected_amount": 0})


@frappe.whitelist()
def get_cashier_close_context(close_type, opening_time=None, closing_time=None, company=None):
	"""Preview the expected payment totals for a prospective shift window, before
	a Cashier Close is created. Drives the 'open shift' screen."""
	_require_permission("Cashier Close", "read")
	if close_type not in CLOSE_TYPES:
		frappe.throw(_("Unknown close type: {0}").format(close_type))
	company = company or _default_company()
	opening_time = opening_time or now_datetime()
	closing_time = closing_time or now_datetime()
	totals = _collected_by_mode(company, opening_time, closing_time)
	return _envelope(
		{
			"company": company,
			"close_type": close_type,
			"expected_by_mode": totals,
			"expected_total": flt(sum(totals.values())),
			"variance_threshold": _variance_threshold(company),
		}
	)


@frappe.whitelist()
def open_cashier_close(close_type, cash_float=0, outlet=None, company=None, shift_reference=None, cashier_user=None):
	"""Open a cashier shift. Records the opening time (start of the reconciliation
	window) and the cash float. Expected totals accrue until the shift is closed."""
	_require_permission("Cashier Close", "create")
	if close_type not in CLOSE_TYPES:
		frappe.throw(_("Unknown close type: {0}").format(close_type))

	company = company or _default_company()
	doc = frappe.get_doc(
		{
			"doctype": "Cashier Close",
			"company": company,
			"close_type": close_type,
			"outlet": outlet,
			"cashier_user": cashier_user or frappe.session.user,
			"shift_reference": shift_reference,
			"opening_time": now_datetime(),
			"cash_float": flt(cash_float),
			"close_status": "Open",
		}
	)
	# Seed rows with whatever has been collected already (usually nothing at open).
	_seed_payment_rows(doc, _collected_by_mode(company, doc.opening_time, now_datetime()))
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _envelope(_close_dict(doc))


@frappe.whitelist()
def get_cashier_close(cashier_close):
	"""Fetch a Cashier Close. While it is Open, the expected totals are refreshed
	live so the cashier sees current collections before declaring."""
	_require_permission("Cashier Close", "read")
	doc = frappe.get_doc("Cashier Close", cashier_close)
	if doc.close_status in ("Open", "Closing"):
		totals = _collected_by_mode(doc.company, doc.opening_time, now_datetime())
		declared = {row.payment_mode: row.declared_amount for row in doc.payments}
		_seed_payment_rows(doc, totals)
		# Preserve any declared amounts the cashier already typed.
		for row in doc.payments:
			if declared.get(row.payment_mode) not in (None, ""):
				row.declared_amount = declared[row.payment_mode]
		doc.save(ignore_permissions=True)
		frappe.db.commit()
	return _envelope(_close_dict(doc))


@frappe.whitelist()
def submit_cashier_close(cashier_close, declaration):
	"""Declare counted amounts per payment mode and close the shift.

	`declaration` = {payments: [{payment_mode, declared_amount}], variance_reason}.
	Recomputes expected from the window, sets declared, computes variance. A
	non-zero variance needs a reason; variance beyond the threshold needs manager
	approval (status Submitted); otherwise the close is Approved outright.
	"""
	_require_permission("Cashier Close", "write")
	if isinstance(declaration, str):
		declaration = frappe.parse_json(declaration)
	declaration = declaration or {}

	doc = frappe.get_doc("Cashier Close", cashier_close)
	if doc.close_status not in ("Open", "Closing", "Reopened"):
		frappe.throw(_("Cashier Close {0} is {1} and cannot be submitted.").format(doc.name, doc.close_status))

	closing_time = now_datetime()
	totals = _collected_by_mode(doc.company, doc.opening_time, closing_time)
	declared_map = {
		d.get("payment_mode"): flt(d.get("declared_amount")) for d in (declaration.get("payments") or [])
	}
	# Rebuild rows from the union of expected modes and declared modes.
	modes = sorted(set(totals) | set(declared_map) or {"Cash"})
	doc.set("payments", [])
	for mode in modes:
		doc.append(
			"payments",
			{
				"payment_mode": mode,
				"expected_amount": flt(totals.get(mode, 0)),
				"declared_amount": flt(declared_map.get(mode, 0)),
			},
		)

	doc.closing_time = closing_time
	doc.roll_up_totals()
	variance = flt(doc.variance_amount)
	reason = (declaration.get("variance_reason") or "").strip()

	if abs(variance) > 0.009 and not reason:
		frappe.throw(_("A variance of {0} requires a reason.").format(variance))
	doc.variance_reason = reason

	threshold = _variance_threshold(doc.company)
	if abs(variance) > threshold:
		# Above threshold — needs manager approval before it's final.
		doc.close_status = "Submitted"
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		from the_reezort.audit.api import record_audit_event

		record_audit_event("Cashier Close", doc.name, "cashier_close.submit_pending_approval", reason,
			{"variance": variance, "threshold": threshold})
		return _envelope(
			_close_dict(doc),
			blockers=[_("Variance {0} exceeds the {1} threshold — manager approval required.").format(variance, threshold)],
			next_actions=["approve_cashier_close"],
		)

	# Within threshold — close it out.
	doc.close_status = "Approved"
	doc.approved_by = frappe.session.user
	doc.approved_at = closing_time
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	from the_reezort.audit.api import record_audit_event

	record_audit_event("Cashier Close", doc.name, "cashier_close.approved_auto", reason, {"variance": variance})
	return _envelope(_close_dict(doc))


@frappe.whitelist()
def approve_cashier_close(cashier_close, decision, note=None):
	"""Manager decision on an over-threshold Cashier Close. Blocks self-approval."""
	_require_permission("Cashier Close", "write")
	if not _is_cashier_manager():
		frappe.throw(_("Only a manager can decide a cashier close."), frappe.PermissionError)
	if decision not in ("Approve", "Reject"):
		frappe.throw(_("decision must be 'Approve' or 'Reject'."))

	doc = frappe.get_doc("Cashier Close", cashier_close)
	if doc.close_status != "Submitted":
		frappe.throw(_("Only a Submitted cashier close can be decided (current: {0}).").format(doc.close_status))
	if doc.cashier_user == frappe.session.user:
		frappe.throw(_("You cannot approve your own cashier close."), frappe.PermissionError)

	doc.close_status = "Approved" if decision == "Approve" else "Rejected"
	doc.approved_by = frappe.session.user
	doc.approved_at = now_datetime()
	if note:
		doc.variance_reason = "\n".join(filter(None, [doc.variance_reason, f"Manager: {note}"]))
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	from the_reezort.audit.api import record_audit_event

	record_audit_event("Cashier Close", doc.name, f"cashier_close.{decision.lower()}", note or "",
		{"variance": flt(doc.variance_amount)})
	return _envelope(_close_dict(doc))


@frappe.whitelist()
def list_cashier_closes(company=None, close_status=None, limit=50):
	_require_permission("Cashier Close", "read")
	filters = {}
	if company:
		filters["company"] = company
	if close_status:
		filters["close_status"] = close_status
	rows = frappe.get_all(
		"Cashier Close",
		filters=filters,
		fields=[
			"name", "close_type", "cashier_user", "opening_time", "closing_time",
			"expected_total", "declared_total", "variance_amount", "close_status",
		],
		order_by="creation desc",
		limit_page_length=int(limit),
	)
	return _envelope({"closes": rows})


def _close_dict(doc):
	return {
		"name": doc.name,
		"company": doc.company,
		"close_type": doc.close_type,
		"outlet": doc.outlet,
		"cashier_user": doc.cashier_user,
		"shift_reference": doc.shift_reference,
		"opening_time": str(doc.opening_time) if doc.opening_time else None,
		"closing_time": str(doc.closing_time) if doc.closing_time else None,
		"cash_float": flt(doc.cash_float),
		"expected_total": flt(doc.expected_total),
		"declared_total": flt(doc.declared_total),
		"variance_amount": flt(doc.variance_amount),
		"variance_reason": doc.variance_reason,
		"close_status": doc.close_status,
		"approved_by": doc.approved_by,
		"variance_threshold": _variance_threshold(doc.company),
		"payments": [
			{
				"payment_mode": row.payment_mode,
				"expected_amount": flt(row.expected_amount),
				"declared_amount": flt(row.declared_amount),
				"variance": flt(row.variance),
			}
			for row in doc.payments
		],
	}
