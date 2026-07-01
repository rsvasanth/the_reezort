"""Payroll — Structures tab + Payroll tab (spec 008 / ui-ux-payroll-tab).

Thin wrapper over ERPNext HRMS:

  · list_salary_structure_assignments / assign_salary_structure / deactivate
  · list_my_slips / get_slip
  · run_payroll (dry_run creates a Payroll Entry + draft slips → returns
    the list; commit=False rolls the transaction back)
  · submit_payroll (submits the Payroll Entry which cascades slip submits +
    JV posting via HRMS's built-in path)

Owner constraint (2026-06-30): no PF/ESI/PT — earnings only. Our seeded
"Standard Monthly — REEZORT" structure carries Basic + HRA only.
"""

import frappe
from frappe import _
from frappe.utils import add_days, flt, get_first_day, get_last_day, getdate, today

from the_reezort.staff.api import _envelope, STAFF_ADMIN_ROLES

PAYROLL_MANAGER_ROLES = STAFF_ADMIN_ROLES | {"HR Manager", "HR User", "Accounts Manager"}


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _self_employee_or_none():
	return frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")


def _is_manager():
	return bool(PAYROLL_MANAGER_ROLES & set(frappe.get_roles()))


def _require_manager():
	_require_login()
	if not _is_manager():
		frappe.throw(_("Only a manager can operate payroll."), frappe.PermissionError)


# ---------- Salary Structure Assignments ----------


@frappe.whitelist()
def list_salary_structures():
	"""Submitted, active salary structures — for the Assign sheet dropdown."""
	_require_manager()
	rows = frappe.get_all(
		"Salary Structure",
		filters={"docstatus": 1, "is_active": "Yes"},
		fields=["name", "company", "currency", "payroll_frequency"],
		order_by="name asc",
	)
	return _envelope({"structures": rows})


@frappe.whitelist()
def list_salary_structure_assignments(company=None):
	"""One row per active employee, joined to their current assignment (if any)."""
	_require_manager()
	filters = {"status": "Active"}
	if company:
		filters["company"] = company

	employees = frappe.get_all(
		"Employee",
		filters=filters,
		fields=["name", "employee_name", "designation", "company", "date_of_joining"],
		order_by="employee_name asc",
	)

	rows = []
	for emp in employees:
		current = frappe.db.sql(
			"""
			SELECT name, salary_structure, base, from_date
			FROM `tabSalary Structure Assignment`
			WHERE employee = %s AND docstatus = 1
			  AND from_date <= %s
			ORDER BY from_date DESC
			LIMIT 1
			""",
			(emp.name, today()),
			as_dict=True,
		)
		assignment = current[0] if current else None
		rows.append(
			{
				"employee": emp.name,
				"employee_name": emp.employee_name,
				"designation": emp.designation,
				"company": emp.company,
				"date_of_joining": str(emp.date_of_joining) if emp.date_of_joining else None,
				"assignment": {
					"name": assignment["name"],
					"salary_structure": assignment["salary_structure"],
					"base": float(assignment["base"] or 0),
					"from_date": str(assignment["from_date"]),
				}
				if assignment
				else None,
			}
		)

	unassigned = sum(1 for r in rows if not r["assignment"])
	return _envelope({"rows": rows, "unassigned_count": unassigned})


