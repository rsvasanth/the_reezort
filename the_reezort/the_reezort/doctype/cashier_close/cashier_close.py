import frappe
from frappe.model.document import Document
from frappe.utils import flt


class CashierClose(Document):
	def validate(self):
		self.roll_up_totals()

	def roll_up_totals(self):
		"""Keep per-row variance and the header totals in sync with declarations."""
		expected = 0.0
		declared = 0.0
		for row in self.payments:
			row.variance = flt(row.declared_amount) - flt(row.expected_amount)
			expected += flt(row.expected_amount)
			declared += flt(row.declared_amount)
		self.expected_total = expected
		# Only reflect declared totals once the cashier has started declaring.
		if any(row.declared_amount not in (None, "") for row in self.payments):
			self.declared_total = declared
			self.variance_amount = declared - expected
