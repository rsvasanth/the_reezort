"""Service SLA Rule — priority/department/guest-status-aware SLA configuration."""

import frappe
from frappe import _
from frappe.model.document import Document


class ServiceSlaRule(Document):
    def validate(self):
        if (self.response_minutes or 0) <= 0:
            frappe.throw(_("Response SLA minutes must be greater than zero."))
        if (self.resolution_minutes or 0) <= 0:
            frappe.throw(_("Resolution SLA minutes must be greater than zero."))
        if (self.response_minutes or 0) > (self.resolution_minutes or 0):
            frappe.throw(_("Response SLA minutes cannot exceed Resolution SLA minutes."))
