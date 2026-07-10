"""Tests for the_reezort.utils — the shared envelope/JSON-coercion/permission
helpers consolidated out of 11+ duplicate per-module copies (2026-07-10 audit).
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.utils import as_dict, as_list, envelope, require_permission


class TestUtils(FrappeTestCase):
	def test_envelope_defaults(self):
		out = envelope({"x": 1})
		self.assertEqual(out, {"ok": True, "data": {"x": 1}, "warnings": [], "blockers": [], "next_actions": []})

	def test_envelope_with_extras(self):
		out = envelope({"x": 1}, warnings=["w"], blockers=["b"], next_actions=["n"])
		self.assertEqual(out["warnings"], ["w"])
		self.assertEqual(out["blockers"], ["b"])
		self.assertEqual(out["next_actions"], ["n"])

	def test_as_dict_parses_json_string(self):
		self.assertEqual(as_dict('{"a": 1}'), {"a": 1})

	def test_as_dict_passes_through_dict(self):
		self.assertEqual(as_dict({"a": 1}), {"a": 1})

	def test_as_dict_empty_string_is_empty_dict(self):
		self.assertEqual(as_dict(""), {})

	def test_as_dict_none_is_empty_dict(self):
		self.assertEqual(as_dict(None), {})

	def test_as_list_parses_json_string(self):
		self.assertEqual(as_list("[1, 2]"), [1, 2])

	def test_as_list_passes_through_list(self):
		self.assertEqual(as_list([1, 2]), [1, 2])

	def test_as_list_empty_string_is_empty_list(self):
		self.assertEqual(as_list(""), [])

	def test_require_permission_blocks_guest(self):
		original = frappe.session.user
		try:
			frappe.set_user("Guest")
			with self.assertRaises(frappe.PermissionError):
				require_permission("Resort Property", "read")
		finally:
			frappe.set_user(original)

	def test_require_permission_allows_permitted_user(self):
		# Administrator has permission on every doctype — should not raise.
		require_permission("Resort Property", "read")
