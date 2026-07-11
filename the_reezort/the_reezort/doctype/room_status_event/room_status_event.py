"""Room Status Event — append-only audit trail for Room status field changes.

Created exclusively by the Room controller's on_update() hook (and tests). Never
edited after insert. The before_save guard enforces append-only semantics even if
someone tries to save an existing record through the Frappe desk.
"""

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime

from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission


class RoomStatusEvent(Document):
    def before_insert(self):
        """Default changed_by and changed_at at insert time if not already set."""
        if not self.changed_at:
            self.changed_at = now_datetime()
        if not self.changed_by:
            self.changed_by = frappe.session.user

    def before_save(self):
        """Block all updates — this doctype is append-only."""
        if not self.is_new():
            frappe.throw(
                _("Room Status Events are append-only and cannot be modified after creation."),
                frappe.ValidationError,
            )


@frappe.whitelist()
def list_room_status_events(room, page=1, page_size=20):
    """Return a paginated, most-recent-first audit log of status changes for a room.

    Args:
        room (str): The Room document name.
        page (int): 1-based page number. Default 1.
        page_size (int): Records per page (1-100). Default 20.

    Returns:
        Envelope with keys: room, total, page, page_size, events (list).
        Each event has: name, event_type, previous_value, new_value,
        reason, changed_by, changed_at.
    """
    _require_permission("Room Status Event", "read")

    page = max(1, int(page))
    page_size = max(1, min(int(page_size), 100))
    offset = (page - 1) * page_size

    total = frappe.db.count("Room Status Event", filters={"room": room})
    events = frappe.get_all(
        "Room Status Event",
        filters={"room": room},
        fields=[
            "name",
            "event_type",
            "previous_value",
            "new_value",
            "reason",
            "changed_by",
            "changed_at",
        ],
        order_by="changed_at desc, creation desc",
        limit=page_size,
        start=offset,
    )

    return _envelope(
        {
            "room": room,
            "total": total,
            "page": page,
            "page_size": page_size,
            "events": events,
        }
    )
