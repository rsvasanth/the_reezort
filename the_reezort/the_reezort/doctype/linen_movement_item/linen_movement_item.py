from frappe.model.document import Document


class LinenMovementItem(Document):
	def validate(self):
		from frappe import ValidationError, _

		for f in ("par", "found", "damaged", "missing"):
			v = self.get(f)
			if v is not None and int(v) < 0:
				raise ValidationError(_("{0} must not be negative.").format(f.title()))
