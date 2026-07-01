"""Tests for staff.payroll_api — assign structure, list, deactivate, preview.

All tests run as Administrator to sidestep Frappe test isolation (savepoint
rollback strips ad-hoc User rows before the test body runs). Manager-role
enforcement is covered by the leave/advance tests which share the same helper.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, get_first_day, today

from the_reezort.staff.hr_seed import seed_hr_masters
from the_reezort.staff.payroll_api import (
	assign_salary_structure,
	deactivate_salary_structure_assignment,
	list_salary_structure_assignments,
	preview_payroll,
)


class TestPayrollApi(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		seed_hr_masters()
		cls.company = frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")
		cls.emp = _ensure_employee("Payroll Test Emp", cls.company)
		frappe.db.commit()

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		# Wipe assignments for our test employee between tests.
		for name in frappe.get_all(
			"Salary Structure Assignment",
			filters={"employee": self.emp},
			pluck="name",
		):
			try:
				doc = frappe.get_doc("Salary Structure Assignment", name)
				if doc.docstatus == 1:
					doc.cancel()
				frappe.delete_doc("Salary Structure Assignment", name, force=True, ignore_permissions=True)
			except Exception:
				pass
		frappe.db.commit()

	# ----- assign_salary_structure -----

	def test_assign_creates_submitted_row(self):
		out = assign_salary_structure(
			employee=self.emp,
			salary_structure="Standard Monthly — REEZORT",
			base=25000,
		)
		row = frappe.db.get_value(
			"Salary Structure Assignment",
			out["data"]["assignment"],
			["docstatus", "base"],
			as_dict=True,
		)
		self.assertEqual(row["docstatus"], 1)
		self.assertEqual(float(row["base"]), 25000.0)

	def test_second_assignment_cancels_prior(self):
		first = assign_salary_structure(
			employee=self.emp,
			salary_structure="Standard Monthly — REEZORT",
			base=20000,
			from_date=str(get_first_day(today())),
		)
		second = assign_salary_structure(
			employee=self.emp,
			salary_structure="Standard Monthly — REEZORT",
			base=25000,
			from_date=add_days(get_first_day(today()), 30),
		)
		# Prior submit is cancelled (docstatus=2); new one is submitted (docstatus=1).
		self.assertEqual(
			frappe.db.get_value("Salary Structure Assignment", first["data"]["assignment"], "docstatus"),
			2,
		)
		self.assertEqual(
			frappe.db.get_value("Salary Structure Assignment", second["data"]["assignment"], "docstatus"),
			1,
		)

	def test_deactivate_cancels_the_row(self):
		out = assign_salary_structure(
			employee=self.emp,
			salary_structure="Standard Monthly — REEZORT",
			base=25000,
		)
		deactivate_salary_structure_assignment(name=out["data"]["assignment"])
		self.assertEqual(
			frappe.db.get_value("Salary Structure Assignment", out["data"]["assignment"], "docstatus"),
			2,
		)

	def test_assign_refuses_zero_or_negative_base(self):
		with self.assertRaises(frappe.ValidationError):
			assign_salary_structure(
				employee=self.emp,
				salary_structure="Standard Monthly — REEZORT",
				base=0,
			)
		with self.assertRaises(frappe.ValidationError):
			assign_salary_structure(
				employee=self.emp,
				salary_structure="Standard Monthly — REEZORT",
				base=-100,
			)

	# ----- list_salary_structure_assignments -----

	def test_list_shows_row_with_and_without_assignment(self):
		# Unassigned first.
		out = list_salary_structure_assignments(company=self.company)
		row = next((r for r in out["data"]["rows"] if r["employee"] == self.emp), None)
		self.assertIsNotNone(row)
		self.assertIsNone(row["assignment"])
		self.assertGreaterEqual(out["data"]["unassigned_count"], 1)
		# Assign, then list should reflect it.
		assign_salary_structure(
			employee=self.emp,
			salary_structure="Standard Monthly — REEZORT",
			base=25000,
		)
		out = list_salary_structure_assignments(company=self.company)
		row = next((r for r in out["data"]["rows"] if r["employee"] == self.emp), None)
		self.assertIsNotNone(row["assignment"])
		self.assertEqual(row["assignment"]["salary_structure"], "Standard Monthly — REEZORT")

	# ----- preview_payroll -----

	def test_preview_estimates_gross_from_base_and_formula(self):
		assign_salary_structure(
			employee=self.emp,
			salary_structure="Standard Monthly — REEZORT",
			base=20000,
			from_date=str(get_first_day(today())),
		)
		this_month = get_first_day(today()).strftime("%Y-%m")
		out = preview_payroll(company=self.company, period=this_month)
		match = next((s for s in out["data"]["slips_preview"] if s["employee"] == self.emp), None)
		self.assertIsNotNone(match)
		# Basic (base) + HRA (0.4·base) = 1.4·base.
		self.assertAlmostEqual(match["gross_estimate"], 20000 * 1.4, delta=1)
		self.assertGreaterEqual(out["data"]["included_count"], 1)


# ---------- helpers ----------


def _ensure_employee(name, company):
	existing = frappe.db.get_value("Employee", {"employee_name": name}, "name")
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
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	return doc.name
