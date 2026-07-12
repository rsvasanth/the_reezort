import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


class GuestConsent(Document):
    def validate(self):
        if not self.captured_at:
            self.captured_at = now_datetime()
        if self.status == "Withdrawn" and not self.withdrawn_at:
            self.withdrawn_at = now_datetime()
