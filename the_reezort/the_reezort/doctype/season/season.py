# Copyright (c) 2026, THE REEZORT and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class Season(Document):
	def validate(self):
		if self.code:
			self.code = self.code.upper().strip()
		if self.end_date and self.start_date and getdate(self.end_date) < getdate(self.start_date):
			frappe.throw(_("End Date must be on or after Start Date."))
