"""Tests for the Rate Plan / Season / Package CRUD in rate_plans.py."""

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.setup import api, rate_plans


class TestRatePlans(FrappeTestCase):
	def setUp(self):
		self.company = frappe.db.get_value("Company", {}, "name")
		self.prop = api.create_property(
			{
				"property_name": "ZZ Rate Plans",
				"property_code": "ZZRATE",
				"company": self.company,
				"timezone": "Asia/Kolkata",
			}
		)["data"]["property"]["name"]

	def test_upsert_creates_a_rate_plan(self):
		result = rate_plans.upsert_rate_plan(
			{"resort_property": self.prop, "code": "std", "plan_name": "Standard", "weekend_uplift_pct": 10}
		)
		name = result["data"]["rate_plan"]
		self.assertEqual(name, f"{self.prop}-STD")
		doc = frappe.get_doc("Rate Plan", name)
		self.assertEqual(doc.plan_name, "Standard")
		self.assertEqual(doc.weekend_uplift_pct, 10)

	def test_upsert_is_idempotent_on_property_and_code(self):
		rate_plans.upsert_rate_plan({"resort_property": self.prop, "code": "std", "plan_name": "Standard"})
		result = rate_plans.upsert_rate_plan(
			{"resort_property": self.prop, "code": "std", "plan_name": "Standard Updated"}
		)
		self.assertTrue(result["data"]["reused"])
		doc = frappe.get_doc("Rate Plan", f"{self.prop}-STD")
		self.assertEqual(doc.plan_name, "Standard Updated")

	def test_a_client_supplied_doctype_key_cannot_redirect_the_insert(self):
		# A payload smuggling "doctype": "User" must not be able to make the
		# insert create a User instead of a Rate Plan — the target doctype is
		# always the one the endpoint was called for, never client-controlled.
		before = frappe.db.count("User")
		rate_plans.upsert_rate_plan(
			{
				"resort_property": self.prop,
				"code": "hack",
				"plan_name": "Hack",
				"doctype": "User",
				"email": "attacker@example.com",
				"first_name": "Attacker",
			}
		)
		self.assertEqual(frappe.db.count("User"), before)
		self.assertFalse(frappe.db.exists("User", "attacker@example.com"))
		self.assertTrue(frappe.db.exists("Rate Plan", f"{self.prop}-HACK"))

	def test_unlisted_payload_fields_are_not_written_to_the_document(self):
		# Only fields in rate_plans._EDITABLE may be set — everything else in
		# the payload (framework fields, or fields that aren't part of the
		# public contract) must be silently dropped, not written through.
		rate_plans.upsert_rate_plan(
			{
				"resort_property": self.prop,
				"code": "std",
				"plan_name": "Standard",
				"owner": "someone-else@example.com",
				"docstatus": 2,
			}
		)
		doc = frappe.get_doc("Rate Plan", f"{self.prop}-STD")
		self.assertNotEqual(doc.owner, "someone-else@example.com")
		self.assertEqual(doc.docstatus, 0)

	def test_updating_an_existing_rate_plan_cannot_be_redirected_to_another_record_via_name(self):
		# A payload containing "name" must not let an update on one Rate Plan
		# retarget a different record's row.
		rate_plans.upsert_rate_plan({"resort_property": self.prop, "code": "a", "plan_name": "Plan A"})
		rate_plans.upsert_rate_plan({"resort_property": self.prop, "code": "b", "plan_name": "Plan B"})

		rate_plans.upsert_rate_plan(
			{
				"resort_property": self.prop,
				"code": "a",
				"plan_name": "Plan A Edited",
				"name": f"{self.prop}-B",
			}
		)

		plan_a = frappe.get_doc("Rate Plan", f"{self.prop}-A")
		plan_b = frappe.get_doc("Rate Plan", f"{self.prop}-B")
		self.assertEqual(plan_a.plan_name, "Plan A Edited")
		self.assertEqual(plan_b.plan_name, "Plan B")

	def test_upsert_season(self):
		result = rate_plans.upsert_season(
			{
				"resort_property": self.prop,
				"code": "peak",
				"season_name": "Peak Season",
				"start_date": "2026-12-20",
				"end_date": "2027-01-05",
				"modifier_pct": 50,
			}
		)
		doc = frappe.get_doc("Season", result["data"]["season"])
		self.assertEqual(doc.season_name, "Peak Season")
		self.assertEqual(doc.modifier_pct, 50)

	def test_upsert_package_keeps_inclusions_handling_intact(self):
		result = rate_plans.upsert_package(
			{
				"resort_property": self.prop,
				"code": "honeymoon",
				"package_name": "Honeymoon",
				"nights": 3,
				"package_price": 45000,
				"inclusions": [{"inclusion_name": "Candlelight dinner", "quantity": 1}],
			}
		)
		doc = frappe.get_doc("Package", result["data"]["package"])
		self.assertEqual(doc.package_name, "Honeymoon")
		self.assertEqual(len(doc.inclusions), 1)
		self.assertEqual(doc.inclusions[0].inclusion_name, "Candlelight dinner")
