"""Regression tests for the security-audit hardening pass.

Covers: the system-manager seed guard, folio-line negative/reduction gating,
KYC PII masking, cross-folio deposit-replay protection, cumulative refund cap,
and minibar input-type validation.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import today

from the_reezort.billing import deposits
from the_reezort.billing.api import _authorize_folio_line, _can_view_kyc
from the_reezort.billing.corrections import _prior_refunded
from the_reezort.permissions import system_manager_only
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


def _any_company():
	return frappe.db.get_value("Company", {}, "name")


def _make_user(email, roles):
	if not frappe.db.exists("User", email):
		u = frappe.get_doc(
			{"doctype": "User", "email": email, "first_name": email.split("@")[0], "send_welcome_email": 0}
		)
		u.insert(ignore_permissions=True)
	else:
		u = frappe.get_doc("User", email)
	existing = {r.role for r in u.roles}
	for role in roles:
		if role not in existing and frappe.db.exists("Role", role):
			u.append("roles", {"role": role})
	u.save(ignore_permissions=True)
	return email


class TestSystemManagerGuard(FrappeTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_guard_blocks_non_system_manager(self):
		calls = []

		@system_manager_only
		def sentinel():
			calls.append(1)
			return "ran"

		user = _make_user("sec_plain@example.com", [])
		frappe.set_user(user)
		# frappe.only_for() is a no-op under frappe.flags.in_test, so clear it to
		# exercise the real production guard.
		prev = frappe.flags.in_test
		frappe.flags.in_test = False
		try:
			with self.assertRaises(frappe.PermissionError):
				sentinel()
		finally:
			frappe.flags.in_test = prev
		self.assertEqual(calls, [])  # body never ran

	def test_guard_allows_administrator(self):
		@system_manager_only
		def sentinel():
			return "ran"

		frappe.set_user("Administrator")
		self.assertEqual(sentinel(), "ran")


class TestFolioLineAuthorization(FrappeTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_positive_charge_allowed_for_anyone(self):
		user = _make_user("sec_frontdesk@example.com", [])
		frappe.set_user(user)
		# Should not raise for a normal positive charge.
		_authorize_folio_line("Charge", amount=5000, rate=5000, discount_amount=0)

	def test_negative_charge_blocked_for_non_finance(self):
		user = _make_user("sec_frontdesk@example.com", [])
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError):
			_authorize_folio_line("Charge", amount=-5000, rate=-5000, discount_amount=0)

	def test_reduction_line_blocked_for_non_finance(self):
		user = _make_user("sec_frontdesk@example.com", [])
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError):
			_authorize_folio_line("Discount", amount=1000, rate=1000, discount_amount=0)

	def test_reduction_allowed_for_finance(self):
		frappe.set_user("Administrator")  # System Manager is a finance role
		_authorize_folio_line("Adjustment", amount=-1000, rate=-1000, discount_amount=0)


class TestKycMasking(FrappeTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_plain_user_cannot_view_kyc(self):
		user = _make_user("sec_plain2@example.com", [])
		frappe.set_user(user)
		self.assertFalse(_can_view_kyc())

	def test_finance_user_can_view_kyc(self):
		frappe.set_user("Administrator")
		self.assertTrue(_can_view_kyc())


class TestDepositReplayGuard(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]
		cls.customer = frappe.db.get_value("Customer", {}, "name") or frappe.get_doc(
			{"doctype": "Customer", "customer_name": "ZZ Sec Guest"}
		).insert(ignore_permissions=True).name

	def _folio(self):
		return frappe.get_doc(
			{
				"doctype": "Guest Folio",
				"resort_property": self.resort_property,
				"company": self.company,
				"customer": self.customer,
				"folio_status": "Open",
				"currency": self.currency,
			}
		).insert(ignore_permissions=True).name

	def test_reused_key_on_different_folio_is_rejected(self):
		folio_a = self._folio()
		folio_b = self._folio()
		key = "sec-shared-key"
		# First deposit on folio A establishes the key.
		deposits.record_deposit(folio_a, 1000, mode_of_payment="Cash", idempotency_key=key)
		# Replaying the same key against folio B must be refused.
		with self.assertRaises(frappe.ValidationError):
			deposits.record_deposit(folio_b, 1000, mode_of_payment="Cash", idempotency_key=key)


class TestCumulativeRefundCap(FrappeTestCase):
	def test_prior_refunded_sums_posted_logs(self):
		line = "FL-SEC-REFUND-TEST"
		for paise in (500000, 400000):
			frappe.get_doc(
				{
					"doctype": "ERPNext Posting Log",
					"posting_type": "Refund",
					"idempotency_key": f"refund:{line}:{paise}",
					"posting_status": "Posted",
					"source_doctype": "Company",
					"source_name": _any_company(),
				}
			).insert(ignore_permissions=True)
		# 5000 + 4000 already refunded.
		self.assertEqual(_prior_refunded(line), 9000.0)

	def test_prior_refunded_ignores_non_posted(self):
		line = "FL-SEC-REFUND-TEST-2"
		frappe.get_doc(
			{
				"doctype": "ERPNext Posting Log",
				"posting_type": "Refund",
				"idempotency_key": f"refund:{line}:300000",
				"posting_status": "Failed",
				"source_doctype": "Company",
				"source_name": _any_company(),
			}
		).insert(ignore_permissions=True)
		self.assertEqual(_prior_refunded(line), 0.0)


class TestMinibarInputValidation(FrappeTestCase):
	def test_non_list_items_rejected(self):
		from the_reezort.minibar.api import post_minibar_consumption

		with self.assertRaises(frappe.ValidationError):
			post_minibar_consumption(stay="NONEXISTENT", items='"just_a_string"')

	def test_list_of_non_dicts_rejected(self):
		from the_reezort.minibar.api import post_minibar_consumption

		with self.assertRaises(frappe.ValidationError):
			post_minibar_consumption(stay="NONEXISTENT", items="[1, 2, 3]")
