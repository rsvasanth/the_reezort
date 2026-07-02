from frappe.model.document import Document


class LinenItem(Document):
	def validate(self):
		if self.item_code_short:
			self.item_code_short = self.item_code_short.upper().strip()
		if self.unit_cost is not None and float(self.unit_cost) < 0:
			from frappe import ValidationError, _
			raise ValidationError(_("Unit cost must not be negative."))
