from frappe.model.document import Document
from frappe.utils import flt


class MinibarPostingItem(Document):
	def validate(self):
		if self.quantity is not None and int(self.quantity) < 0:
			from frappe import ValidationError, _
			raise ValidationError(_("Quantity must not be negative."))
		self.amount = flt(self.quantity) * flt(self.rate)
