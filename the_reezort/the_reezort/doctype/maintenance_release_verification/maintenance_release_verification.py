"""Maintenance Release Verification — sign-off before room returns to service."""

from __future__ import annotations

import frappe
from frappe.model.document import Document


class MaintenanceReleaseVerification(Document):
    def validate(self):
        if not self.verified_by:
            self.verified_by = frappe.session.user
        if not self.verified_at:
            from frappe.utils import now_datetime
            self.verified_at = now_datetime()
