"""Guest Profile — hospitality relationship record.

Enriched for module 012 (CRM / Loyalty / Feedback):
- status defaults to Active on creation
- full_name synced from guest_full_name when full_name is blank
- do_not_contact is managed by record_guest_consent endpoint (not here)
"""

import frappe
from frappe import _
from frappe.model.document import Document


class GuestProfile(Document):
    def validate(self):
        self._default_status()
        self._sync_full_name()

    def _default_status(self):
        if not self.status:
            self.status = "Active"

    def _sync_full_name(self):
        """Keep full_name in sync with guest_full_name so either field works."""
        if not self.full_name and self.guest_full_name:
            self.full_name = self.guest_full_name
        elif self.full_name and not self.guest_full_name:
            self.guest_full_name = self.full_name
