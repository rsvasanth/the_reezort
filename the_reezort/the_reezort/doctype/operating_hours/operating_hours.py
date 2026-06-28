import frappe
from frappe import _
from frappe.model.document import Document


class OperatingHours(Document):
	def validate(self):
		if self.is_closed:
			return

		if not self.opens_at or not self.closes_at:
			frappe.throw(_("Opening and closing time are required unless the location is closed."))
