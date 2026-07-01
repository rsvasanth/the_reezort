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
	result = _record_checkin(employee, "OUT")
	# Auto-compute attendance from paired IN/OUT — best-effort, never blocks clock-out.
	try:
		target = employee or _self_employee()
		mark_attendance_from_checkins(employee=target)
	except Exception:
		frappe.log_error(title="Auto-mark attendance failed", message=frappe.get_traceback())
	return result


@frappe.whitelist()
def get_my_shift(date=None):
	"""Shift Assignment (if any) for the current user on the given date."""
	_require_login()
	emp = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, ["name", "employee_name"], as_dict=True)
	if not emp:
		return _envelope({"employee": None, "shift": None, "shift_type": None})

	date_str = str(getdate(date) if date else getdate(today()))
	shift = _shift_for(emp.name, date_str)
	if not shift:
		return _envelope({"employee": emp.name, "shift": None, "shift_type": None})

	shift_row = frappe.db.get_value(
		"Shift Type", shift, ["name", "start_time", "end_time"], as_dict=True
	)
	return _envelope({"employee": emp.name, "shift": shift, "shift_type": shift_row})


# ---------- pair IN + OUT → Attendance with hours + overtime ----------


def _time_seconds(t):
	"""Frappe Datetime → seconds since midnight. Handles Time objects too."""
	from datetime import datetime, time as time_cls, timedelta

	if isinstance(t, timedelta):
		return int(t.total_seconds())
	if isinstance(t, time_cls):
		return t.hour * 3600 + t.minute * 60 + t.second
	if isinstance(t, datetime):
		return t.hour * 3600 + t.minute * 60 + t.second
	# String fallback "HH:MM:SS"
	if isinstance(t, str):
		parts = t.split(":")
		return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2]) if len(parts) >= 3 else 0
	return 0


def _shift_duration_hours(shift_type_name):
	"""Standard shift length in hours from a Shift Type doc.

	Handles cross-midnight shifts (Night = 22:00 → 07:00 = 9h).
	Defaults to 8 when the doc is missing or invalid.
	"""
	if not shift_type_name:
		return 8.0
	shift = frappe.db.get_value("Shift Type", shift_type_name, ["start_time", "end_time"], as_dict=True)
	if not shift:
		return 8.0
	s = _time_seconds(shift.start_time)
	e = _time_seconds(shift.end_time)
	if e <= s:
		e += 24 * 3600
	return round((e - s) / 3600.0, 2)


def _paired_checkins(employee, date):
	rows = frappe.get_all(
		"Employee Checkin",
		filters={
			"employee": employee,
			"time": ["between", [f"{date} 00:00:00", f"{date} 23:59:59"]],
		},
		fields=["log_type", "time"],
		order_by="time asc",
	)
	first_in = next((r for r in rows if r.log_type == "IN"), None)
	last_out = next((r for r in reversed(rows) if r.log_type == "OUT"), None)
	return first_in, last_out


@frappe.whitelist()
def mark_attendance_from_checkins(employee=None, date=None):
	"""Pair first IN + last OUT for the day, compute working_hours + overtime,
	insert or update the Attendance doc.

	Status:
	  · working_hours < 4  → Half Day
	  · otherwise           → Present

	Overtime = max(0, working_hours − shift_duration). Zero if no shift assigned.
	Best-effort: returns None (not throw) when the day has no IN or no OUT yet.
	"""
	_require_login()
	target = employee or _self_employee()
	date_str = str(getdate(date) if date else getdate(today()))

	first_in, last_out = _paired_checkins(target, date_str)
	if not first_in or not last_out:
		return _envelope({"attendance": None, "reason": "IN/OUT pair not complete yet"})

	from datetime import datetime as _dt

	in_dt = first_in.time if isinstance(first_in.time, _dt) else _dt.fromisoformat(str(first_in.time))
	out_dt = last_out.time if isinstance(last_out.time, _dt) else _dt.fromisoformat(str(last_out.time))
	worked_hours = round((out_dt - in_dt).total_seconds() / 3600.0, 2)
	if worked_hours < 0:
		worked_hours = 0

	shift = _shift_for(target, date_str)
	standard_hours = _shift_duration_hours(shift)
	overtime = round(max(0.0, worked_hours - standard_hours), 2)

	status = "Half Day" if worked_hours < 4 else "Present"

	# Upsert. Attendance is submittable — if a submitted row exists for today,
	# cancel it before rewriting (mirrors mark_attendance's pattern).
	existing = frappe.db.get_value(
		"Attendance",
		{"employee": target, "attendance_date": date_str, "docstatus": ["!=", 2]},
		["name", "docstatus"],
		as_dict=True,
	)
	if existing:
		if existing.docstatus == 1:
			doc = frappe.get_doc("Attendance", existing.name)
			doc.cancel()
		else:
			frappe.delete_doc("Attendance", existing.name, ignore_permissions=True)

	doc = frappe.get_doc(
		{
			"doctype": "Attendance",
			"employee": target,
			"attendance_date": date_str,
			"status": status,
			"working_hours": worked_hours,
			"in_time": str(in_dt),
			"out_time": str(out_dt),
			"shift": shift,
		}
	)
	doc.insert(ignore_permissions=True)
	doc.submit()

	# Overtime is not a standard Attendance field. Persist alongside via the
	# custom-field-friendly db.set_value so the number is available for payroll
	# without introducing a new doctype in this slice.
	if overtime:
		try:
			frappe.db.set_value("Attendance", doc.name, "overtime", overtime, update_modified=False)
		except Exception:
			pass  # field may not exist yet in older bench

	return _envelope(
		{
			"attendance": doc.name,
			"status": status,
			"working_hours": worked_hours,
			"overtime_hours": overtime,
			"shift": shift,
			"standard_hours": standard_hours,
		}
	)


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
