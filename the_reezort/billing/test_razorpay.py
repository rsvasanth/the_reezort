import hashlib
import hmac
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.billing.razorpay_gateway import (
	RAZORPAY_ORDERS_URL,
	_folio_payable,
	capture_deposit,
	capture_payment,
	verify_signature,
)


def _sign(order_id, payment_id, secret):
	return hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


def _fake_response(payload):
	resp = MagicMock()
	resp.raise_for_status.return_value = None
	resp.json.return_value = payload
	return resp


class TestRazorpayGateway(FrappeTestCase):
	def test_verify_signature_accepts_valid(self):
		secret = "test_secret_123"
		signature = _sign("order_abc", "pay_xyz", secret)

		self.assertTrue(verify_signature("order_abc", "pay_xyz", signature, key_secret=secret))

	def test_verify_signature_rejects_tampered(self):
		secret = "test_secret_123"
		signature = _sign("order_abc", "pay_xyz", secret)

		# Wrong payment id -> signature no longer matches.
		self.assertFalse(verify_signature("order_abc", "pay_DIFFERENT", signature, key_secret=secret))
		self.assertFalse(verify_signature("order_abc", "pay_xyz", "deadbeef", key_secret=secret))

	def test_capture_rejects_bad_signature_before_any_posting(self):
		with self.assertRaises(frappe.ValidationError):
			capture_payment("RZ-FOL-DOES-NOT-EXIST", "order_x", "pay_x", "bad-signature", 100)

	def test_capture_deposit_rejects_bad_signature_before_any_posting(self):
		with self.assertRaises(frappe.ValidationError):
			capture_deposit("RZ-FOL-DOES-NOT-EXIST", "order_x", "pay_x", "bad-signature", 100)


class TestFolioPayable(FrappeTestCase):
	def test_fully_paid_folio_with_zero_outstanding_is_not_payable_again(self):
		"""Regression: the outstanding<=0 fallback branch omitted total_paid,
		so a folio fully covered by a deposit (outstanding == 0) fell through
		to the gross charge total and could be charged again via a brand-new
		Razorpay order."""
		folio = frappe._dict(
			outstanding_amount=0,
			total_charges=10000,
			total_taxes_estimated=1800,
			total_discounts=0,
			total_paid=11800,
		)
		self.assertEqual(_folio_payable(folio), 0)

	def test_partially_paid_folio_with_zero_outstanding_field_is_not_overcharged(self):
		# outstanding_amount not yet recomputed (e.g. stale) but total_paid
		# already covers most of the charge — the fallback must still net it out.
		folio = frappe._dict(
			outstanding_amount=0,
			total_charges=10000,
			total_taxes_estimated=1800,
			total_discounts=0,
			total_paid=5000,
		)
		self.assertEqual(_folio_payable(folio), 6800)

	def test_outstanding_field_is_trusted_when_positive(self):
		folio = frappe._dict(
			outstanding_amount=2500, total_charges=10000, total_taxes_estimated=1800,
			total_discounts=0, total_paid=9300,
		)
		self.assertEqual(_folio_payable(folio), 2500)


class TestRazorpayOrderBinding(FrappeTestCase):
	"""A valid signature only proves payment_id belongs to order_id — it says
	nothing about which folio the order was created for. capture_payment /
	capture_deposit must independently verify the order's own notes (recorded
	at create_order/create_deposit_order time) before settling anything."""

	SECRET = "test_secret_123"

	def setUp(self):
		self._real_conf = dict(frappe.conf)
		frappe.conf.razorpay_key_id = "test_key_id"
		frappe.conf.razorpay_key_secret = self.SECRET
		self.addCleanup(self._restore_conf)

	def _restore_conf(self):
		for key in ("razorpay_key_id", "razorpay_key_secret"):
			if key in self._real_conf:
				frappe.conf[key] = self._real_conf[key]
			else:
				frappe.conf.pop(key, None)

	def _order_notes_response(self, notes):
		return _fake_response({"id": "order_x", "notes": notes})

	def test_capture_payment_rejects_an_order_created_for_a_different_folio(self):
		signature = _sign("order_x", "pay_x", self.SECRET)

		with patch("the_reezort.billing.razorpay_gateway.requests.get") as mock_get, \
			patch("the_reezort.billing.razorpay_gateway.settle_folio") as mock_settle:
			mock_get.return_value = self._order_notes_response(
				{"guest_folio": "RZ-FOL-SOMEONE-ELSE", "intent": "settle"}
			)
			with self.assertRaises(frappe.PermissionError):
				capture_payment("RZ-FOL-MINE", "order_x", "pay_x", signature, 100)

			# The mismatch must be caught by the order-notes check, before ever
			# calling settle_folio (i.e. before any money moves).
			mock_settle.assert_not_called()
			# And it must hit the orders endpoint (order-notes check), not skip
			# straight to trusting the caller's folio.
			called_urls = [c.args[0] for c in mock_get.call_args_list]
			self.assertTrue(any(RAZORPAY_ORDERS_URL in u for u in called_urls))

	def test_capture_payment_rejects_a_deposit_order_replayed_as_a_settlement(self):
		signature = _sign("order_x", "pay_x", self.SECRET)

		with patch("the_reezort.billing.razorpay_gateway.requests.get") as mock_get, \
			patch("the_reezort.billing.razorpay_gateway.settle_folio") as mock_settle:
			mock_get.return_value = self._order_notes_response(
				{"guest_folio": "RZ-FOL-MINE", "intent": "deposit"}
			)
			with self.assertRaises(frappe.PermissionError):
				capture_payment("RZ-FOL-MINE", "order_x", "pay_x", signature, 100)
			mock_settle.assert_not_called()

	def test_capture_payment_proceeds_when_the_order_matches_the_folio(self):
		signature = _sign("order_x", "pay_x", self.SECRET)

		def fake_get(url, **kwargs):
			if RAZORPAY_ORDERS_URL in url:
				return self._order_notes_response({"guest_folio": "RZ-FOL-MINE", "intent": "settle"})
			return _fake_response({"order_id": "order_x", "status": "captured", "amount": 10000})

		with patch("the_reezort.billing.razorpay_gateway.requests.get", side_effect=fake_get), \
			patch("the_reezort.billing.razorpay_gateway.settle_folio") as mock_settle:
			mock_settle.return_value = {"ok": True}
			capture_payment("RZ-FOL-MINE", "order_x", "pay_x", signature, 100)
			mock_settle.assert_called_once()
			# The captured amount must come from Razorpay (10000 paise -> 100), not
			# the client-supplied `amount` argument.
			self.assertEqual(mock_settle.call_args.kwargs["payments"][0]["amount"], 100)