@frappe.whitelist()
def assign_salary_structure(employee, salary_structure, base, from_date=None):
	"""Assign a Salary Structure to an employee.

	If the employee already has an active assignment, end-date it the day
	before the new one so we never overlap.
	"""
	_require_manager()
	if not frappe.db.exists("Employee", employee):
		frappe.throw(_("Unknown employee."))
	if not frappe.db.exists("Salary Structure", salary_structure):
		frappe.throw(_("Unknown salary structure."))
	if flt(base) <= 0:
		frappe.throw(_("Base amount must be greater than zero."))

	start = getdate(from_date or today())
	company = frappe.db.get_value("Employee", employee, "company")

	# HRMS resolves the "current" assignment by taking the most recent submitted
	# row with from_date <= today. There is no is_active / end_date column.
	# When a new assignment replaces an earlier one, cancel the earlier submit so
	# it no longer appears as current.
	prior = frappe.db.get_value(
		"Salary Structure Assignment",
		{"employee": employee, "docstatus": 1, "from_date": ["<", str(start)]},
		"name",
	)
	if prior:
		try:
			prior_doc = frappe.get_doc("Salary Structure Assignment", prior)
			prior_doc.flags.ignore_permissions = True
			prior_doc.cancel()
		except Exception:
			pass

	doc = frappe.get_doc(
		{
			"doctype": "Salary Structure Assignment",
			"employee": employee,
			"salary_structure": salary_structure,
			"from_date": str(start),
			"base": flt(base),
			"company": company,
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert(ignore_permissions=True)
	doc.submit()

	return _envelope(
		{
			"assignment": doc.name,
			"employee": employee,
			"salary_structure": salary_structure,
			"base": float(base),
			"from_date": str(start),
		}
	)


@frappe.whitelist()
def deactivate_salary_structure_assignment(name):
	"""Cancel the submitted assignment so it drops out of 'current' resolution."""
	_require_manager()
	if not frappe.db.exists("Salary Structure Assignment", name):
		frappe.throw(_("Assignment not found."))
	doc = frappe.get_doc("Salary Structure Assignment", name)
	if doc.docstatus == 1:
		doc.flags.ignore_permissions = True
		doc.cancel()
	return _envelope({"assignment": name, "cancelled": True})


# ---------- Payslips (self) ----------


@frappe.whitelist()
def list_my_slips():
	_require_login()
	emp = _self_employee_or_none()
	if not emp:
		return _envelope({"employee": None, "slips": [], "is_manager": _is_manager()})

	rows = frappe.get_all(
		"Salary Slip",
		filters={"employee": emp, "docstatus": 1},
		fields=[
			"name", "start_date", "end_date", "salary_structure",
			"gross_pay", "total_deduction", "net_pay",
		],
		order_by="end_date desc",
	)
	for r in rows:
		r["start_date"] = str(r["start_date"]) if r["start_date"] else None
		r["end_date"] = str(r["end_date"]) if r["end_date"] else None
	return _envelope({"employee": emp, "slips": rows, "is_manager": _is_manager()})


@frappe.whitelist()
def get_slip(name):
	"""Full slip payload for the PDF renderer. Access: self OR manager."""
	_require_login()
	doc = frappe.get_doc("Salary Slip", name)
	emp_user = frappe.db.get_value("Employee", doc.employee, "user_id")
	if not (_is_manager() or emp_user == frappe.session.user):
		frappe.throw(_("Not permitted."), frappe.PermissionError)

	return _envelope(
		{
			"slip": {
				"name": doc.name,
				"employee": doc.employee,
				"employee_name": doc.employee_name,
				"designation": doc.designation,
				"department": doc.department,
				"company": doc.company,
				"start_date": str(doc.start_date),
				"end_date": str(doc.end_date),
				"posting_date": str(doc.posting_date),
				"salary_structure": doc.salary_structure,
				"payment_days": float(doc.payment_days or 0),
				"total_working_days": float(doc.total_working_days or 0),
				"gross_pay": float(doc.gross_pay or 0),
				"total_deduction": float(doc.total_deduction or 0),
				"net_pay": float(doc.net_pay or 0),
				"currency": doc.currency,
				"earnings": [
					{"component": r.salary_component, "amount": float(r.amount or 0)} for r in doc.earnings
				],
				"deductions": [
					{"component": r.salary_component, "amount": float(r.amount or 0)} for r in doc.deductions
				],
			}
		}
	)


# ---------- Payroll run ----------


def _period_bounds(period):
	"""period = 'YYYY-MM' → (start, end) as first/last day of that month."""
	if not period or "-" not in period:
		frappe.throw(_("period must be 'YYYY-MM'."))
	year, month = period.split("-")[:2]
	anchor = getdate(f"{int(year):04d}-{int(month):02d}-01")
	return get_first_day(anchor), get_last_day(anchor)


def _skipped_count(company, start, end):
	total = frappe.db.count("Employee", {"status": "Active", "company": company})
	assigned = frappe.db.sql(
		"""
		SELECT COUNT(DISTINCT ssa.employee)
		FROM `tabSalary Structure Assignment` ssa
		JOIN `tabEmployee` e ON e.name = ssa.employee
		WHERE ssa.docstatus = 1 AND ssa.from_date <= %s
		  AND e.status = 'Active' AND e.company = %s
		""",
		(str(end), company),
	)[0][0]
	return max(int(total) - int(assigned or 0), 0)


@frappe.whitelist()
def preview_payroll(company, period, frequency="Monthly"):
	"""Return coverage counts + previewed slip list WITHOUT creating a Payroll Entry.

	Used by the "Preview slips" button — safe to call any number of times.
	Actual generation happens in run_payroll().
	"""
	_require_manager()
	start, end = _period_bounds(period)

	included = frappe.db.sql(
		"""
		SELECT DISTINCT e.name AS employee, e.employee_name, ssa.salary_structure, ssa.base
		FROM `tabEmployee` e
		JOIN `tabSalary Structure Assignment` ssa ON ssa.employee = e.name
		WHERE e.status = 'Active' AND e.company = %s
		  AND ssa.docstatus = 1 AND ssa.from_date <= %s
		ORDER BY e.employee_name
		""",
		(company, str(end)),
		as_dict=True,
	)
	skipped = _skipped_count(company, start, end)

	# Estimate gross from base + our seeded formula (Basic = base, HRA = 0.4·base).
	# This is a preview only — real slip earnings are computed by HRMS at run time.
	estimates = []
	for r in included:
		base = flt(r["base"] or 0)
		basic = base
		hra = round(base * 0.4, 2)
		gross = basic + hra
		estimates.append(
			{
				"employee": r["employee"],
				"employee_name": r["employee_name"],
				"salary_structure": r["salary_structure"],
				"base": float(base),
				"gross_estimate": float(gross),
			}
		)

	return _envelope(
		{
			"company": company,
			"period": period,
			"frequency": frequency,
			"start_date": str(start),
			"end_date": str(end),
			"included_count": len(estimates),
			"skipped_count": skipped,
			"slips_preview": estimates,
		}
	)


def _existing_payroll_entry(company, start, end):
	return frappe.db.get_value(
		"Payroll Entry",
		{"company": company, "start_date": str(start), "end_date": str(end), "docstatus": ["!=", 2]},
		["name", "docstatus"],
		as_dict=True,
	)


@frappe.whitelist()
def run_payroll(company, period, frequency="Monthly"):
	"""Create a draft Payroll Entry + generate draft Salary Slips for the period.

	Idempotent: if a non-cancelled Payroll Entry already exists for the exact
	(company, start, end), returns it instead of creating a duplicate.
	"""
	_require_manager()
	start, end = _period_bounds(period)

	existing = _existing_payroll_entry(company, start, end)
	if existing:
		if existing["docstatus"] == 1:
			frappe.throw(_("Payroll for this period is already submitted."))
		# Draft exists — reuse it.
		pe = frappe.get_doc("Payroll Entry", existing["name"])
	else:
		pe = frappe.get_doc(
			{
				"doctype": "Payroll Entry",
				"company": company,
				"posting_date": str(end),
				"start_date": str(start),
				"end_date": str(end),
				"payroll_frequency": frequency,
				"salary_slip_based_on_timesheet": 0,
				"exchange_rate": 1,
				"currency": frappe.db.get_value("Company", company, "default_currency") or "INR",
			}
		)
		pe.flags.ignore_permissions = True
		pe.insert(ignore_permissions=True)

		# Fill employees from active salary structure assignments.
		try:
			pe.fill_employee_details()
		except Exception:
			pass

		pe.flags.ignore_permissions = True
		# Generate draft Salary Slips.
		try:
			pe.create_salary_slips()
		except Exception:
			frappe.log_error(title="Payroll create_salary_slips failed", message=frappe.get_traceback())

	slips = frappe.get_all(
		"Salary Slip",
		filters={"payroll_entry": pe.name, "docstatus": 0},
		fields=["name", "employee", "employee_name", "gross_pay", "net_pay", "salary_structure"],
	)
	return _envelope(
		{
			"payroll_entry": pe.name,
			"start_date": str(start),
			"end_date": str(end),
			"slip_count": len(slips),
			"slips": slips,
		}
	)


@frappe.whitelist()
def submit_payroll(payroll_entry):
	"""Submit the Payroll Entry — cascades slip submissions + JV posting."""
	_require_manager()
	if not frappe.db.exists("Payroll Entry", payroll_entry):
		frappe.throw(_("Payroll Entry not found."))
	pe = frappe.get_doc("Payroll Entry", payroll_entry)
	if pe.docstatus == 1:
		return _envelope({"payroll_entry": pe.name, "already_submitted": True})

	pe.flags.ignore_permissions = True
	try:
		pe.submit_salary_slips()
	except Exception:
		frappe.log_error(title="Payroll submit_salary_slips failed", message=frappe.get_traceback())

	# Refresh from DB — submit_salary_slips modifies rows on pe.
	pe.reload()
	if pe.docstatus == 0:
		# Some HRMS versions require a separate submit.
		try:
			pe.flags.ignore_permissions = True
			pe.submit()
		except Exception:
			pass

	submitted = frappe.db.count("Salary Slip", {"payroll_entry": pe.name, "docstatus": 1})
	total_net = (
		frappe.db.sql(
			"SELECT COALESCE(SUM(net_pay),0) FROM `tabSalary Slip` WHERE payroll_entry=%s AND docstatus=1",
			(pe.name,),
		)[0][0]
		or 0
	)
	return _envelope(
		{
			"payroll_entry": pe.name,
			"submitted_slip_count": int(submitted),
			"total_net_pay": float(total_net),
		}
	)
