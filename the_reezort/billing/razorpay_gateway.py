"""Razorpay (test mode) payment capture for folio checkout.

Reads test keys from site_config (`frappe.conf`). `create_order` makes a
Razorpay order for a folio's payable amount; the SPA opens checkout.js; on the
client callback `capture_payment` verifies the HMAC signature and settles the
folio (booking the ERPNext Sales Invoice + Payment Entry via F4 `settle_folio`).
Idempotent on the Razorpay payment id, so a duplicate callback never
double-books.
"""

import hashlib
import hmac

import frappe
import requests
from frappe import _
from frappe.utils import flt

from the_reezort.billing.settlement import settle_folio

RAZORPAY_ORDERS_URL = "https://api.razorpay.com/v1/orders"


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _keys():
	key_id = frappe.conf.get("razorpay_key_id")
	key_secret = frappe.conf.get("razorpay_key_secret")
	if not key_id or not key_secret:
		frappe.throw(_("Razorpay keys are not configured in site_config."))
	return key_id, key_secret


def _folio_payable(folio):
	outstanding = flt(folio.outstanding_amount)
	if outstanding > 0:
		return outstanding
	return flt(folio.total_charges) + flt(folio.total_taxes_estimated) - flt(folio.total_discounts)


def _ensure_razorpay_mode_of_payment():
	if frappe.db.exists("Mode of Payment", "Razorpay"):
		return "Razorpay"

	company = frappe.db.get_single_value("Global Defaults", "default_company")
	bank_account = frappe.db.get_value(
		"Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name"
	)
	doc = frappe.get_doc({"doctype": "Mode of Payment", "mode_of_payment": "Razorpay", "enabled": 1})
	if bank_account:
		doc.append("accounts", {"company": company, "default_account": bank_account})
	doc.insert(ignore_permissions=True)
	return "Razorpay"


def verify_signature(order_id, payment_id, signature, key_secret=None):
	"""Verify a Razorpay payment signature (HMAC-SHA256 of 'order_id|payment_id')."""
	key_secret = key_secret or _keys()[1]
	expected = hmac.new(
		key_secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256
	).hexdigest()
	return hmac.compare_digest(expected, signature or "")


@frappe.whitelist()
def create_order(guest_folio):
	"""Create a Razorpay order for a folio's payable amount; returns checkout params."""
	_require_login()
	key_id, key_secret = _keys()

	folio = frappe.get_doc("Guest Folio", guest_folio)
	amount = _folio_payable(folio)
	if amount <= 0:
		frappe.throw(_("Folio {0} has no payable amount.").format(guest_folio))

	amount_in_paise = int(round(amount * 100))
	response = requests.post(
		RAZORPAY_ORDERS_URL,
		auth=(key_id, key_secret),
		json={
			"amount": amount_in_paise,
			"currency": folio.currency or "INR",
			"receipt": guest_folio,
			"notes": {"guest_folio": guest_folio},
		},
		timeout=30,
	)
	response.raise_for_status()
	order = response.json()

	return {
		"order_id": order["id"],
		"amount": amount_in_paise,
		"currency": order.get("currency", "INR"),
		"key_id": key_id,
		"guest_folio": guest_folio,
	}


@frappe.whitelist()
def capture_payment(guest_folio, razorpay_order_id, razorpay_payment_id, razorpay_signature, amount):
	"""Verify the Razorpay signature, then settle the folio with the captured payment."""
	_require_login()

	if not verify_signature(razorpay_order_id, razorpay_payment_id, razorpay_signature):
		frappe.throw(_("Razorpay signature verification failed."))

	mode_of_payment = _ensure_razorpay_mode_of_payment()
	return settle_folio(
		guest_folio,
		payments=[
			{
				"mode_of_payment": mode_of_payment,
				"amount": flt(amount),
				"reference_no": razorpay_payment_id,
			}
		],
		idempotency_key=f"razorpay:{razorpay_payment_id}",
	)
