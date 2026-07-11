import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime

from the_reezort.the_reezort.doctype.validators import (
    validate_active_parent,
    validate_link_property,
    validate_unique_within,
)

MAINTENANCE_BLOCKING_STATUSES = {"Under Maintenance", "Out of Order", "Out of Service"}

# Maps the four audited Room field names to the event_type label stored in
# Room Status Event. The label is the human-readable value used in the Select
# field options of Room Status Event.
_STATUS_FIELD_TO_EVENT_TYPE = {
    "occupancy_status": "Occupancy",
    "housekeeping_status": "Housekeeping",
    "maintenance_status": "Maintenance",
    "sellable_status": "Sellable",
}


class Room(Document):
    def validate(self):
        self.validate_parent_property()
        self.validate_active_parents()
        self.validate_room_number()
        self.validate_connections()
        self.apply_sellable_rules()
        self.set_display_status()
        self._detect_status_changes()

    def on_trash(self):
        self._guard_historical_records()

    def on_update(self):
        self._write_status_events()

    # ------------------------------------------------------------------ #
    # Existing validation cascade (unchanged)                              #
    # ------------------------------------------------------------------ #

    def validate_parent_property(self):
        validate_link_property("Resort Building", self.building, self.resort_property, "Building")
        validate_link_property("Resort Floor", self.floor, self.resort_property, "Floor")
        validate_link_property("Room Type", self.room_type, self.resort_property, "Room Type")

    def validate_active_parents(self):
        validate_active_parent("Resort Property", self.resort_property, "Resort Property")
        validate_active_parent("Resort Building", self.building, "Building")
        validate_active_parent("Resort Floor", self.floor, "Floor")
        validate_active_parent("Room Type", self.room_type, "Room Type")

    def validate_room_number(self):
        from the_reezort.the_reezort.doctype.property_settings.property_settings import (
            _room_uniqueness_filters as _uniq_filters,
        )

        validate_unique_within(
            "Room",
            "room_number",
            self.room_number,
            _uniq_filters(self.resort_property, self.building),
            None if self.is_new() else self.name,
        )

    def validate_connections(self):
        for row in self.connecting_rooms:
            if row.connected_room == self.name:
                frappe.throw(_("Connected room cannot be the same room."), title=_("Invalid Connection"))

            validate_link_property("Room", row.connected_room, self.resort_property, "Connected Room")

    def apply_sellable_rules(self):
        if self.maintenance_status in MAINTENANCE_BLOCKING_STATUSES and self.sellable_status == "Sellable":
            self.sellable_status = "Not Sellable"

    def set_display_status(self):
        if self.maintenance_status in MAINTENANCE_BLOCKING_STATUSES:
            self.display_status = self.maintenance_status
            return

        if self.sellable_status != "Sellable":
            self.display_status = self.sellable_status
            return

        parts = [self.occupancy_status, self.housekeeping_status]
        self.display_status = " ".join(part for part in parts if part)

    # ------------------------------------------------------------------ #
    # Status change detection (validate) → event writing (on_update)      #
    # ------------------------------------------------------------------ #

    def _detect_status_changes(self):
        """Compare current status fields against the pre-save state and
        store detected changes on self._status_changes for on_update() to
        persist.  Must run inside validate() because get_doc_before_save()
        is only reliable during the validate/before_save phase.
        """
        changes = []

        if self.is_new():
            # Record initial values for every status field that is set so
            # the audit trail is complete from day one.
            for field, event_type in _STATUS_FIELD_TO_EVENT_TYPE.items():
                new_val = getattr(self, field) or ""
                if new_val:
                    changes.append(
                        {
                            "event_type": event_type,
                            "previous_value": "",
                            "new_value": new_val,
                        }
                    )
        else:
            before = self.get_doc_before_save()
            if before:
                for field, event_type in _STATUS_FIELD_TO_EVENT_TYPE.items():
                    old_val = getattr(before, field) or ""
                    new_val = getattr(self, field) or ""
                    if old_val != new_val:
                        changes.append(
                            {
                                "event_type": event_type,
                                "previous_value": old_val,
                                "new_value": new_val,
                            }
                        )

        self._status_changes = changes

    def _write_status_events(self):
        """Insert one Room Status Event per changed status field.

        Reads self._status_changes populated by _detect_status_changes() during
        validate().  Reason is picked up from self.flags.status_change_reason
        when set by the calling layer (e.g. management.update_record).
        """
        changes = getattr(self, "_status_changes", [])
        if not changes:
            return

        reason = self.flags.get("status_change_reason") or ""
        changed_by = frappe.session.user
        changed_at = now_datetime()

        for change in changes:
            frappe.get_doc(
                {
                    "doctype": "Room Status Event",
                    "room": self.name,
                    "resort_property": self.resort_property,
                    "event_type": change["event_type"],
                    "previous_value": change["previous_value"],
                    "new_value": change["new_value"],
                    "reason": reason,
                    "changed_by": changed_by,
                    "changed_at": changed_at,
                }
            ).insert(ignore_permissions=True)

    # ------------------------------------------------------------------ #
    # Deletion guard                                                       #
    # ------------------------------------------------------------------ #

    # (doctype, room-link fieldname, human label). Guest Folio is covered
    # transitively — a folio cannot exist without a Stay, which is checked.
    _HISTORY_LINKS = (
        ("Reservation Room", "room", "reservation"),
        ("Stay", "current_room", "stay"),
        ("Housekeeping Task", "room", "housekeeping task"),
        ("Maintenance Ticket", "room", "maintenance ticket"),
    )

    def _guard_historical_records(self):
        """Block hard-deleting a room that carries operational history — the
        spec prohibits it and requires suggesting deactivation instead
        (spec 001 §Rooms, acceptance: delete-with-history → blocked)."""
        blocking = []
        for doctype, field, label in self._HISTORY_LINKS:
            if not frappe.db.exists("DocType", doctype):
                continue
            if frappe.db.count(doctype, {field: self.name}):
                blocking.append(label)

        # Room Move references the room from either side of a switch.
        if frappe.db.exists("DocType", "Room Move") and frappe.db.count(
            "Room Move", {"from_room": self.name}
        ) + frappe.db.count("Room Move", {"to_room": self.name}):
            blocking.append("room move")

        if blocking:
            frappe.throw(
                _(
                    "Room {0} has historical records ({1}) and cannot be deleted. "
                    "Deactivate it instead — it stays in reports but is hidden "
                    "from operational selection."
                ).format(self.name, ", ".join(sorted(set(blocking)))),
                frappe.ValidationError,
                title=_("Deletion Blocked"),
            )
