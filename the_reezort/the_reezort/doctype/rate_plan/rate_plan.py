# Copyright (c) 2026, THE REEZORT and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class RatePlan(Document):
	def validate(self):
		if self.code:
			self.code = self.code.upper().strip()
