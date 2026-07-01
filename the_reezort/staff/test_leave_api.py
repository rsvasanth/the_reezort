"""Tests for staff.leave_api — create/approve/reject/cancel + self-approve block."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.staff.hr_seed import seed_hr_masters
from the_reezort.staff.leave_api import (
	cancel_leave_request,
	create_leave_request,
	decide_leave,
	list_my_leaves,
	list_pending_leaves,
)


class TestLeaveApi(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		seed_hr_masters()
		cls.company = frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")
		cls.requester_user = _ensure_user("leave.staff@example.com", "Leave Staff", roles=["Front Desk"])
		cls.manager_user = _ensure_user(
			"leave.manager@example.com",
			"Leave Manager",
			roles=["Resort Manager", "Leave Approver", "HR User"],
		)
		_ensure_holiday_list(cls.company)
		cls.requester_emp = _ensure_employee(cls.requester_user, "Leave Staff Emp", cls.company)
		cls.manager_emp = _ensure_employee(cls.manager_user, "Leave Manager Emp", cls.company)
		# Employee.leave_approver is used by HRMS to gate validate_leave_access.
		frappe.db.set_value("Employee", cls.requester_emp, "leave_approver", cls.manager_user)
		frappe.db.set_value("Employee", cls.manager_emp, "leave_approver", cls.manager_user)
		# Leave Application requires a Leave Allocation covering the period.
		for emp in (cls.requester_emp, cls.manager_emp):
			for lt in ("Casual Leave", "Sick Leave", "Earned Leave"):
				_ensure_leave_allocation(emp, lt)

	def setUp(self):
		super().setUp()
		# Wipe old leave apps for our two test employees.
		for emp in (self.requester_emp, self.manager_emp):
			for name in frappe.get_all("Leave Application", filters={"employee": emp}, pluck="name"):
				try:
					doc = frappe.get_doc("Leave Application", name)
					if doc.docstatus == 1:
						doc.cancel()
					frappe.delete_doc("Leave Application", name, force=True, ignore_permissions=True)
				except Exception:
					pass
		frappe.db.commit()

	def _as(self, user):
		frappe.set_user(user)

	def test_create_and_list_my_leave(self):
		self._as(self.requester_user)
		out = create_leave_request(
			leave_type="Casual Leave",
			from_date=add_days(today(), 3),
			to_date=add_days(today(), 4),
			reason="Family event",
		)
		self.assertEqual(out["data"]["leave"]["status"], "Open")
		self.assertEqual(out["data"]["leave"]["total_leave_days"], 2)

		listed = list_my_leaves()
		self.assertEqual(len(listed["data"]["leaves"]), 1)
		# Balance strip includes Casual/Sick/Earned.
		types = {b["leave_type"] for b in listed["data"]["balances"]}
		self.assertTrue({"Casual Leave", "Sick Leave", "Earned Leave"}.issubset(types))

	def test_manager_approves_leave(self):
		self._as(self.requester_user)
		req = create_leave_request(
			leave_type="Casual Leave",
			from_date=add_days(today(), 5),
			to_date=add_days(today(), 5),
			reason="Personal",
		)
		name = req["data"]["leave"]["name"]

		self._as(self.manager_user)
		out = decide_leave(name=name, action="Approve", notes="OK")
		self.assertEqual(out["data"]["leave"]["status"], "Approved")
		self.assertEqual(frappe.db.get_value("Leave Application", name, "docstatus"), 1)

	def test_self_approve_blocked(self):
		# Manager files their own request; then tries to approve → blocked.
		self._as(self.manager_user)
		req = create_leave_request(
			leave_type="Sick Leave",
			from_date=add_days(today(), 1),
			to_date=add_days(today(), 1),
			reason="Doc appointment",
		)
		with self.assertRaises(frappe.PermissionError):
			decide_leave(name=req["data"]["leave"]["name"], action="Approve", notes="me")

	def test_cancel_own_open_leave(self):
		self._as(self.requester_user)
		req = create_leave_request(
			leave_type="Casual Leave",
			from_date=add_days(today(), 7),
			to_date=add_days(today(), 7),
		)
		name = req["data"]["leave"]["name"]
		out = cancel_leave_request(name=name)
		self.assertTrue(out["data"]["cancelled"])
		self.assertFalse(frappe.db.exists("Leave Application", name))

	def test_non_manager_cannot_see_inbox(self):
		self._as(self.requester_user)
		with self.assertRaises(frappe.PermissionError):
			list_pending_leaves()

	def test_manager_pending_inbox_shows_open_only(self):
		self._as(self.requester_user)
		req = create_leave_request(
			leave_type="Casual Leave",
			from_date=add_days(today(), 10),
			to_date=add_days(today(), 10),
		)
		open_name = req["data"]["leave"]["name"]

		self._as(self.manager_user)
		out = list_pending_leaves()
		names = {r["name"] for r in out["data"]["leaves"]}
		self.assertIn(open_name, names)

		decide_leave(name=open_name, action="Reject", notes="Peak day")
		out = list_pending_leaves()
		names = {r["name"] for r in out["data"]["leaves"]}
		self.assertNotIn(open_name, names)


# ---------- helpers ----------


def _ensure_user(email, full_name, roles=None):
	if not frappe.db.exists("User", email):
		u = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": full_name.split()[0],
				"last_name": " ".join(full_name.split()[1:]) or "X",
				"send_welcome_email": 0,
				"enabled": 1,
				"user_type": "System User",
			}
		)
		u.insert(ignore_permissions=True)
	# Ensure roles.
	if roles:
		u = frappe.get_doc("User", email)
		existing = {r.role for r in u.roles}
		changed = False
		for r in roles:
			if r not in existing:
				u.append("roles", {"role": r})
				changed = True
		if changed:
			u.save(ignore_permissions=True)
	return email


def _ensure_holiday_list(company):
	from frappe.utils import add_days
	name = "Test Holiday List"
	if not frappe.db.exists("Holiday List", name):
		start = add_days(today(), -365)
		end = add_days(today(), 365)
		frappe.get_doc(
			{
				"doctype": "Holiday List",
				"holiday_list_name": name,
				"from_date": str(start),
				"to_date": str(end),
			}
		).insert(ignore_permissions=True)
	frappe.db.set_value("Company", company, "default_holiday_list", name)
	return name


def _ensure_leave_allocation(employee, leave_type):
	from frappe.utils import add_days
	start = add_days(today(), -180)
	end = add_days(today(), 180)
	existing = frappe.db.get_value(
		"Leave Allocation",
		{"employee": employee, "leave_type": leave_type, "from_date": ["<=", today()], "to_date": [">=", today()]},
		"name",
	)
	if existing:
		return existing
	# Cap at the Leave Type's max_leaves_allowed to avoid OverAllocation.
	max_days = frappe.db.get_value("Leave Type", leave_type, "max_leaves_allowed") or 5
	doc = frappe.get_doc(
		{
			"doctype": "Leave Allocation",
			"employee": employee,
			"leave_type": leave_type,
			"from_date": str(start),
			"to_date": str(end),
			"new_leaves_allocated": max_days,
			"carry_forward": 0,
		}
	).insert(ignore_permissions=True)
	doc.submit()
	return doc.name


def _ensure_employee(user_id, name, company):
	existing = frappe.db.get_value("Employee", {"user_id": user_id}, "name")
	if existing:
		return existing
	doc = frappe.get_doc(
		{
			"doctype": "Employee",
			"employee_name": name,
			"first_name": name.split()[0],
			"gender": "Other",
			"status": "Active",
			"company": company,
			"date_of_birth": "1990-01-01",
			"date_of_joining": "2020-01-01",
			"user_id": user_id,
		}
	).insert(ignore_permissions=True)
	return doc.name
