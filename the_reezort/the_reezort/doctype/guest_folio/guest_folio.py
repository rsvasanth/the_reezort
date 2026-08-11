import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class GuestFolio(Document):
	def validate(self):
		self.validate_single_primary_folio()

	def validate_single_primary_folio(self):
		if not self.stay or not self.primary_folio:
			return

		filters = {"stay": self.stay, "primary_folio": 1}
		if self.name:
			filters["name"] = ["!=", self.name]

		if frappe.db.exists("Guest Folio", filters):
			frappe.throw(_("Only one primary folio is allowed for a stay."))

	def recalculate_totals(self, exclude_line=None):
		filters = {"guest_folio": self.name, "line_status": ["!=", "Voided"]}
		if exclude_line:
			filters["name"] = ["!=", exclude_line]

		lines = frappe.get_all(
			"Folio Line",
			filters=filters,
			fields=["line_type", "amount", "discount_amount"],
		)

		total_charges = 0
		total_discounts = 0
		total_taxes_estimated = 0
		total_paid = 0

		for line in lines:
			amount = flt(line.amount)
			discount_amount = flt(line.discount_amount)

			if line.line_type == "Charge":
				total_charges += amount
				total_discounts += discount_amount
			elif line.line_type == "Discount":
				total_discounts += amount
			elif line.line_type == "Tax Preview":
				total_taxes_estimated += amount
			elif line.line_type in ("Payment Reference", "Deposit Application"):
				total_paid += amount

		outstanding_amount = total_charges + total_taxes_estimated - total_discounts - total_paid

		self.total_charges = total_charges
		self.total_discounts = total_discounts
		self.total_taxes_estimated = total_taxes_estimated
		self.total_paid = total_paid
		self.outstanding_amount = outstanding_amount
		self.balance_status = self._balance_status(outstanding_amount, total_charges, total_paid)

	def _balance_status(self, outstanding_amount, total_charges, total_paid):
		if outstanding_amount > 0:
			return "Outstanding"
		if outstanding_amount < 0:
			return "Credit Balance"
		if total_charges or total_paid:
			return "Settled"
		return "No Balance"
