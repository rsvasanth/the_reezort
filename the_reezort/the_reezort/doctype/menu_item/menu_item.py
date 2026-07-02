from frappe.model.document import Document


class MenuItem(Document):
	def validate(self):
		if self.item_code_short:
			self.item_code_short = self.item_code_short.upper().strip()
		if self.price is not None and float(self.price) < 0:
			from frappe import ValidationError, _
			raise ValidationError(_("Price must not be negative."))
		if self.spice_level is not None:
			lvl = int(self.spice_level)
			if lvl < 0 or lvl > 3:
				from frappe import ValidationError, _
				raise ValidationError(_("Spice level must be 0-3."))
