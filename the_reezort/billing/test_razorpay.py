import hashlib
import hmac

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.billing.razorpay_gateway import capture_payment, verify_signature


def _sign(order_id, payment_id, secret):
	return hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


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
