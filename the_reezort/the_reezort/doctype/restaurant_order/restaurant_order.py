import frappe
from frappe.model.document import Document
from frappe.utils import flt


class RestaurantOrder(Document):
	def validate(self):
		self.recompute_totals()

	def recompute_totals(self):
		"""Roll up child items into subtotal + service charge + tax + grand total.

		Tax rate defaults to the company sales-tax rate (18% GST) via
		billing.erpnext_posting.default_sales_tax_rate. Service charge % is
		snapshotted from FnB Outlet at open time and doesn't shift after that.
		"""
		subtotal = 0
		for item in self.items or []:
			item.amount = flt(item.quantity) * flt(item.rate)
			subtotal += flt(item.amount)

		self.subtotal = subtotal
		self.service_charge_amount = flt(subtotal) * flt(self.service_charge_pct) / 100.0
		taxable = flt(subtotal) - flt(self.discount_amount) + flt(self.service_charge_amount)
		self.total_taxes = flt(taxable) * self._tax_rate() / 100.0
		self.grand_total = taxable + flt(self.total_taxes)

	def _tax_rate(self):
		if not self.resort_property:
			return 0
		company = frappe.db.get_value("Resort Property", self.resort_property, "company") or frappe.db.get_single_value(
			"Global Defaults", "default_company"
		)
		if not company:
			return 0
		try:
			from the_reezort.billing.erpnext_posting import default_sales_tax_rate

			return flt(default_sales_tax_rate(company))
		except Exception:
			return 0
