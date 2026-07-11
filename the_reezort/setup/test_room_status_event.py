"""Tests for Room Status Event audit trail and reason-enforcement.

Exercises:
  - Initial room creation logs events for each status field.
  - Any save path (direct doc.save) produces events for changed fields.
  - management.update_record requires reason when a status field is in payload.
  - Non-status field updates via update_record do not require reason.
  - Room Status Event is append-only (before_save guard).
  - list_room_status_events paginates correctly.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.setup import api, management
from the_reezort.the_reezort.doctype.room_status_event.room_status_event import (
    list_room_status_events,
)


class TestRoomStatusEvent(FrappeTestCase):
    """Tests run as Administrator (all permissions granted)."""

    # ------------------------------------------------------------------ #
    # Fixture                                                              #
    # ------------------------------------------------------------------ #

    def setUp(self):
        self.company = frappe.db.get_value("Company", {}, "name")
        prop = api.create_property(
            {
                "property_name": "ZZ RSE",
                "property_code": "ZZRSE",
                "company": self.company,
                "timezone": "Asia/Kolkata",
            }
        )["data"]["property"]["name"]
        self.prop = prop
        building = api.create_building(
            {"resort_property": prop, "building_name": "Block A", "building_code": "BLK-A"}
        )["data"]["building"]["name"]
        floor = api.create_floor(
            {
                "resort_property": prop,
                "building": building,
                "floor_label": "Ground",
                "floor_code": "G",
            }
        )["data"]["floor"]["name"]
        room_type = api.create_room_type(
            {
                "resort_property": prop,
                "room_type_name": "Deluxe",
                "room_type_code": "DLX",
                "standard_adults": 2,
                "max_occupancy": 2,
            }
        )["data"]["room_type"]["name"]
        api.create_rooms_bulk(
            {
                "resort_property": prop,
                "building": building,
                "floor": floor,
                "room_type": room_type,
                "room_numbers": ["SE101"],
            }
        )
        self.room_name = f"{prop}-SE101"

    # ------------------------------------------------------------------ #
    # Initial creation                                                     #
    # ------------------------------------------------------------------ #

    def test_initial_room_creation_logs_status_events(self):
        """Saving a new Room must produce at least one Room Status Event per
        status field that was set at creation time."""
        events = frappe.get_all(
            "Room Status Event",
            filters={"room": self.room_name},
            fields=["event_type", "previous_value", "new_value"],
        )
        # Rooms are created with default statuses; at minimum Occupancy should be logged.
        self.assertGreater(len(events), 0, "No Room Status Events found after room creation.")

        types = {e["event_type"] for e in events}
        # Whichever statuses the create path sets must be logged.
        self.assertTrue(
            types.intersection({"Occupancy", "Housekeeping", "Maintenance", "Sellable"}),
            f"Unexpected event types: {types}",
        )

        # Initial events must have an empty previous_value.
        for event in events:
            self.assertEqual(
                event["previous_value"],
                "",
                f"Expected empty previous_value for initial event, got {event['previous_value']!r}",
            )

    # ------------------------------------------------------------------ #
    # Direct doc.save path                                                 #
    # ------------------------------------------------------------------ #

    def test_direct_room_save_logs_event_without_reason(self):
        """Changing a status field via a bare doc.save (any code path) must
        still produce an audit event, even without a reason."""
        room_doc = frappe.get_doc("Room", self.room_name)
        # Choose a target value different from the current one.
        current_hk = room_doc.housekeeping_status or "Clean"
        new_hk = "Inspected" if current_hk != "Inspected" else "Clean"
        room_doc.housekeeping_status = new_hk
        room_doc.save(ignore_permissions=True)

        events = frappe.get_all(
            "Room Status Event",
            filters={"room": self.room_name, "event_type": "Housekeeping", "new_value": new_hk},
            fields=["name", "reason"],
        )
        self.assertEqual(len(events), 1, "Expected exactly one Housekeeping event after direct save.")
        # No reason was set via flags, so reason should be empty.
        self.assertEqual(events[0]["reason"] or "", "")

    def test_direct_save_does_not_create_event_when_status_unchanged(self):
        """Saving a Room without touching any status field must not create
        spurious audit events."""
        before_count = frappe.db.count("Room Status Event", filters={"room": self.room_name})
        room_doc = frappe.get_doc("Room", self.room_name)
        room_doc.room_name = "Lagoon View"
        room_doc.save(ignore_permissions=True)
        after_count = frappe.db.count("Room Status Event", filters={"room": self.room_name})
        self.assertEqual(before_count, after_count, "A non-status field change must not create new status events.")

    # ------------------------------------------------------------------ #
    # management.update_record — reason enforcement                        #
    # ------------------------------------------------------------------ #

    def test_update_record_with_reason_creates_event(self):
        """update_record with a status field and a reason must succeed and
        produce an event carrying that reason."""
        management.update_record(
            "Room",
            self.room_name,
            {"housekeeping_status": "Dirty", "reason": "Post-checkout turnover"},
        )
        events = frappe.get_all(
            "Room Status Event",
            filters={"room": self.room_name, "event_type": "Housekeeping", "new_value": "Dirty"},
            fields=["reason"],
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["reason"], "Post-checkout turnover")

    def test_update_record_status_without_reason_raises(self):
        """update_record must raise ValidationError when a status field is
        changed but no reason is provided."""
        with self.assertRaises(frappe.ValidationError):
            management.update_record(
                "Room",
                self.room_name,
                {"housekeeping_status": "Dirty"},
            )

    def test_update_record_maintenance_status_without_reason_raises(self):
        """Maintenance status changes also require a reason."""
        with self.assertRaises(frappe.ValidationError):
            management.update_record(
                "Room",
                self.room_name,
                {"maintenance_status": "Under Maintenance"},
            )

    def test_update_record_non_status_fields_no_reason_required(self):
        """Changing only non-status fields (room_name) must not require reason
        and must succeed."""
        result = management.update_record(
            "Room",
            self.room_name,
            {"room_name": "Sea Breeze"},
        )
        self.assertTrue(result["ok"])
        self.assertIn("room_name", result["data"]["changed"])

    def test_update_record_reason_forwarded_to_event(self):
        """Reason passed via update_record must be stored in the Room Status Event."""
        management.update_record(
            "Room",
            self.room_name,
            {
                "maintenance_status": "Under Maintenance",
                "reason": "Leaking tap repair",
            },
        )
        events = frappe.get_all(
            "Room Status Event",
            filters={
                "room": self.room_name,
                "event_type": "Maintenance",
                "new_value": "Under Maintenance",
            },
            fields=["reason"],
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["reason"], "Leaking tap repair")

    # ------------------------------------------------------------------ #
    # Append-only guard                                                    #
    # ------------------------------------------------------------------ #

    def test_room_status_event_is_append_only(self):
        """Saving an existing Room Status Event must raise ValidationError."""
        event_names = frappe.get_all(
            "Room Status Event",
            filters={"room": self.room_name},
            pluck="name",
            limit=1,
        )
        self.assertTrue(event_names, "Need at least one event to test append-only guard.")
        event_doc = frappe.get_doc("Room Status Event", event_names[0])
        event_doc.reason = "Tampered"
        with self.assertRaises(frappe.ValidationError):
            event_doc.save(ignore_permissions=True)

    # ------------------------------------------------------------------ #
    # list_room_status_events                                              #
    # ------------------------------------------------------------------ #

    def test_list_room_status_events_returns_events(self):
        """list_room_status_events must return an envelope with event data."""
        result = list_room_status_events(self.room_name)
        self.assertTrue(result["ok"])
        data = result["data"]
        self.assertEqual(data["room"], self.room_name)
        self.assertIn("events", data)
        self.assertIn("total", data)
        self.assertIn("page", data)
        self.assertIn("page_size", data)

    def test_list_room_status_events_pagination(self):
        """Page 1 and page 2 together must cover all events, most-recent first."""
        # Generate three housekeeping transitions so we have multiple events beyond
        # those from setUp.
        for status, reason in [
            ("Dirty", "Checkout"),
            ("In Progress", "Cleaning started"),
            ("Clean", "Cleaning complete"),
        ]:
            management.update_record(
                "Room",
                self.room_name,
                {"housekeeping_status": status, "reason": reason},
            )

        # Page 1 with size 2.
        p1 = list_room_status_events(self.room_name, page=1, page_size=2)
        self.assertTrue(p1["ok"])
        self.assertEqual(len(p1["data"]["events"]), 2)
        self.assertGreaterEqual(p1["data"]["total"], 3)

        # Page 2 must contain different events.
        p2 = list_room_status_events(self.room_name, page=2, page_size=2)
        self.assertTrue(p2["ok"])
        p1_names = {e["name"] for e in p1["data"]["events"]}
        p2_names = {e["name"] for e in p2["data"]["events"]}
        self.assertTrue(len(p2_names) > 0)
        self.assertTrue(p1_names.isdisjoint(p2_names), "Events must not repeat across pages.")

    def test_list_room_status_events_most_recent_first(self):
        """Events must be returned in descending changed_at order."""
        # Ensure there are at least two events with distinct housekeeping states.
        management.update_record(
            "Room",
            self.room_name,
            {"housekeeping_status": "Dirty", "reason": "First change"},
        )
        management.update_record(
            "Room",
            self.room_name,
            {"housekeeping_status": "Clean", "reason": "Second change"},
        )
        result = list_room_status_events(self.room_name, page=1, page_size=50)
        events = result["data"]["events"]
        timestamps = [e["changed_at"] for e in events]
        self.assertEqual(
            timestamps,
            sorted(timestamps, reverse=True),
            "Events must be ordered most-recent first.",
        )

    def test_list_room_status_events_page_size_capped_at_100(self):
        """Page size larger than 100 must be silently capped."""
        result = list_room_status_events(self.room_name, page=1, page_size=999)
        self.assertEqual(result["data"]["page_size"], 100)
