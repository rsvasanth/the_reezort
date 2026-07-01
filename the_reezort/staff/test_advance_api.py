"""Tests for staff.advance_api — create/approve/reject/cancel + cap + self-approve."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import today

from the_reezort.staff.advance_api import (
	cancel_advance_request,
	create_advance_request,
	decide_advance,
	list_my_advances,
	list_pending_advances,
	DEFAULT_CAP,
)


class TestAdvanceApi(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")
		_ensure_employee_advance_account(cls.company)
		cls.requester_user = _ensure_user("adv.staff@example.com", "Adv Staff", roles=["Front Desk"])
		cls.manager_user = _ensure_user("adv.manager@example.com", "Adv Manager", roles=["Resort Manager", "HR User"])
		cls.requester_emp = _ensure_employee(cls.requester_user, "Adv Staff Emp", cls.company)
		cls.manager_emp = _ensure_employee(cls.manager_user, "Adv Manager Emp", cls.company)

	def setUp(self):
		super().setUp()
		for emp in (self.requester_emp, self.manager_emp):
			for name in frappe.get_all("Employee Advance", filters={"employee": emp}, pluck="name"):
				try:
					doc = frappe.get_doc("Employee Advance", name)
					if doc.docstatus == 1:
						doc.cancel()
					frappe.delete_doc("Employee Advance", name, force=True, ignore_permissions=True)
				except Exception:
					pass
		frappe.db.commit()

	def _as(self, user):
		frappe.set_user(user)

	def test_create_and_list_my_advance(self):
		self._as(self.requester_user)
		out = create_advance_request(amount=10000, purpose="Medical")
		self.assertEqual(out["data"]["advance"]["docstatus"], 0)
		self.assertEqual(out["data"]["advance"]["status"], "Draft")

		listed = list_my_advances()
		self.assertEqual(len(listed["data"]["advances"]), 1)
		self.assertEqual(listed["data"]["cap"], DEFAULT_CAP)

	def test_advance_above_cap_refused(self):
		self._as(self.requester_user)
		with self.assertRaises(frappe.ValidationError):
			create_advance_request(amount=DEFAULT_CAP + 1, purpose="Way too much")

	def test_manager_approves_advance(self):
		self._as(self.requester_user)
		req = create_advance_request(amount=5000, purpose="Travel")
		name = req["data"]["advance"]["name"]

		self._as(self.manager_user)
		out = decide_advance(name=name, action="Approve", notes="OK")
		self.assertEqual(out["data"]["action"], "Approved")
		self.assertEqual(frappe.db.get_value("Employee Advance", name, "docstatus"), 1)

	def test_manager_rejects_deletes_row(self):
		self._as(self.requester_user)
		req = create_advance_request(amount=2000, purpose="Fuel")
		name = req["data"]["advance"]["name"]

		self._as(self.manager_user)
		out = decide_advance(name=name, action="Reject", notes="Over limit")
		self.assertEqual(out["data"]["action"], "Rejected")
		self.assertFalse(frappe.db.exists("Employee Advance", name))

	def test_self_approve_blocked(self):
		self._as(self.manager_user)
		req = create_advance_request(amount=1000, purpose="Own")
		with self.assertRaises(frappe.PermissionError):
			decide_advance(name=req["data"]["advance"]["name"], action="Approve")

	def test_cancel_own_draft(self):
		self._as(self.requester_user)
		req = create_advance_request(amount=1500, purpose="Books")
		name = req["data"]["advance"]["name"]
		out = cancel_advance_request(name=name)
		self.assertTrue(out["data"]["cancelled"])
		self.assertFalse(frappe.db.exists("Employee Advance", name))

	def test_non_manager_cannot_see_inbox(self):
		self._as(self.requester_user)
		with self.assertRaises(frappe.PermissionError):
			list_pending_advances()


# ---------- helpers ----------


def _ensure_employee_advance_account(company):
	# Look up an existing Receivable account.
	receivable = frappe.db.get_value(
		"Account",
		{"company": company, "root_type": "Asset", "account_type": "Receivable", "is_group": 0},
		"name",
	)
	if not receivable:
		parent = frappe.db.get_value(
			"Account", {"company": company, "root_type": "Asset", "is_group": 1}, "name"
		)
		receivable = frappe.get_doc(
			{
				"doctype": "Account",
				"account_name": "Employee Advances",
				"parent_account": parent,
				"company": company,
				"root_type": "Asset",
				"account_type": "Receivable",
				"is_group": 0,
			}
		).insert(ignore_permissions=True).name
	current = frappe.db.get_value("Company", company, "default_employee_advance_account")
	if current != receivable:
		frappe.db.set_value("Company", company, "default_employee_advance_account", receivable)


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
