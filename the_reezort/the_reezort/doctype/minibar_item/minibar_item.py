from frappe.model.document import Document


class MinibarItem(Document):
	def validate(self):
		if self.item_code_short:
			self.item_code_short = self.item_code_short.upper().strip()
		if self.price is not None and float(self.price) < 0:
			from frappe import ValidationError, _
			raise ValidationError(_("Unit price must not be negative."))
