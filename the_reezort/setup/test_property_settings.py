"""Tests for Property Settings DocType and its two wired behaviours.

Covers:
  1. Auto-creation on first read (get_property_settings)
  2. Uniqueness scope switch (room_identifier_uniqueness)
  3. Dirty-allocation default fallback in _allocation_housekeeping_filter

Cannot be run locally (no bench site in this worktree); syntax is verified via
py_compile. Will be executed against a real site by the test pipeline.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.setup import api as setup_api
from the_reezort.the_reezort.doctype.property_settings import property_settings as ps_module


class TestPropertySettings(FrappeTestCase):
    """Integration tests for Property Settings CRUD and policy wiring."""

    def setUp(self):
        self.company = frappe.db.get_value("Company", {}, "name")
        prop = setup_api.create_property(
            {
                "property_name": "ZZ PropSettings",
                "property_code": "ZZPS",
                "company": self.company,
                "timezone": "Asia/Kolkata",
            }
        )["data"]["property"]["name"]
        self.prop = prop

        self.building_a = setup_api.create_building(
            {"resort_property": prop, "building_name": "Wing A", "building_code": "PSWA"}
        )["data"]["building"]["name"]
        self.building_b = setup_api.create_building(
            {"resort_property": prop, "building_name": "Wing B", "building_code": "PSWB"}
        )["data"]["building"]["name"]

        self.floor_a = setup_api.create_floor(
            {
                "resort_property": prop,
                "building": self.building_a,
                "floor_label": "F1A",
                "floor_code": "1A",
            }
        )["data"]["floor"]["name"]
        self.floor_b = setup_api.create_floor(
            {
                "resort_property": prop,
                "building": self.building_b,
                "floor_label": "F1B",
                "floor_code": "1B",
            }
        )["data"]["floor"]["name"]

        self.room_type = setup_api.create_room_type(
            {
                "resort_property": prop,
                "room_type_name": "Std",
                "room_type_code": "PSSTD",
                "standard_adults": 2,
                "max_occupancy": 2,
            }
        )["data"]["room_type"]["name"]

    # ------------------------------------------------------------------
    # 1. Auto-creation on first read
    # ------------------------------------------------------------------

    def test_create_on_first_read(self):
        """get_property_settings must create a record with sane defaults when none exists."""
        # Ensure no settings exist yet.
        existing = frappe.db.get_value(
            "Property Settings", {"resort_property": self.prop}, "name"
        )
        self.assertIsNone(existing)

        result = ps_module.get_property_settings(self.prop)
        self.assertTrue(result["ok"])
        data = result["data"]

        self.assertEqual(data["resort_property"], self.prop)
        self.assertEqual(data["room_identifier_uniqueness"], "Property")
        self.assertEqual(data["hard_block_overlap_policy"], "Strict")
        # allow_dirty_allocation_default seeds from Resort Property.allow_dirty_room_allocation
        # which defaults to 0 for a fresh property.
        self.assertEqual(data["allow_dirty_allocation_default"], 0)

        # Calling again must be idempotent — no duplicate error.
        result2 = ps_module.get_property_settings(self.prop)
        self.assertTrue(result2["ok"])
        self.assertEqual(result2["data"]["name"], data["name"])

    def test_update_property_settings(self):
        """update_property_settings must persist writable fields and return updated state."""
        ps_module.get_property_settings(self.prop)  # ensure exists

        updated = ps_module.update_property_settings(
            self.prop,
            {
                "allow_dirty_allocation_default": 1,
                "room_identifier_uniqueness": "Building",
                "hard_block_overlap_policy": "Allow Same Source",
            },
        )
        self.assertTrue(updated["ok"])
        data = updated["data"]
        self.assertEqual(data["allow_dirty_allocation_default"], 1)
        self.assertEqual(data["room_identifier_uniqueness"], "Building")
        self.assertEqual(data["hard_block_overlap_policy"], "Allow Same Source")

    def test_update_ignores_unknown_fields(self):
        """Unknown fields in the settings dict must be silently ignored."""
        ps_module.get_property_settings(self.prop)
        result = ps_module.update_property_settings(
            self.prop, {"allow_dirty_allocation_default": 0, "malicious_field": "NOPE"}
        )
        self.assertTrue(result["ok"])
        doc = frappe.get_doc("Property Settings", self.prop)
        self.assertFalse(hasattr(doc, "malicious_field"))

    # ------------------------------------------------------------------
    # 2. Room number uniqueness scope
    # ------------------------------------------------------------------

    def test_uniqueness_scope_property_rejects_cross_building_duplicate(self):
        """With scope=Property, the same room number in a different building is rejected."""
        ps_module.get_property_settings(self.prop)
        ps_module.update_property_settings(self.prop, {"room_identifier_uniqueness": "Property"})

        # Create room 101 in building A.
        setup_api.create_rooms_bulk(
            {
                "resort_property": self.prop,
                "building": self.building_a,
                "floor": self.floor_a,
                "room_type": self.room_type,
                "room_numbers": ["PS101"],
            }
        )

        # Attempting 101 in building B must be treated as a duplicate (skipped, not created).
        result = setup_api.create_rooms_bulk(
            {
                "resort_property": self.prop,
                "building": self.building_b,
                "floor": self.floor_b,
                "room_type": self.room_type,
                "room_numbers": ["PS101"],
            }
        )
        self.assertEqual(result["data"]["created_count"], 0)
        self.assertIn("PS101", result["data"]["skipped"])

    def test_uniqueness_scope_building_allows_same_number_in_different_buildings(self):
        """With scope=Building, the same room number may exist in two different buildings."""
        ps_module.get_property_settings(self.prop)
        ps_module.update_property_settings(self.prop, {"room_identifier_uniqueness": "Building"})

        # Create room 201 in building A.
        r1 = setup_api.create_rooms_bulk(
            {
                "resort_property": self.prop,
                "building": self.building_a,
                "floor": self.floor_a,
                "room_type": self.room_type,
                "room_numbers": ["PS201"],
            }
        )
        self.assertEqual(r1["data"]["created_count"], 1)

        # Same number in building B must succeed.
        r2 = setup_api.create_rooms_bulk(
            {
                "resort_property": self.prop,
                "building": self.building_b,
                "floor": self.floor_b,
                "room_type": self.room_type,
                "room_numbers": ["PS201"],
            }
        )
        self.assertEqual(r2["data"]["created_count"], 1)

    # ------------------------------------------------------------------
    # 3. Dirty-allocation default fallback
    # ------------------------------------------------------------------

    def test_dirty_allocation_default_false_returns_filter(self):
        """With allow_dirty_allocation_default=0, _allocation_housekeeping_filter must return
        a ['in', [...]] filter that restricts to clean/inspected rooms."""
        from the_reezort.pms.api import _allocation_housekeeping_filter, READY_HOUSEKEEPING_STATUSES

        ps_module.get_property_settings(self.prop)
        ps_module.update_property_settings(self.prop, {"allow_dirty_allocation_default": 0})

        hk_filter = _allocation_housekeeping_filter(self.prop)
        self.assertIsNotNone(hk_filter)
        self.assertEqual(hk_filter[0], "in")
        self.assertCountEqual(hk_filter[1], list(READY_HOUSEKEEPING_STATUSES))

    def test_dirty_allocation_default_true_returns_none(self):
        """With allow_dirty_allocation_default=1, _allocation_housekeeping_filter must return
        None (no housekeeping filter applied, dirty rooms are allocatable)."""
        from the_reezort.pms.api import _allocation_housekeeping_filter

        ps_module.get_property_settings(self.prop)
        ps_module.update_property_settings(self.prop, {"allow_dirty_allocation_default": 1})

        hk_filter = _allocation_housekeeping_filter(self.prop)
        self.assertIsNone(hk_filter)

    def test_dirty_allocation_fallback_to_resort_property(self):
        """When no Property Settings record exists, _allocation_housekeeping_filter falls
        back to Resort Property.allow_dirty_room_allocation."""
        from the_reezort.pms.api import _allocation_housekeeping_filter

        # Ensure no Property Settings record for this property.
        existing = frappe.db.get_value(
            "Property Settings", {"resort_property": self.prop}, "name"
        )
        if existing:
            frappe.delete_doc("Property Settings", existing, ignore_permissions=True)

        # Set legacy flag to 1 on the Resort Property.
        frappe.db.set_value("Resort Property", self.prop, "allow_dirty_room_allocation", 1)

        hk_filter = _allocation_housekeeping_filter(self.prop)
        self.assertIsNone(hk_filter)

        # Restore.
        frappe.db.set_value("Resort Property", self.prop, "allow_dirty_room_allocation", 0)
