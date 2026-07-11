"""Tests for Event Space, Event Space Combination, and Activity Area CRUD APIs.

setUp builds a minimal property/building/floor hierarchy via the existing
setup.api module — the same pattern as test_management.py — so the doctypes
are exercised against a real Frappe site.

Run with: bench run-tests --app the_reezort --module the_reezort.property.test_event_spaces
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.setup import api as setup_api
from the_reezort.property import event_spaces


class TestEventSpaceCRUD(FrappeTestCase):
	def setUp(self):
		self.company = frappe.db.get_value("Company", {}, "name")
		result = setup_api.create_property(
			{
				"property_name": "ZZ EventTest",
				"property_code": "ZZESP",
				"company": self.company,
				"timezone": "Asia/Kolkata",
			}
		)
		self.prop = result["data"]["property"]["name"]

	# ---- Event Space create ----

	def test_create_event_space_minimal(self):
		res = event_spaces.create_event_space(
			{
				"resort_property": self.prop,
				"space_name": "Grand Ballroom",
				"space_code": "GBALL",
			}
		)
		self.assertTrue(res["ok"])
		data = res["data"]["event_space"]
		self.assertEqual(data["space_name"], "Grand Ballroom")
		self.assertEqual(data["space_code"], "GBALL")
		self.assertEqual(data["operating_status"], "Available")
		self.assertEqual(data["is_active"], 1)

	def test_create_event_space_with_capacity_and_divisible(self):
		res = event_spaces.create_event_space(
			{
				"resort_property": self.prop,
				"space_name": "Hall A",
				"space_code": "HALLA",
				"capacity": 200,
				"area_sqft": 3500.0,
				"divisible": 1,
			}
		)
		data = res["data"]["event_space"]
		self.assertEqual(data["capacity"], 200)
		self.assertEqual(data["divisible"], 1)

	def test_create_event_space_requires_resort_property(self):
		with self.assertRaises(frappe.ValidationError):
			event_spaces.create_event_space(
				{"space_name": "X", "space_code": "XX"}
			)

	def test_create_event_space_requires_space_name(self):
		with self.assertRaises(frappe.ValidationError):
			event_spaces.create_event_space(
				{"resort_property": self.prop, "space_code": "YY"}
			)

	def test_create_event_space_requires_space_code(self):
		with self.assertRaises(frappe.ValidationError):
			event_spaces.create_event_space(
				{"resort_property": self.prop, "space_name": "Z Hall"}
			)

	# ---- Event Space uniqueness ----

	def test_duplicate_space_code_rejected(self):
		event_spaces.create_event_space(
			{"resort_property": self.prop, "space_name": "Conf A", "space_code": "CONFA"}
		)
		with self.assertRaises(frappe.ValidationError):
			event_spaces.create_event_space(
				{"resort_property": self.prop, "space_name": "Conf A Dup", "space_code": "CONFA"}
			)

	# ---- Event Space list ----

	def test_list_event_spaces_filters_by_property(self):
		event_spaces.create_event_space(
			{"resort_property": self.prop, "space_name": "Rooftop", "space_code": "ROOF"}
		)
		res = event_spaces.list_event_spaces(resort_property=self.prop)
		names = [r["space_code"] for r in res["data"]["event_spaces"]]
		self.assertIn("ROOF", names)

	def test_list_event_spaces_excludes_inactive_by_default(self):
		created = event_spaces.create_event_space(
			{"resort_property": self.prop, "space_name": "Old Hall", "space_code": "OLDH"}
		)
		space_name = created["data"]["event_space"]["name"]
		event_spaces.set_event_space_active(space_name, 0)

		res = event_spaces.list_event_spaces(resort_property=self.prop)
		codes = [r["space_code"] for r in res["data"]["event_spaces"]]
		self.assertNotIn("OLDH", codes)

		res_all = event_spaces.list_event_spaces(resort_property=self.prop, include_inactive=1)
		codes_all = [r["space_code"] for r in res_all["data"]["event_spaces"]]
		self.assertIn("OLDH", codes_all)

	# ---- Event Space update ----

	def test_update_event_space_capacity(self):
		created = event_spaces.create_event_space(
			{"resort_property": self.prop, "space_name": "Banquet", "space_code": "BANQ"}
		)
		space_name = created["data"]["event_space"]["name"]

		res = event_spaces.update_event_space(space_name, {"capacity": 500, "operating_status": "Under Maintenance"})
		self.assertIn("capacity", res["data"]["changed"])
		self.assertEqual(res["data"]["event_space"]["capacity"], 500)
		self.assertEqual(res["data"]["event_space"]["operating_status"], "Under Maintenance")

	# ---- Event Space soft delete ----

	def test_set_event_space_active_toggle(self):
		created = event_spaces.create_event_space(
			{"resort_property": self.prop, "space_name": "Garden Lawn", "space_code": "LAWN"}
		)
		space_name = created["data"]["event_space"]["name"]

		event_spaces.set_event_space_active(space_name, 0)
		self.assertEqual(frappe.db.get_value("Event Space", space_name, "is_active"), 0)

		event_spaces.set_event_space_active(space_name, 1)
		self.assertEqual(frappe.db.get_value("Event Space", space_name, "is_active"), 1)

	# ---- Event Space Combination (child table) ----

	def test_create_event_space_with_combination_rows(self):
		hall_a = event_spaces.create_event_space(
			{"resort_property": self.prop, "space_name": "Hall A2", "space_code": "HA2"}
		)
		hall_a_name = hall_a["data"]["event_space"]["name"]

		hall_b = event_spaces.create_event_space(
			{
				"resort_property": self.prop,
				"space_name": "Hall B2",
				"space_code": "HB2",
				"divisible": 1,
				"combined_with": [{"event_space": hall_a_name, "notes": "Remove partition"}],
			}
		)
		self.assertEqual(len(hall_b["data"]["event_space"]["combined_with"]), 1)
		self.assertEqual(
			hall_b["data"]["event_space"]["combined_with"][0]["event_space"], hall_a_name
		)

	def test_update_event_space_combination_rows(self):
		hall_c = event_spaces.create_event_space(
			{"resort_property": self.prop, "space_name": "Hall C", "space_code": "HCC"}
		)
		hall_c_name = hall_c["data"]["event_space"]["name"]

		hall_d = event_spaces.create_event_space(
			{"resort_property": self.prop, "space_name": "Hall D", "space_code": "HDD", "divisible": 1}
		)
		hall_d_name = hall_d["data"]["event_space"]["name"]

		res = event_spaces.update_event_space(
			hall_d_name,
			{"combined_with": [{"event_space": hall_c_name, "notes": "Fold wall"}]},
		)
		self.assertIn("combined_with", res["data"]["changed"])
		self.assertEqual(len(res["data"]["event_space"]["combined_with"]), 1)


class TestActivityAreaCRUD(FrappeTestCase):
	def setUp(self):
		self.company = frappe.db.get_value("Company", {}, "name")
		result = setup_api.create_property(
			{
				"property_name": "ZZ ActivityTest",
				"property_code": "ZZACT",
				"company": self.company,
				"timezone": "Asia/Kolkata",
			}
		)
		self.prop = result["data"]["property"]["name"]

	# ---- Activity Area create ----

	def test_create_activity_area_minimal(self):
		res = event_spaces.create_activity_area(
			{
				"resort_property": self.prop,
				"area_name": "Spa Room 1",
				"area_code": "SPA01",
				"area_type": "Spa Room",
			}
		)
		self.assertTrue(res["ok"])
		data = res["data"]["activity_area"]
		self.assertEqual(data["area_name"], "Spa Room 1")
		self.assertEqual(data["area_type"], "Spa Room")
		self.assertEqual(data["operating_status"], "Available")
		self.assertEqual(data["is_active"], 1)

	def test_create_activity_area_with_capacity(self):
		res = event_spaces.create_activity_area(
			{
				"resort_property": self.prop,
				"area_name": "Gym Zone",
				"area_code": "GYM1",
				"area_type": "Facility",
				"capacity": 20,
			}
		)
		self.assertEqual(res["data"]["activity_area"]["capacity"], 20)

	def test_create_activity_area_requires_resort_property(self):
		with self.assertRaises(frappe.ValidationError):
			event_spaces.create_activity_area({"area_name": "X", "area_code": "XX"})

	def test_create_activity_area_requires_area_name(self):
		with self.assertRaises(frappe.ValidationError):
			event_spaces.create_activity_area({"resort_property": self.prop, "area_code": "YY"})

	def test_create_activity_area_requires_area_code(self):
		with self.assertRaises(frappe.ValidationError):
			event_spaces.create_activity_area({"resort_property": self.prop, "area_name": "Z"})

	# ---- Activity Area uniqueness ----

	def test_duplicate_area_code_rejected(self):
		event_spaces.create_activity_area(
			{"resort_property": self.prop, "area_name": "Pool 1", "area_code": "POOL1"}
		)
		with self.assertRaises(frappe.ValidationError):
			event_spaces.create_activity_area(
				{"resort_property": self.prop, "area_name": "Pool 1 Dup", "area_code": "POOL1"}
			)

	# ---- Activity Area list ----

	def test_list_activity_areas_by_property(self):
		event_spaces.create_activity_area(
			{"resort_property": self.prop, "area_name": "Cabana 1", "area_code": "CAB1", "area_type": "Cabana"}
		)
		res = event_spaces.list_activity_areas(resort_property=self.prop)
		codes = [r["area_code"] for r in res["data"]["activity_areas"]]
		self.assertIn("CAB1", codes)

	def test_list_activity_areas_by_type(self):
		event_spaces.create_activity_area(
			{"resort_property": self.prop, "area_name": "Wellness Zone", "area_code": "WELL", "area_type": "Wellness"}
		)
		event_spaces.create_activity_area(
			{"resort_property": self.prop, "area_name": "Activity Hut", "area_code": "ACTH", "area_type": "Activity"}
		)
		res = event_spaces.list_activity_areas(resort_property=self.prop, area_type="Wellness")
		codes = [r["area_code"] for r in res["data"]["activity_areas"]]
		self.assertIn("WELL", codes)
		self.assertNotIn("ACTH", codes)

	def test_list_activity_areas_excludes_inactive_by_default(self):
		created = event_spaces.create_activity_area(
			{"resort_property": self.prop, "area_name": "Old Spa", "area_code": "OSPA"}
		)
		area_name = created["data"]["activity_area"]["name"]
		event_spaces.set_activity_area_active(area_name, 0)

		res = event_spaces.list_activity_areas(resort_property=self.prop)
		codes = [r["area_code"] for r in res["data"]["activity_areas"]]
		self.assertNotIn("OSPA", codes)

		res_all = event_spaces.list_activity_areas(resort_property=self.prop, include_inactive=1)
		codes_all = [r["area_code"] for r in res_all["data"]["activity_areas"]]
		self.assertIn("OSPA", codes_all)

	# ---- Activity Area update ----

	def test_update_activity_area_fields(self):
		created = event_spaces.create_activity_area(
			{"resort_property": self.prop, "area_name": "Treatment A", "area_code": "TRTA"}
		)
		area_name = created["data"]["activity_area"]["name"]

		res = event_spaces.update_activity_area(
			area_name,
			{"capacity": 4, "operating_status": "Out of Service", "area_type": "Spa Room"},
		)
		self.assertIn("capacity", res["data"]["changed"])
		self.assertEqual(res["data"]["activity_area"]["capacity"], 4)
		self.assertEqual(res["data"]["activity_area"]["operating_status"], "Out of Service")
		self.assertEqual(res["data"]["activity_area"]["area_type"], "Spa Room")

	# ---- Activity Area soft delete ----

	def test_set_activity_area_active_toggle(self):
		created = event_spaces.create_activity_area(
			{"resort_property": self.prop, "area_name": "Yoga Deck", "area_code": "YOGA"}
		)
		area_name = created["data"]["activity_area"]["name"]

		event_spaces.set_activity_area_active(area_name, 0)
		self.assertEqual(frappe.db.get_value("Activity Area", area_name, "is_active"), 0)

		event_spaces.set_activity_area_active(area_name, 1)
		self.assertEqual(frappe.db.get_value("Activity Area", area_name, "is_active"), 1)
