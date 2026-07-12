import frappe
from frappe.model.document import Document


class ResortLoyaltyProgram(Document):
    def validate(self):
        if self.expiry_months is not None and self.expiry_months < 0:
            frappe.throw(frappe._("Expiry months cannot be negative."))
