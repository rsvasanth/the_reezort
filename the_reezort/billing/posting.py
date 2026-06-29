"""Idempotent ERPNext posting scaffold.

This module owns the posting-attempt lifecycle via the `ERPNext Posting Log`
DocType. It does NOT create any ERPNext financial documents itself — F4
settlement plugs the actual Sales Invoice / Payment Entry creation into
`run_posting` as the `operation` callback. The log guarantees that retrying an
already-posted idempotency key never re-runs the operation (no duplicate
invoices/payments).
"""

import json

import frappe
from frappe import _
from frappe.utils import now_datetime

POSTING_LOG = "ERPNext Posting Log"

# Maps the operation result keys to the posting log JSON fields.
RESULT_FIELDS = {
	"sales_invoices": "sales_invoices_json",
	"payment_entries": "payment_entries_json",
	"credit_notes": "credit_notes_json",
}


def get_or_create_posting_log(posting_type, source_doctype, source_name, idempotency_key):
	"""Return the posting log for an idempotency key, creating it as Pending if new."""
	if not idempotency_key:
		frappe.throw(_("An idempotency key is required for a posting log."))

	existing = frappe.db.get_value(POSTING_LOG, {"idempotency_key": idempotency_key}, "name")
	if existing:
		return frappe.get_doc(POSTING_LOG, existing)

	log = frappe.get_doc(
		{
			"doctype": POSTING_LOG,
			"posting_type": posting_type,
			"source_doctype": source_doctype,
			"source_name": source_name,
			"idempotency_key": idempotency_key,
			"posting_status": "Pending",
		}
	)
	log.insert(ignore_permissions=True)
	return log


def _stored_results(log):
	return {key: frappe.parse_json(log.get(field) or "[]") for key, field in RESULT_FIELDS.items()}


def run_posting(posting_type, source_doctype, source_name, idempotency_key, operation):
	"""Idempotently run an ERPNext posting operation under a posting log.

	`operation` is a zero-arg callable returning a dict with optional keys
	`sales_invoices` / `payment_entries` / `credit_notes` (lists of ERPNext
	document names). On success the log is marked Posted and the results stored;
	on failure it is marked Failed, the error recorded, `retry_count` incremented,
	and the exception re-raised. An already-Posted key short-circuits and reuses
	the stored result without calling `operation` again.

	Returns: {"posting_log", "posting_status", "results", "reused"}.
	"""
	log = get_or_create_posting_log(posting_type, source_doctype, source_name, idempotency_key)

	if log.posting_status == "Posted":
		return {
			"posting_log": log.name,
			"posting_status": log.posting_status,
			"results": _stored_results(log),
			"reused": True,
		}

	if log.posting_status == "Cancelled":
		frappe.throw(_("Posting log {0} is cancelled and cannot be re-run.").format(log.name))

	log.posting_status = "Processing"
	log.last_attempt_at = now_datetime()
	log.save(ignore_permissions=True)

	try:
		result = operation() or {}
	except Exception as exc:
		log.reload()
		log.posting_status = "Failed"
		log.error_message = str(exc)[:1000]
		log.retry_count = (log.retry_count or 0) + 1
		log.last_attempt_at = now_datetime()
		log.save(ignore_permissions=True)
		frappe.db.commit()
		raise

	log.reload()
	for key, field in RESULT_FIELDS.items():
		log.set(field, json.dumps(result.get(key) or []))
	log.error_message = None
	log.posting_status = "Posted"
	log.last_attempt_at = now_datetime()
	log.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"posting_log": log.name,
		"posting_status": log.posting_status,
		"results": _stored_results(log),
		"reused": False,
	}
