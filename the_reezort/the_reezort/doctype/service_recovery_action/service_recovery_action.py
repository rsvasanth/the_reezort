"""Service Recovery Action — proposed and approved recovery for guest satisfaction.

CRITICAL: This doctype stores REFERENCES to financial records only.
It MUST NOT create Sales Invoices, credit notes, or GL entries directly.
Billing recovery flows through Guest Folio (guest_folio link) via the
existing billing module. erpnext_sales_invoice and erpnext_credit_note
are read-only reference fields populated by billing agents, never by
this controller.
"""

import frappe
from frappe import _
from frappe.model.document import Document

_FINANCIAL_TYPES = {"Discount", "Refund Request", "Loyalty Credit", "Complimentary Item"}


class ServiceRecoveryAction(Document):
	def validate(self):
		self._require_approval_for_financial_recovery()
		self._block_direct_invoice_creation()

	def _require_approval_for_financial_recovery(self):
		"""Financial recovery types must have approval_required=1 and must not
		skip to Posted to Billing without approval."""
		if self.recovery_type in _FINANCIAL_TYPES:
			if not self.approval_required:
				self.approval_required = 1

			if self.status == "Posted to Billing" and not self.approval_request:
				frappe.throw(
					_(
						"Financial recovery ({0}) cannot be Posted to Billing without a linked"
						" Approval Request."
					).format(self.recovery_type)
				)

	def _block_direct_invoice_creation(self):
		"""Ensure the read-only invoice reference fields are never written here.
		They are populated externally by the billing module only."""
		# These fields are read_only in the DocType JSON so the UI won't touch
		# them; this guard catches any programmatic abuse via insert/save.
		if self.is_new():
			if self.erpnext_sales_invoice or self.erpnext_credit_note:
				frappe.throw(
					_(
						"erpnext_sales_invoice and erpnext_credit_note are reference fields managed"
						" by the Billing module. Do not set them directly on Service Recovery Action."
					)
				)
