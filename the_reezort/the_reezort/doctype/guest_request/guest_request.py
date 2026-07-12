"""Guest Request — primary guest service coordination record."""

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime

_TERMINAL_STATUSES = frozenset({"Closed", "Cancelled", "Completed", "Verified"})

# Valid forward transitions (status -> set of allowed next statuses)
_VALID_TRANSITIONS = {
    "New": {"Acknowledged", "Assigned", "In Progress", "Cancelled"},
    "Acknowledged": {"Assigned", "In Progress", "Cancelled"},
    "Assigned": {"In Progress", "Waiting for Department", "Waiting for Vendor", "Escalated", "Cancelled"},
    "In Progress": {"Waiting for Guest", "Waiting for Department", "Waiting for Vendor", "Escalated", "Completed", "Cancelled"},
    "Waiting for Guest": {"In Progress", "Completed", "Cancelled", "Escalated"},
    "Waiting for Department": {"In Progress", "Escalated", "Cancelled"},
    "Waiting for Vendor": {"In Progress", "Escalated", "Cancelled"},
    "Escalated": {"In Progress", "Completed", "Cancelled"},
    "Completed": {"Verified", "Reopened", "Closed"},
    "Verified": {"Closed", "Reopened"},
    "Reopened": {"Assigned", "In Progress", "Cancelled"},
    "Closed": set(),
    "Cancelled": set(),
}


class GuestRequest(Document):
    def validate(self):
        self._validate_guest_context()
        self._validate_closed_requires_completion()
        self._set_timestamps()

    def _validate_guest_context(self):
        has_context = any([
            self.guest_profile,
            self.stay,
            self.reservation,
            self.room,
        ])
        if not has_context:
            frappe.throw(
                _(
                    "Guest Request must have at least one of: Guest Profile, Stay, "
                    "Reservation, or Room."
                ),
                title=_("Missing Guest Context"),
            )

    def _validate_closed_requires_completion(self):
        if self.status == "Closed" and not self.completed_at:
            frappe.throw(
                _("A request cannot be Closed without a completion record."),
                title=_("Incomplete Request"),
            )

    def _set_timestamps(self):
        now = now_datetime()
        if self.status == "Acknowledged" and not self.acknowledged_at:
            self.acknowledged_at = now
        if self.status in ("Completed", "Verified") and not self.completed_at:
            self.completed_at = now
        if self.status == "Closed" and not self.closed_at:
            self.closed_at = now
