import frappe
from frappe.model.document import Document


class LoyaltyTransaction(Document):
    def validate(self):
        if self.transaction_type == "Adjustment" and not self.reason:
            frappe.throw(frappe._("Reason is required for Adjustment transactions."))
