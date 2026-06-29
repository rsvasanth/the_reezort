"""Tests for Attendance & Roster APIs (over hrms)."""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.staff import attendance_api


class TestAttendance(FrappeTestCase):
	def setUp(self):
		company = frappe.db.get_value("Company", {}, "name")
		self.employee = frappe.get_doc(
			{
				"doctype": "Employee",
				"first_name": "ZZ Attend",
				"company": company,
				"gender": "Other",
				"date_of_birth": "1995-01-01",
				"date_of_joining": "2026-01-01",
				"status": "Active",
			}
		).insert(ignore_permissions=True).name

	def test_board_lists_employee(self):
		board = attendance_api.get_attendance_board()["data"]
		self.assertIn("Present", board["statuses"])
		self.assertTrue(any(r["employee"] == self.employee for r in board["board"]))

	def test_clock_in_out(self):
		attendance_api.clock_in(employee=self.employee)
		out = attendance_api.clock_out(employee=self.employee)
		self.assertEqual(out["data"]["log_type"], "OUT")
		row = next(r for r in attendance_api.get_attendance_board()["data"]["board"] if r["employee"] == self.employee)
		self.assertEqual(row["clocked"], "OUT")

	def test_mark_attendance_idempotent_and_replace(self):
		first = attendance_api.mark_attendance(self.employee, "Present")
		self.assertFalse(first["data"]["reused"])
		again = attendance_api.mark_attendance(self.employee, "Present")
		self.assertTrue(again["data"]["reused"])
		# Change → cancels the submitted record and re-marks.
		changed = attendance_api.mark_attendance(self.employee, "Absent")
		self.assertFalse(changed["data"]["reused"])
		self.assertEqual(changed["data"]["status"], "Absent")

	def test_invalid_status_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			attendance_api.mark_attendance(self.employee, "Vacationing")
