import frappe
from frappe import _
from frappe.model.document import Document


class ResortProperty(Document):
	def validate(self):
		self.validate_company()

	def validate_company(self):
		if not self.company:
			return

		if not frappe.db.has_column("Company", "disabled"):
			return

		disabled = frappe.db.get_value("Company", self.company, "disabled")

		if disabled:
			frappe.throw(
				_("Company {0} is disabled.").format(frappe.bold(self.company)),
				title=_("Invalid Company"),
			)
