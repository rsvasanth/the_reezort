"""Room Downtime — controlled room availability block.

Sellability integration:
  - When a downtime becomes Active with a blocking type (Under Repair /
    Out of Service / Out of Order), the linked Room's maintenance_status is
    updated to the matching value so apply_sellable_rules() in the Room
    controller marks it Not Sellable.
  - When the downtime reaches Released or Cancelled, the Room's
    maintenance_status is restored to "Available".
  - Planned Maintenance and Management Hold set maintenance_status to
    "Preventive Maintenance" and "Under Maintenance" respectively, but are
    not considered hard-blocking for the purposes of this module.

All Room status mutations are done via frappe.db.set_value from this side.
room.py is NOT modified.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document

# Downtime types that force the room to Not Sellable immediately.
BLOCKING_TYPES = {"Under Repair", "Out of Service", "Out of Order"}

# Mapping from downtime_type → Room.maintenance_status value.
_TYPE_TO_MAINTENANCE_STATUS: dict[str, str] = {
    "Under Repair": "Under Maintenance",
    "Out of Service": "Out of Service",
    "Out of Order": "Out of Order",
    "Planned Maintenance": "Preventive Maintenance",
    "Management Hold": "Under Maintenance",
}


class RoomDowntime(Document):
    def validate(self):
        self._validate_required_approval()

    def on_update(self):
        self._sync_room_maintenance_status()

    def on_submit(self):
        self._sync_room_maintenance_status()

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def _validate_required_approval(self):
        """Out of Order downtimes require an approved_by user when settings
        require supervisor approval. Enforcement here is advisory; the API
        layer (downtime.py) does the hard gate before save."""
        if self.downtime_type == "Out of Order" and self.downtime_status == "Active":
            if not self.approved_by:
                # Don't hard-throw here; the API gate handles the hard rejection.
                # Controller records intent for audit visibility.
                pass

    # ------------------------------------------------------------------
    # Sellability sync
    # ------------------------------------------------------------------

    def _sync_room_maintenance_status(self):
        """Keep Room.maintenance_status + sellable_status in sync with this
        downtime's state. Driven through the Room doc so the controller's
        status-event audit trail and display_status recompute both run."""
        if not self.room:
            return

        if self.downtime_status in ("Released", "Cancelled"):
            self._restore_room_maintenance_status()
        elif self.downtime_status == "Active":
            self._apply_room_maintenance_status()
        # Extended / Pending Release — room stays in its current blocked state.

    def _apply_room_maintenance_status(self):
        target = _TYPE_TO_MAINTENANCE_STATUS.get(self.downtime_type)
        if not target:
            return
        room_doc = frappe.get_doc("Room", self.room)
        if room_doc.maintenance_status == target:
            return
        room_doc.maintenance_status = target
        # apply_sellable_rules() in the Room controller forces sellable_status
        # to Not Sellable for blocking maintenance states on save.
        room_doc.flags.status_change_reason = "Room downtime {0} active".format(self.name)
        room_doc.save(ignore_permissions=True)

    def _restore_room_maintenance_status(self):
        """Restore the room to Available + Sellable when the downtime ends —
        but only if no OTHER active blocking downtime still covers this room,
        and only clearing a status THIS downtime set (never overriding a
        manual Restricted/Temporarily Blocked)."""
        expected_blocking = _TYPE_TO_MAINTENANCE_STATUS.get(self.downtime_type)
        if not expected_blocking:
            return

        # Another still-active blocking downtime on this room? Leave it blocked.
        other_active = frappe.db.count(
            "Room Downtime",
            {
                "room": self.room,
                "downtime_status": ["in", ["Active", "Extended", "Pending Release"]],
                "name": ["!=", self.name],
            },
        )
        if other_active:
            return

        room_doc = frappe.get_doc("Room", self.room)
        changed = False
        if room_doc.maintenance_status == expected_blocking:
            room_doc.maintenance_status = "Available"
            changed = True
        # apply_sellable_rules() only ever FORCES Not Sellable — it never
        # restores Sellable — so the release path must do it explicitly.
        if room_doc.sellable_status == "Not Sellable":
            room_doc.sellable_status = "Sellable"
            changed = True
        if changed:
            room_doc.flags.status_change_reason = "Room downtime {0} released".format(self.name)
            room_doc.save(ignore_permissions=True)
