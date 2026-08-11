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

from the_reezort.billing.api import _envelope
from the_reezort.billing.deposits import record_deposit
from the_reezort.billing.settlement import settle_folio

RAZORPAY_ORDERS_URL = "https://api.razorpay.com/v1/orders"
RAZORPAY_PAYMENTS_URL = "https://api.razorpay.com/v1/payments"


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


def _authoritative_amount(payment_id, order_id):
	"""Fetch the real captured amount from Razorpay — never trust the client.

	The SPA callback supplies an ``amount`` that an attacker can tamper with
	after a valid low-value payment. We re-fetch the payment server-side and use
	Razorpay's own figure, asserting the payment succeeded and belongs to the
	order we created.
	"""
	key_id, key_secret = _keys()
	response = requests.get(
		f"{RAZORPAY_PAYMENTS_URL}/{payment_id}",
		auth=(key_id, key_secret),
		timeout=30,
	)
	response.raise_for_status()
	payment = response.json()

	if payment.get("order_id") != order_id:
		frappe.throw(_("Razorpay payment does not belong to the presented order."))
	if payment.get("status") not in ("captured", "authorized"):
		frappe.throw(_("Razorpay payment is not in a captured state."))

	return flt(payment.get("amount")) / 100.0


def _authoritative_order_notes(order_id):
	"""Fetch the Order's own notes from Razorpay — never trust the client.

	The signature check only proves this payment_id genuinely belongs to this
	order_id; it says nothing about which folio the order was created for. A
	caller can pair a valid signature from a payment on THEIR OWN folio with a
	different guest_folio argument. The notes recorded at order-creation time
	(create_order/create_deposit_order) are the only authoritative record of
	what the order was actually for — verify against those, not the argument.
	"""
	key_id, key_secret = _keys()
	response = requests.get(
		f"{RAZORPAY_ORDERS_URL}/{order_id}",
		auth=(key_id, key_secret),
		timeout=30,
	)
	response.raise_for_status()
	return response.json().get("notes") or {}


def _verify_order_is_for(order_id, expected_value, intent, key="guest_folio"):
	notes = _authoritative_order_notes(order_id)
	if notes.get(key) != expected_value or notes.get("intent") != intent:
		frappe.throw(_("Razorpay order does not match this record."), frappe.PermissionError)


def _create_order(amount, currency, receipt, notes):
	"""Create a Razorpay order and return the checkout params."""
	key_id, key_secret = _keys()
	amount_in_paise = int(round(flt(amount) * 100))
	response = requests.post(
		RAZORPAY_ORDERS_URL,
		auth=(key_id, key_secret),
		json={
			"amount": amount_in_paise,
			"currency": currency or "INR",
			"receipt": receipt,
			"notes": notes,
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
	}


@frappe.whitelist()
def create_order(guest_folio):
	"""Create a Razorpay order for a folio's full payable amount (settlement path)."""
	_require_login()
	folio = frappe.get_doc("Guest Folio", guest_folio)
	amount = _folio_payable(folio)
	if amount <= 0:
		frappe.throw(_("Folio {0} has no payable amount.").format(guest_folio))
	order = _create_order(amount, folio.currency, guest_folio, {"guest_folio": guest_folio, "intent": "settle"})
	order["guest_folio"] = guest_folio
	return _envelope(order)


@frappe.whitelist()
def create_deposit_order(guest_folio, amount):
	"""Create a Razorpay order for a specific DEPOSIT amount (advance, not settle).

	The capture step posts a real advance Payment Entry via record_deposit; no
	Sales Invoice is created until the folio actually settles.
	"""
	_require_login()
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Deposit amount must be positive."))
	folio = frappe.get_doc("Guest Folio", guest_folio)
	order = _create_order(
		amount, folio.currency, f"DEP-{guest_folio}", {"guest_folio": guest_folio, "intent": "deposit"}
	)
	order["guest_folio"] = guest_folio
	return _envelope(order)


@frappe.whitelist()
def capture_payment(guest_folio, razorpay_order_id, razorpay_payment_id, razorpay_signature, amount):
	"""Verify the Razorpay signature, then settle the folio with the captured payment."""
	_require_login()

	if not verify_signature(razorpay_order_id, razorpay_payment_id, razorpay_signature):
		frappe.throw(_("Razorpay signature verification failed."))

	# A valid signature only proves this payment belongs to this order — it does
	# not prove the order was created for THIS folio. Without this check, a
	# genuine payment on the caller's own folio could be replayed with a
	# different guest_folio argument to settle someone else's balance.
	_verify_order_is_for(razorpay_order_id, guest_folio, intent="settle")

	# Ignore the client-supplied amount — derive it from Razorpay directly so a
	# tampered callback cannot over-credit the folio.
	captured_amount = _authoritative_amount(razorpay_payment_id, razorpay_order_id)

	mode_of_payment = _ensure_razorpay_mode_of_payment()
	return settle_folio(
		guest_folio,
		payments=[
			{
				"mode_of_payment": mode_of_payment,
				"amount": captured_amount,
				"reference_no": razorpay_payment_id,
			}
		],
		idempotency_key=f"razorpay:{razorpay_payment_id}",
	)


@frappe.whitelist()
def capture_deposit(guest_folio, razorpay_order_id, razorpay_payment_id, razorpay_signature, amount):
	"""Verify the Razorpay signature, then record an advance deposit on the folio.

	Idempotent on the Razorpay payment id (a duplicate callback returns the same
	deposit line + PE instead of double-posting).
	"""
	_require_login()

	if not verify_signature(razorpay_order_id, razorpay_payment_id, razorpay_signature):
		frappe.throw(_("Razorpay signature verification failed."))

	# See capture_payment — a valid signature alone doesn't prove this order
	# was created for THIS folio's deposit.
	_verify_order_is_for(razorpay_order_id, guest_folio, intent="deposit")

	# Ignore the client-supplied amount — derive it from Razorpay directly so a
	# tampered callback cannot over-credit the deposit.
	captured_amount = _authoritative_amount(razorpay_payment_id, razorpay_order_id)

	mode_of_payment = _ensure_razorpay_mode_of_payment()
	return record_deposit(
		guest_folio=guest_folio,
		amount=captured_amount,
		mode_of_payment=mode_of_payment,
		reference_no=razorpay_payment_id,
		idempotency_key=f"razorpay-deposit:{razorpay_payment_id}",
	)
