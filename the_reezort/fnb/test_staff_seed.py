"""Tests for the restaurant staff hierarchy seeder (F&B Slice 1.5)."""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.fnb.staff_seed import (
	FNB_DESIGNATIONS,
	FNB_ROOT_DEPARTMENT,
	FNB_ROSTER,
	FNB_SUB_DEPARTMENTS,
	seed_fnb_staff,
)
from the_reezort.setup.demo_seed import seed_org_and_users


class TestFnbStaffSeed(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		# demo_seed sets up the parent department + GM Saanvi Sharma that F&B
		# Manager reports to; run it once so the seeder has the parent chain.
		seed_org_and_users()
		cls.result = seed_fnb_staff()
		cls.company = cls.result["company"]

	# ------------------------------------------------------------------
	# Idempotency
	# ------------------------------------------------------------------

	def test_seeder_is_idempotent(self):
		"""Second run must not create duplicate departments / employees / users."""
		before_emps = frappe.db.count("Employee", {"company": self.company})
		before_users = frappe.db.count("User")
		result2 = seed_fnb_staff()
		after_emps = frappe.db.count("Employee", {"company": self.company})
		after_users = frappe.db.count("User")
		self.assertEqual(before_emps, after_emps)
		self.assertEqual(before_users, after_users)
		self.assertEqual(result2["employees"], len(FNB_ROSTER))

	# ------------------------------------------------------------------
	# Structure
	# ------------------------------------------------------------------

	def test_all_departments_present(self):
		for sub in FNB_SUB_DEPARTMENTS:
			self.assertTrue(
				frappe.db.exists(
					"Department", {"department_name": sub, "company": self.company}
				),
				f"Department {sub} missing",
			)

	def test_all_designations_present(self):
		for des in FNB_DESIGNATIONS:
			self.assertTrue(frappe.db.exists("Designation", des), f"Designation {des} missing")

	def test_all_employees_present_and_active(self):
		for full_name, _email, _dept, designation, *_ in FNB_ROSTER:
			row = frappe.db.get_value(
				"Employee",
				{"employee_name": full_name, "company": self.company},
				["name", "status", "designation"],
				as_dict=True,
			)
			self.assertIsNotNone(row, f"Employee {full_name} missing")
			self.assertEqual(row.status, "Active")
			self.assertEqual(row.designation, designation)

	def test_sub_departments_hang_off_fnb_root(self):
		root = frappe.db.get_value(
			"Department", {"department_name": FNB_ROOT_DEPARTMENT, "company": self.company}, "name"
		)
		self.assertIsNotNone(root)
		for sub in FNB_SUB_DEPARTMENTS:
			parent = frappe.db.get_value(
				"Department",
				{"department_name": sub, "company": self.company},
				"parent_department",
			)
			self.assertEqual(parent, root, f"{sub} should hang off {FNB_ROOT_DEPARTMENT}")

	# ------------------------------------------------------------------
	# Hierarchy
	# ------------------------------------------------------------------

	def test_reports_to_chain_wired(self):
		"""Every non-root row must point at its manager Employee row."""
		by_name = {
			row.employee_name: row.name
			for row in frappe.get_all(
				"Employee",
				filters={"company": self.company},
				fields=["name", "employee_name"],
			)
		}
		for full_name, _email, _dept, _des, reports_to_name, _roles in FNB_ROSTER:
			emp_name = by_name.get(full_name)
			self.assertIsNotNone(emp_name)
			actual_reports_to = frappe.db.get_value("Employee", emp_name, "reports_to")
			expected = by_name.get(reports_to_name) if reports_to_name else None
			self.assertEqual(
				actual_reports_to,
				expected,
				f"{full_name} should report to {reports_to_name}, got {actual_reports_to}",
			)

	def test_fnb_manager_reports_to_gm(self):
		fnb_manager = frappe.db.get_value(
			"Employee", {"employee_name": "Karan Nair", "company": self.company}, "name"
		)
		reports_to = frappe.db.get_value("Employee", fnb_manager, "reports_to")
		self.assertIsNotNone(reports_to)
		reports_to_name = frappe.db.get_value("Employee", reports_to, "employee_name")
		self.assertEqual(reports_to_name, "Saanvi Sharma")

	# ------------------------------------------------------------------
	# Roles
	# ------------------------------------------------------------------

	def test_everyone_has_restaurant_role(self):
		for _full_name, email, *_ in FNB_ROSTER:
			role_names = [
				r.role for r in frappe.get_all("Has Role", filters={"parent": email}, fields=["role"])
			]
			self.assertIn("Restaurant", role_names, f"{email} missing Restaurant role")

	def test_managers_have_resort_manager_role(self):
		managers = [
			"karan.fnb@thereezort.com",
			"rajesh.chef@thereezort.com",
			"anita.rest@thereezort.com",
			"vikram.bar@thereezort.com",
		]
		for email in managers:
			role_names = [
				r.role for r in frappe.get_all("Has Role", filters={"parent": email}, fields=["role"])
			]
			self.assertIn("Resort Manager", role_names, f"{email} missing Resort Manager role")

	def test_non_managers_do_not_have_resort_manager(self):
		non_managers = [
			"deepak.chef@thereezort.com",
			"suresh.waiter@thereezort.com",
			"ankit.bartender@thereezort.com",
			"manoj.ird@thereezort.com",
		]
		for email in non_managers:
			role_names = [
				r.role for r in frappe.get_all("Has Role", filters={"parent": email}, fields=["role"])
			]
			self.assertNotIn(
				"Resort Manager", role_names, f"{email} should not have Resort Manager role"
			)

	# ------------------------------------------------------------------
	# Employee ↔ User linkage
	# ------------------------------------------------------------------

	def test_every_employee_linked_to_user(self):
		for full_name, email, *_ in FNB_ROSTER:
			emp_name = frappe.db.get_value(
				"Employee", {"employee_name": full_name, "company": self.company}, "name"
			)
			user_id = frappe.db.get_value("Employee", emp_name, "user_id")
			self.assertEqual(user_id, email, f"{full_name} not linked to {email}")
