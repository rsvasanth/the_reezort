import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.account.api import GENERIC_ROLES, get_current_user_profile


class TestAccountAPI(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.created_users = []

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		for user in cls.created_users:
			if frappe.db.exists("User", user):
				frappe.delete_doc("User", user, force=1, ignore_permissions=True)
		super().tearDownClass()

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def ensure_role(self, role):
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role}).insert(ignore_permissions=True)

	def make_user(self, suffix, roles):
		for role in roles:
			if role not in GENERIC_ROLES:
				self.ensure_role(role)

		email = f"account.profile.{suffix.lower()}.{frappe.generate_hash(length=8)}@example.com"
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": "Account",
				"last_name": f"Profile {suffix}",
				"enabled": 1,
				"user_type": "System User",
				"send_welcome_email": 0,
				"roles": [{"role": role} for role in roles],
			}
		)
		user.insert(ignore_permissions=True)
		self.created_users.append(user.name)
		return user.name

	def profile_for(self, user):
		frappe.set_user(user)
		return get_current_user_profile()["data"]

	def test_front_desk_user_profile_returns_name_roles_and_primary_role(self):
		user = self.make_user("FRONTDESK", ["Front Desk"])

		profile = self.profile_for(user)

		self.assertEqual(profile["user"], user)
		self.assertEqual(profile["full_name"], "Account Profile FRONTDESK")
		self.assertIn("Front Desk", profile["roles"])
		self.assertEqual(profile["primary_role"], "Front Desk")

	def test_primary_role_uses_priority_order(self):
		user = self.make_user("PRIORITY", ["Front Desk", "Resort Manager"])

		profile = self.profile_for(user)

		self.assertEqual(profile["primary_role"], "Resort Manager")

	def test_generic_only_roles_fall_back_to_staff(self):
		user = self.make_user("GENERIC", ["Desk User"])

		profile = self.profile_for(user)

		self.assertEqual(profile["primary_role"], "Staff")

	def test_guest_is_rejected(self):
		frappe.set_user("Guest")

		with self.assertRaises(frappe.PermissionError):
			get_current_user_profile()

	def test_roles_exclude_generic_roles(self):
		user = self.make_user("FILTER", ["Desk User", "Front Desk"])

		profile = self.profile_for(user)

		self.assertIn("Front Desk", profile["roles"])
		self.assertNotIn("All", profile["roles"])
		self.assertNotIn("Desk User", profile["roles"])

	def test_system_manager_flag_reflects_session_roles(self):
		admin_profile = self.profile_for("Administrator")
		staff_user = self.make_user("STAFF", ["Resort Manager"])
		staff_profile = self.profile_for(staff_user)

		self.assertTrue(admin_profile["is_system_manager"])
		self.assertFalse(staff_profile["is_system_manager"])
