from frappe.model.document import Document


class FnBOutlet(Document):
	def validate(self):
		if self.outlet_code:
			self.outlet_code = self.outlet_code.upper().strip()
