"""Tests for the plan-aware rate resolver."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.reservation.pricing import packages_for, resolve_room_rate
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


def _next_friday(base_date=None):
	from frappe.utils import getdate
	base = getdate(base_date or today())
	# Fri = 4 in Python's weekday()
	delta = (4 - base.weekday()) % 7
	return add_days(base, delta or 7)


class TestRateResolver(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.property = seed["property"]
		cls.room_type = frappe.db.get_value(
			"Room",
			{"resort_property": cls.property, "sellable_status": "Sellable", "occupancy_status": "Vacant", "is_active": 1},
			"room_type",
		)

	def setUp(self):
		super().setUp()
		# Clean slate for pricing docs so tests don't leak.
		for dt in ("Season", "Package", "Rate Plan"):
			for name in frappe.get_all(dt, filters={"resort_property": self.property}, pluck="name"):
				frappe.delete_doc(dt, name, force=True, ignore_permissions=True)

	# ----- Backward compat -----

	def test_no_plan_configured_falls_back_to_flat_item_price(self):
		# 2 nights arbitrary weekday range.
		arrival = today()
		departure = add_days(arrival, 2)
		result = resolve_room_rate(self.room_type, arrival, departure)
		self.assertIsNone(result["applied_plan"])
		self.assertIsNone(result["season_uplift_summary"])
		self.assertEqual(result["nightly_breakdown"], [])
		self.assertGreater(result["total_amount"], 0)  # Item Price × 2

	# ----- Rate Plan basics -----

	def test_property_wide_plan_produces_breakdown(self):
		frappe.get_doc({
			"doctype": "Rate Plan", "resort_property": self.property,
			"code": "BAR", "plan_name": "Best Available Rate",
			"base_rate_override": 10000,
		}).insert(ignore_permissions=True)
		arrival = today()
		departure = add_days(arrival, 3)
		result = resolve_room_rate(self.room_type, arrival, departure)
		self.assertEqual(result["applied_plan"]["code"], "BAR")
		self.assertEqual(len(result["nightly_breakdown"]), 3)
		self.assertEqual(result["total_amount"], 30000)

	def test_room_type_scoped_plan_beats_property_wide(self):
		frappe.get_doc({
			"doctype": "Rate Plan", "resort_property": self.property,
			"code": "BAR", "plan_name": "Best Available Rate",
			"base_rate_override": 10000,
		}).insert(ignore_permissions=True)
		frappe.get_doc({
			"doctype": "Rate Plan", "resort_property": self.property,
			"code": "CORP", "plan_name": "Corporate",
			"room_type": self.room_type,
			"base_rate_override": 8000,
		}).insert(ignore_permissions=True)
		result = resolve_room_rate(self.room_type, today(), add_days(today(), 2))
		self.assertEqual(result["applied_plan"]["code"], "CORP")
		self.assertEqual(result["total_amount"], 16000)

	# ----- Weekend uplift -----

	def test_weekend_uplift_applied_only_on_fri_sat(self):
		frappe.get_doc({
			"doctype": "Rate Plan", "resort_property": self.property,
			"code": "BAR", "plan_name": "BAR",
			"base_rate_override": 10000, "weekend_uplift_pct": 30,
		}).insert(ignore_permissions=True)
		# Arrival on next Friday → Fri + Sat = 2 uplifted nights.
		fri = _next_friday()
		result = resolve_room_rate(self.room_type, fri, add_days(fri, 2))
		nights = result["nightly_breakdown"]
		self.assertTrue(all(n["weekend"] for n in nights))
		# 10000 * 1.30 * 2 nights
		self.assertEqual(result["total_amount"], 26000)
		self.assertIn("Weekend +30%", result["season_uplift_summary"])

	# ----- Season -----

	def test_season_absolute_rate_overrides_base(self):
		frappe.get_doc({
			"doctype": "Rate Plan", "resort_property": self.property,
			"code": "BAR", "plan_name": "BAR",
			"base_rate_override": 10000,
		}).insert(ignore_permissions=True)
		arrival = today()
		frappe.get_doc({
			"doctype": "Season", "resort_property": self.property,
			"code": "PEAK", "season_name": "Peak",
			"start_date": arrival, "end_date": add_days(arrival, 5),
			"absolute_rate": 15000, "priority": 20,
		}).insert(ignore_permissions=True)
		result = resolve_room_rate(self.room_type, arrival, add_days(arrival, 2))
		self.assertEqual(result["total_amount"], 30000)  # 15000 × 2

	def test_higher_priority_season_wins(self):
		frappe.get_doc({
			"doctype": "Rate Plan", "resort_property": self.property,
			"code": "BAR", "plan_name": "BAR", "base_rate_override": 10000,
		}).insert(ignore_permissions=True)
		arrival = today()
		frappe.get_doc({
			"doctype": "Season", "resort_property": self.property,
			"code": "OFF", "season_name": "Off",
			"start_date": arrival, "end_date": add_days(arrival, 30),
			"modifier_pct": -20, "priority": 5,
		}).insert(ignore_permissions=True)
		frappe.get_doc({
			"doctype": "Season", "resort_property": self.property,
			"code": "DIWALI", "season_name": "Diwali",
			"start_date": arrival, "end_date": add_days(arrival, 3),
			"modifier_pct": 50, "priority": 20,
		}).insert(ignore_permissions=True)
		result = resolve_room_rate(self.room_type, arrival, add_days(arrival, 2))
		# Diwali (priority 20, +50%) wins over Off (priority 5, -20%)
		self.assertEqual(result["total_amount"], 30000)  # 15000 × 2

	# ----- Packages -----

	def test_package_appears_when_room_type_and_window_match(self):
		frappe.get_doc({
			"doctype": "Package", "resort_property": self.property,
			"code": "HNYMN", "package_name": "Honeymoon Escape",
			"room_type": self.room_type,
			"nights": 2, "package_price": 40000,
			"inclusions": [{"inclusion_name": "Breakfast"}, {"inclusion_name": "Spa credit"}],
		}).insert(ignore_permissions=True)
		matches = packages_for(self.room_type, today(), add_days(today(), 2))
		self.assertEqual(len(matches), 1)
		self.assertEqual(matches[0]["code"], "HNYMN")
		self.assertEqual(matches[0]["inclusions_summary"], "Breakfast + Spa credit")

	def test_package_hidden_when_nights_mismatch(self):
		frappe.get_doc({
			"doctype": "Package", "resort_property": self.property,
			"code": "HNYMN", "package_name": "Honeymoon",
			"nights": 2, "package_price": 40000,
		}).insert(ignore_permissions=True)
		# Request 3 nights → 2-night package must not match.
		self.assertEqual(packages_for(self.room_type, today(), add_days(today(), 3)), [])


class TestSearchAvailabilityPlanAware(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.property = seed["property"]

	def setUp(self):
		super().setUp()
		for dt in ("Season", "Package", "Rate Plan"):
			for name in frappe.get_all(dt, filters={"resort_property": self.property}, pluck="name"):
				frappe.delete_doc(dt, name, force=True, ignore_permissions=True)

	def test_offers_carry_full_plan_breakdown(self):
		from the_reezort.reservation.api import search_availability

		frappe.get_doc({
			"doctype": "Rate Plan", "resort_property": self.property,
			"code": "BAR", "plan_name": "Best Available Rate",
			"base_rate_override": 12000,
		}).insert(ignore_permissions=True)

		arrival = today()
		departure = add_days(arrival, 3)
		out = search_availability(
			property=self.property, arrival_date=arrival, departure_date=departure
		)
		self.assertGreaterEqual(len(out["offers"]), 1)
		offer = out["offers"][0]
		self.assertIn("nightly_breakdown", offer)
		self.assertEqual(len(offer["nightly_breakdown"]), 3)
		self.assertEqual(offer["applied_plan"]["code"], "BAR")
		# Estimated total = base 12000 × 3 nights × 1 room.
		self.assertEqual(offer["per_room_estimated_amount"], 36000)

	def test_list_rate_plans_returns_active_plans_for_property(self):
		from the_reezort.reservation.api import list_rate_plans

		frappe.get_doc({
			"doctype": "Rate Plan", "resort_property": self.property,
			"code": "REFUND", "plan_name": "Fully Refundable",
			"base_rate_override": 15000, "refundable": 1, "cancellation_hours": 48,
		}).insert(ignore_permissions=True)
		frappe.get_doc({
			"doctype": "Rate Plan", "resort_property": self.property,
			"code": "NRF", "plan_name": "Non-Refundable Saver",
			"base_rate_override": 10000, "refundable": 0,
		}).insert(ignore_permissions=True)
		out = list_rate_plans(property=self.property)
		codes = {p["code"] for p in out["plans"]}
		self.assertTrue({"REFUND", "NRF"}.issubset(codes))
