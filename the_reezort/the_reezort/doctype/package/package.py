# Copyright (c) 2026, THE REEZORT and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class Package(Document):
	def validate(self):
		if self.code:
			self.code = self.code.upper().strip()
		if self.package_price and self.package_price < 0:
			frappe.throw(_("Package Price cannot be negative."))
