from frappe.model.document import Document
from frappe.utils import flt


class FnBOrder(Document):
	def validate(self):
		total = 0.0
		for row in self.items or []:
			row.amount = flt(row.quantity) * flt(row.rate)
			total += flt(row.amount)
		self.total_amount = round(total, 2)
