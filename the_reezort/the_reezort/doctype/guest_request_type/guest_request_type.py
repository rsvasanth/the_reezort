"""Guest Request Type — routing catalog for guest service requests."""

import frappe
from frappe import _
from frappe.model.document import Document


class GuestRequestType(Document):
    def validate(self):
        if not self.request_type_code:
            frappe.throw(_("Request Type Code is required."))
        self.request_type_code = self.request_type_code.strip().upper()
