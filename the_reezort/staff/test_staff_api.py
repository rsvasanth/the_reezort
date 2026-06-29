"""Tests for Staff & Access — including the security guards."""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.staff import api

EMAIL = "zz.teststaff@thereezort.com"


class TestStaffAccess(FrappeTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_create_assign_idempotent(self):
		out = api.create_staff(
			{"email": EMAIL, "first_name": "Zed", "roles": ["Front Desk"], "password": "Reezort@2026"}
		)
		self.assertFalse(out["data"]["reused"])
		self.assertEqual(out["data"]["user"]["user"], EMAIL)
		self.assertIn("Front Desk", out["data"]["user"]["roles"])

		# Re-create same email → reused, roles updated, not duplicated.
		again = api.create_staff(
			{"email": EMAIL, "first_name": "Zed", "roles": ["Front Desk", "Housekeeping"]}
		)
		self.assertTrue(again["data"]["reused"])
		self.assertIn("Housekeeping", again["data"]["user"]["roles"])

		listed = api.list_staff()["data"]["staff"]
		self.assertTrue(any(s["user"] == EMAIL for s in listed))

	def test_update_roles_and_disable(self):
		api.create_staff({"email": EMAIL, "first_name": "Zed", "roles": ["Front Desk"]})
		api.update_staff_roles(EMAIL, ["Concierge"])
		self.assertEqual(api._resort_roles_of(EMAIL), ["Concierge"])
		api.set_staff_enabled(EMAIL, 0)
		self.assertEqual(frappe.db.get_value("User", EMAIL, "enabled"), 0)

	def test_cannot_assign_privileged_role(self):
		with self.assertRaises(frappe.ValidationError):
			api.create_staff({"email": EMAIL, "first_name": "Zed", "roles": ["System Manager"]})

	def test_invalid_email_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			api.create_staff({"email": "not-an-email", "first_name": "Zed", "roles": ["Front Desk"]})

	def test_protected_user_not_editable(self):
		with self.assertRaises(frappe.ValidationError):
			api.update_staff_roles("Administrator", ["Front Desk"])

	def test_non_admin_cannot_manage(self):
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			api.list_staff()
