"""Attendance & Roster — SPA front end over hrms (Employee Checkin + Attendance + Shift).

Clock in/out (Employee Checkin), a daily attendance board, and manager marking
of Present/Absent etc. (Attendance, submitted). Shift Assignment is surfaced
read-only as the roster column.
"""

import frappe
from frappe import _
from frappe.utils import getdate, now_datetime, today

from the_reezort.staff.api import _as_dict, _envelope, _require_staff_admin

ATTENDANCE_STATUSES = ["Present", "Absent", "On Leave", "Half Day", "Work From Home"]


def _self_employee():
	emp = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")
	if not emp:
		frappe.throw(_("Your login is not linked to an employee record."))
	return emp


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _last_checkin(employee, date):
	rows = frappe.get_all(
		"Employee Checkin",
		filters={"employee": employee, "time": ["between", [f"{date} 00:00:00", f"{date} 23:59:59"]]},
		fields=["log_type", "time"],
		# Tiebreak by creation: two checkins can share the same second (Datetime is
		# second-precision), so the latest insert must win.
		order_by="time desc, creation desc",
		limit=1,
	)
	return rows[0] if rows else None


def _shift_for(employee, date):
	rows = frappe.get_all(
		"Shift Assignment",
		filters={
			"employee": employee,
			"docstatus": 1,
			"start_date": ["<=", date],
		},
		or_filters=[["end_date", ">=", date], ["end_date", "is", "not set"]],
		fields=["shift_type"],
		limit=1,
	)
	return rows[0].shift_type if rows else None


# ---------- board ----------

@frappe.whitelist()
def get_attendance_board(date=None):
	_require_staff_admin()
	date = getdate(date) if date else getdate(today())
	date_str = str(date)

	employees = frappe.get_all(
		"Employee",
		filters={"status": "Active"},
		fields=["name", "employee_name", "designation", "image", "user_id", "company"],
		order_by="employee_name asc",
	)
	board = []
	for emp in employees:
		checkin = _last_checkin(emp.name, date_str)
		status = frappe.db.get_value(
			"Attendance",
			{"employee": emp.name, "attendance_date": date_str, "docstatus": 1},
			"status",
		)
		board.append(
			{
				"employee": emp.name,
				"employee_name": emp.employee_name,
				"designation": emp.designation,
				"image": emp.image,
				"user": emp.user_id,
				"clocked": checkin.log_type if checkin else None,
				"last_time": str(checkin.time) if checkin else None,
				"attendance_status": status,
				"shift": _shift_for(emp.name, date_str),
			}
		)
	return _envelope({"date": date_str, "board": board, "statuses": ATTENDANCE_STATUSES})


# ---------- self-service "my day" widget ----------

@frappe.whitelist()
def get_my_day(date=None):
	"""Today's attendance state for the logged-in user, for the clock widget.

	Returns whether the user has an Employee record (some accounts are SPA-only
	with no payroll link), their last IN/OUT checkin today, and a count of
	open Housekeeping Tasks assigned to them — drives the per-role landing card.
	"""
	_require_login()
	emp = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, ["name", "employee_name", "designation"], as_dict=True)
	date_str = str(getdate(date) if date else getdate(today()))

	checkin = _last_checkin(emp.name, date_str) if emp else None
	open_tasks = frappe.db.count(
		"Housekeeping Task",
		{
			"assigned_user": frappe.session.user,
			"task_status": ["in", ["Queued", "Assigned", "In Progress", "Paused"]],
		},
	)
	return _envelope(
		{
			"user": frappe.session.user,
			"employee": emp.name if emp else None,
			"employee_name": emp.employee_name if emp else None,
			"designation": emp.designation if emp else None,
			"date": date_str,
			"clocked": checkin.log_type if checkin else None,
			"last_time": str(checkin.time) if checkin else None,
			"open_tasks": open_tasks,
		}
	)


# ---------- clock in / out (self-service; managers for others) ----------

def _record_checkin(employee, log_type):
	_require_login()
	if log_type not in ("IN", "OUT"):
		frappe.throw(_("log_type must be IN or OUT."))
	target = employee or _self_employee()
	if employee and employee != frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name"):
		# Clocking someone else requires manager rights.
		_require_staff_admin()
	doc = frappe.get_doc(
		{
			"doctype": "Employee Checkin",
			"employee": target,
			"log_type": log_type,
			"time": now_datetime(),
		}
	)
	doc.insert(ignore_permissions=True)
	return _envelope({"checkin": doc.name, "employee": target, "log_type": log_type, "time": str(doc.time)})


@frappe.whitelist()
def clock_in(employee=None):
	return _record_checkin(employee, "IN")


@frappe.whitelist()
def clock_out(employee=None):
	return _record_checkin(employee, "OUT")


# ---------- mark attendance (manager) ----------

@frappe.whitelist()
def mark_attendance(employee, status, date=None):
	_require_staff_admin()
	if status not in ATTENDANCE_STATUSES:
		frappe.throw(_("Invalid attendance status."))
	if not frappe.db.exists("Employee", employee):
		frappe.throw(_("Unknown employee."))
	date = str(getdate(date) if date else getdate(today()))

	existing = frappe.db.get_value(
		"Attendance",
		{"employee": employee, "attendance_date": date, "docstatus": ["!=", 2]},
		["name", "status", "docstatus"],
		as_dict=True,
	)
	if existing:
		if existing.status == status:
			return _envelope({"attendance": existing.name, "status": status, "reused": True})
		# Replace: cancel a submitted record, then create the corrected one.
		doc = frappe.get_doc("Attendance", existing.name)
		if existing.docstatus == 1:
			doc.cancel()
		else:
			doc.delete(ignore_permissions=True)

	company = frappe.db.get_value("Employee", employee, "company")
	doc = frappe.get_doc(
		{
			"doctype": "Attendance",
			"employee": employee,
			"attendance_date": date,
			"status": status,
			"company": company,
		}
	)
	doc.insert(ignore_permissions=True)
	doc.submit()
	return _envelope({"attendance": doc.name, "status": status, "reused": False})
