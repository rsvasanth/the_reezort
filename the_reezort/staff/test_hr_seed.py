"""Tests for the HR masters seed + attendance wire-up (Commit 1)."""

from datetime import datetime, time as time_cls

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_to_date, get_datetime, now_datetime, today

from the_reezort.staff.attendance_api import (
	mark_attendance_from_checkins,
)
from the_reezort.staff.hr_seed import seed_hr_masters


class TestHRSeed(FrappeTestCase):
	def test_seed_is_idempotent(self):
		"""Second run must not raise or duplicate anything."""
		r1 = seed_hr_masters()
		r2 = seed_hr_masters()
		self.assertEqual(sorted(r1["shifts"]), sorted(r2["shifts"]))
		self.assertEqual(sorted(r1["leave_types"]), sorted(r2["leave_types"]))
		# Only one of each Shift Type should exist.
		for name in r1["shifts"]:
			self.assertEqual(frappe.db.count("Shift Type", {"name": name}), 1)
		# Salary Components should be Basic + HRA only.
		self.assertTrue(frappe.db.exists("Salary Component", "Basic"))
		self.assertTrue(frappe.db.exists("Salary Component", "HRA"))
		# Structure exists and is Active + submitted.
		self.assertEqual(
			frappe.db.get_value("Salary Structure", r1["salary_structure"], "docstatus"), 1
		)

	def test_no_pf_esi_pt_components_seeded(self):
		"""Owner constraint: our seeder must only emit Basic + HRA."""
		result = seed_hr_masters()
		self.assertEqual(set(result["salary_components"]), {"Basic", "HRA"})
		# Salary Structure earnings must not include any deduction-style component.
		structure = frappe.get_doc("Salary Structure", result["salary_structure"])
		earning_components = {row.salary_component for row in structure.earnings}
		self.assertEqual(earning_components, {"Basic", "HRA"})
		# Deductions table must be empty on the seeded structure.
		self.assertEqual(len(structure.deductions), 0)


class TestAttendanceFromCheckins(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		seed_hr_masters()
		# Test employee + user link.
		cls.employee = _ensure_test_employee()

	def setUp(self):
		super().setUp()
		# Wipe any leftover checkins + attendance from prior runs.
		frappe.db.sql(
			"DELETE FROM `tabEmployee Checkin` WHERE employee = %s AND time >= %s",
			(self.employee, f"{today()} 00:00:00"),
		)
		att = frappe.db.get_value(
			"Attendance",
			{"employee": self.employee, "attendance_date": today(), "docstatus": ["!=", 2]},
			"name",
		)
		if att:
			try:
				doc = frappe.get_doc("Attendance", att)
				if doc.docstatus == 1:
					doc.cancel()
				else:
					frappe.delete_doc("Attendance", att, ignore_permissions=True)
			except Exception:
				pass
		frappe.db.commit()

	def _checkin(self, log_type, hour, minute=0):
		"""Insert a checkin at a fixed hour:minute today (avoids cross-midnight)."""
		t = datetime.combine(get_datetime(today()).date(), time_cls(hour, minute, 0))
		frappe.get_doc(
			{"doctype": "Employee Checkin", "employee": self.employee, "log_type": log_type, "time": t}
		).insert(ignore_permissions=True)
		return t

	def test_full_day_pair_produces_present_and_no_overtime(self):
		"""8h shift + 8h worked → Present, 0h overtime."""
		# Assign a Day shift for today so shift lookup works.
		_ensure_shift_assignment(self.employee, shift="Day")
		self._checkin("IN", hour=9)
		self._checkin("OUT", hour=17)

		result = mark_attendance_from_checkins(employee=self.employee, date=today())
		self.assertEqual(result["data"]["status"], "Present")
		self.assertAlmostEqual(result["data"]["working_hours"], 8.0, delta=0.05)
		self.assertEqual(result["data"]["overtime_hours"], 0)

	def test_long_day_produces_overtime(self):
		"""Day shift is 9h (09:00–18:00); 11h worked → ~2h overtime."""
		_ensure_shift_assignment(self.employee, shift="Day")
		self._checkin("IN", hour=8)
		self._checkin("OUT", hour=19)

		result = mark_attendance_from_checkins(employee=self.employee, date=today())
		self.assertEqual(result["data"]["status"], "Present")
		self.assertGreater(result["data"]["overtime_hours"], 1.5)

	def test_short_day_flags_half_day(self):
		"""< 4h → Half Day."""
		_ensure_shift_assignment(self.employee, shift="Day")
		self._checkin("IN", hour=10)
		self._checkin("OUT", hour=12)

		result = mark_attendance_from_checkins(employee=self.employee, date=today())
		self.assertEqual(result["data"]["status"], "Half Day")

	def test_missing_out_returns_none(self):
		self._checkin("IN", hour=9)
		result = mark_attendance_from_checkins(employee=self.employee, date=today())
		self.assertIsNone(result["data"]["attendance"])


# ---------- helpers ----------


def _ensure_test_employee():
	if not frappe.db.exists("Employee", {"employee_name": "HR Seed Tester"}):
		company = frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")
		doc = frappe.get_doc(
			{
				"doctype": "Employee",
				"employee_name": "HR Seed Tester",
				"first_name": "HR",
				"last_name": "Tester",
				"gender": "Other",
				"status": "Active",
				"company": company,
				"date_of_birth": "1990-01-01",
				"date_of_joining": "2020-01-01",
			}
		).insert(ignore_permissions=True)
		return doc.name
	return frappe.db.get_value("Employee", {"employee_name": "HR Seed Tester"}, "name")


def _ensure_shift_assignment(employee, shift="Day"):
	# One active Shift Assignment covering today.
	existing = frappe.db.get_value(
		"Shift Assignment",
		{"employee": employee, "shift_type": shift, "docstatus": 1, "start_date": ["<=", today()]},
		"name",
	)
	if existing:
		return existing
	company = frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")
	doc = frappe.get_doc(
		{
			"doctype": "Shift Assignment",
			"employee": employee,
			"shift_type": shift,
			"start_date": today(),
			"company": company,
			"status": "Active",
		}
	).insert(ignore_permissions=True)
	doc.submit()
	return doc.name
