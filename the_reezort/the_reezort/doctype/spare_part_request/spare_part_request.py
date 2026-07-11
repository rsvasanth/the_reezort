# Copyright (c) 2026, The Reezort and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


VALID_TRANSITIONS = {
    "Draft": {"Requested", "Cancelled"},
    "Requested": {"Approved", "Rejected", "Cancelled"},
    "Approved": {"Issued", "Partially Issued", "Material Requested", "Cancelled"},
    "Partially Issued": {"Issued", "Material Requested"},
    "Material Requested": {"Approved", "Cancelled"},
}


class SparePartRequest(Document):
    def validate(self):
        self._set_defaults()
        self._validate_lines()

    def _set_defaults(self):
        if not self.requested_by:
            self.requested_by = frappe.session.user
        if not self.request_status:
            self.request_status = "Draft"

    def _validate_lines(self):
        if not self.lines:
            frappe.throw(_("At least one spare part line is required."))
        for row in self.lines:
            if not row.item_code:
                frappe.throw(_("Item Code is required in every spare part line."))
            if flt(row.requested_qty) <= 0:
                frappe.throw(_("Requested Qty must be greater than zero in row {0}.").format(row.idx))

    def transition_to(self, new_status: str):
        allowed = VALID_TRANSITIONS.get(self.request_status, set())
        if new_status not in allowed:
            frappe.throw(
                _("Cannot move Spare Part Request from {0} to {1}.").format(
                    self.request_status, new_status
                )
            )
        self.request_status = new_status
        self.save(ignore_permissions=True)


def flt(val):
    try:
        return float(val or 0)
    except (TypeError, ValueError):
        return 0.0
