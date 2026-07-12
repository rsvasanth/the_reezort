import frappe
from frappe.model.document import Document


class LoyaltyMembership(Document):
    def validate(self):
        if not self.joined_on:
            self.joined_on = frappe.utils.today()
