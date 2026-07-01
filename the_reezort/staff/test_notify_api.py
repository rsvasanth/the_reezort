"""Tests for the notification surface: emitters, dedupe, list, mark-read."""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.staff.notify_api import (
	get_unread_count,
	list_my_notifications,
	mark_all_read,
	mark_read,
	notify_role,
	notify_user,
)


class TestNotifyApi(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.user = _ensure_user("notify.test@example.com", "Notify Test", roles=["Front Desk"])
		cls.other = _ensure_user("notify.other@example.com", "Notify Other", roles=["Front Desk"])
		cls.mgr = _ensure_user("notify.mgr@example.com", "Notify Mgr", roles=["Resort Manager"])

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		# Wipe test-user notifications between tests.
		for u in (self.user, self.other, self.mgr):
			for n in frappe.get_all("Notification Log", filters={"for_user": u}, pluck="name"):
				frappe.delete_doc("Notification Log", n, force=True, ignore_permissions=True)
		frappe.db.commit()

	def test_notify_user_creates_row(self):
		name = notify_user(
			user=self.user,
			subject="Test subject",
			body="Test body",
			source_doctype="Note",
			source_name="fake-note",
		)
		self.assertTrue(name)
		row = frappe.db.get_value(
			"Notification Log",
			name,
			["for_user", "subject", "read", "document_type", "document_name"],
			as_dict=True,
		)
		self.assertEqual(row["for_user"], self.user)
		self.assertEqual(row["subject"], "Test subject")
		self.assertEqual(row["read"], 0)
		self.assertEqual(row["document_type"], "Note")
		self.assertEqual(row["document_name"], "fake-note")

	def test_dedupe_prevents_duplicate_unread_row(self):
		key = "dedupe:test:abc:day-1"
		n1 = notify_user(user=self.user, subject="First", dedupe_key=key)
		n2 = notify_user(user=self.user, subject="Second (should reuse)", dedupe_key=key)
		self.assertEqual(n1, n2)

	def test_dedupe_reissues_after_row_is_marked_read(self):
		key = "dedupe:test:reissue:day-1"
		n1 = notify_user(user=self.user, subject="First", dedupe_key=key)
		frappe.db.set_value("Notification Log", n1, "read", 1)
		n2 = notify_user(user=self.user, subject="Second", dedupe_key=key)
		self.assertNotEqual(n1, n2)

	def test_notify_role_fans_out_and_can_exclude(self):
		created = notify_role(
			role="Resort Manager",
			subject="Fan-out",
			source_doctype="Note",
			source_name="fake",
			exclude_users={self.mgr},
		)
		# We excluded our test manager — should not receive it.
		self.assertNotIn(
			frappe.db.get_value("Notification Log", {"for_user": self.mgr, "subject": "Fan-out"}, "name"),
			created,
		)

	def test_list_and_mark_read(self):
		frappe.set_user(self.user)
		notify_user(user=self.user, subject="A")
		notify_user(user=self.user, subject="B")

		out = list_my_notifications()
		self.assertGreaterEqual(len(out["data"]["notifications"]), 2)
		self.assertGreaterEqual(out["data"]["unread_count"], 2)

		first = out["data"]["notifications"][0]["name"]
		mark_read(name=first)
		self.assertEqual(frappe.db.get_value("Notification Log", first, "read"), 1)

		cleared = mark_all_read()
		self.assertGreaterEqual(cleared["data"]["cleared"], 1)
		self.assertEqual(get_unread_count()["data"]["unread_count"], 0)

	def test_mark_read_blocked_across_users(self):
		# Row owned by `other`; `user` tries to mark it read.
		name = notify_user(user=self.other, subject="Not yours")
		frappe.set_user(self.user)
		with self.assertRaises(frappe.PermissionError):
			mark_read(name=name)


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
		frappe.db.commit()
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
			frappe.db.commit()
	return email
