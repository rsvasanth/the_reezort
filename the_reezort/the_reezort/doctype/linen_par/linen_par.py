from frappe.model.document import Document


class LinenPar(Document):
	def validate(self):
		if not self.room and not self.room_type:
			from frappe import ValidationError, _
			raise ValidationError(_("Linen Par needs either a Room or a Room Type."))
		if self.par_quantity is not None and int(self.par_quantity) < 0:
			from frappe import ValidationError, _
			raise ValidationError(_("Par quantity must not be negative."))
