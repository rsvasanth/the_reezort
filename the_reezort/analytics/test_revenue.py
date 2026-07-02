"""Tests for the Revenue analytics API — spec 014 first slice.

Coverage: snapshot idempotency, rebuild convergence, channel mix % sums,
zero-window rendering, System Manager-only rebuild permission, KPI deltas
against a prior period, daily-trend zero-fills missing days.
"""

from __future__ import annotations

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, flt, getdate, now_datetime, today

from the_reezort.analytics.revenue import (
	CHANNEL_MAP,
	_compute_snapshot,
	get_channel_mix,
	get_daily_trend,
	get_summary,
	rebuild_snapshots,
)
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestRevenueAnalytics(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		company = (
			frappe.db.get_single_value("Global Defaults", "default_company")
			or frappe.db.get_value("Company", {}, "name")
		)
		seed_erpnext_demo_masters(company, currency="INR")
		seed = seed_demo_property(company)
		cls.resort_property = seed["property"]

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		# Blank slate — the range in each test writes its own snapshots.
		frappe.db.delete("Revenue Snapshot", {"resort_property": self.resort_property})
		frappe.db.commit()

	# ------------------------------------------------------------------
	# Snapshot idempotency + rebuild
	# ------------------------------------------------------------------

	def test_rebuild_is_idempotent(self):
		end = add_days(getdate(today()), -1)
		start = add_days(end, -6)
		first = rebuild_snapshots(str(start), str(end))["data"]
		second = rebuild_snapshots(str(start), str(end))["data"]
		self.assertEqual(first["days"], 7)
		self.assertEqual(second["days"], 7)
		# Second run does not create duplicate rows.
		names = frappe.get_all(
			"Revenue Snapshot",
			filters={"resort_property": self.resort_property},
			pluck="name",
		)
		self.assertEqual(len(names), 7)

	def test_rebuild_matches_live_compute(self):
		"""Rebuilt row = _compute_snapshot() output, ±1 rounding unit — the
		read path and the write path must agree."""
		day = add_days(getdate(today()), -1)
		rebuild_snapshots(str(day), str(day))
		snap = frappe.db.get_value(
			"Revenue Snapshot",
			{"resort_property": self.resort_property, "snapshot_date": day},
			["sellable_rooms", "occupied_rooms", "room_revenue", "other_revenue"],
			as_dict=True,
		)
		live = _compute_snapshot(self.resort_property, day)
		self.assertEqual(snap.sellable_rooms, live["sellable_rooms"])
		self.assertEqual(snap.occupied_rooms, live["occupied_rooms"])
		self.assertAlmostEqual(flt(snap.room_revenue), flt(live["room_revenue"]), delta=1)
		self.assertAlmostEqual(flt(snap.other_revenue), flt(live["other_revenue"]), delta=1)

	# ------------------------------------------------------------------
	# Read APIs
	# ------------------------------------------------------------------

	def test_summary_empty_window_renders_zeros(self):
		"""No snapshots + no revenue → summary comes back with zeros, not NaN,
		not exception. UI's 'No revenue in this window' banner branches on
		days_covered==0."""
		end = add_days(getdate(today()), -1)
		start = add_days(end, -29)
		result = get_summary(str(start), str(end))["data"]
		self.assertEqual(result["days_covered"], 0)
		self.assertEqual(result["days_missing"], 30)
		self.assertEqual(result["occupancy_pct"], 0)
		self.assertEqual(result["room_revenue"], 0)
		self.assertEqual(result["adr"], 0)
		self.assertEqual(result["revpar"], 0)

	def test_summary_days_missing_matches_holes(self):
		"""3 snapshots inside a 7-day window → days_missing = 4."""
		end = add_days(getdate(today()), -1)
		start = add_days(end, -6)
		# Build only 3 of the 7 days.
		for day_offset in (0, 2, 5):
			day = add_days(start, day_offset)
			rebuild_snapshots(str(day), str(day))
		result = get_summary(str(start), str(end))["data"]
		self.assertEqual(result["days_covered"], 3)
		self.assertEqual(result["days_missing"], 4)

	def test_daily_trend_zero_fills_missing_days(self):
		"""Chart never collapses — days with no snapshot come back as
		present=false with zero numbers rather than being omitted."""
		end = add_days(getdate(today()), -1)
		# One snapshot in the middle of a 7-day trend.
		mid = add_days(end, -3)
		rebuild_snapshots(str(mid), str(mid))
		result = get_daily_trend(days=7)["data"]
		self.assertEqual(len(result["series"]), 7)
		present_count = sum(1 for d in result["series"] if d["present"])
		self.assertEqual(present_count, 1)
		zero_days = [d for d in result["series"] if not d["present"]]
		for d in zero_days:
			self.assertEqual(d["room_revenue"], 0)
			self.assertEqual(d["occupancy_pct"], 0)

	def test_channel_mix_pct_sums_to_100(self):
		"""Channel percentages always add to 100 ±0.5 when there is revenue."""
		end = add_days(getdate(today()), -1)
		start = add_days(end, -29)
		# Seed a fake snapshot with revenue across all four channels so the
		# rebuild path isn't needed for this shape test.
		frappe.get_doc(
			{
				"doctype": "Revenue Snapshot",
				"resort_property": self.resort_property,
				"snapshot_date": end,
				"sellable_rooms": 40,
				"occupied_rooms": 30,
				"room_revenue": 100000,
				"other_revenue": 0,
				"direct_bookings": 5, "direct_revenue": 50000,
				"ota_bookings": 3, "ota_revenue": 30000,
				"corporate_bookings": 2, "corporate_revenue": 15000,
				"walk_in_bookings": 1, "walk_in_revenue": 5000,
			}
		).insert(ignore_permissions=True)
		result = get_channel_mix(str(start), str(end))["data"]
		total_pct = sum(c["pct"] for c in result["channels"])
		self.assertAlmostEqual(total_pct, 100.0, delta=0.5)
		# Direct is dominant.
		by_channel = {c["channel"]: c for c in result["channels"]}
		self.assertGreater(by_channel["Direct"]["pct"], by_channel["OTA"]["pct"])

	def test_channel_mix_zero_revenue_returns_zero_pct(self):
		"""Zero revenue → 0/0/0/0 pct, not divide-by-zero."""
		result = get_channel_mix()["data"]
		for c in result["channels"]:
			self.assertEqual(c["pct"], 0)

	# ------------------------------------------------------------------
	# Deltas
	# ------------------------------------------------------------------

	def test_summary_delta_compares_same_length_prior_period(self):
		"""Δ occupancy for a 2-day window compares against the 2 days before it."""
		end = add_days(getdate(today()), -1)
		start = add_days(end, -1)  # 2-day window
		# Current period: 40 sellable, 30 occupied → 75%.
		for d in (start, end):
			frappe.get_doc(
				{
					"doctype": "Revenue Snapshot",
					"resort_property": self.resort_property,
					"snapshot_date": d,
					"sellable_rooms": 20,
					"occupied_rooms": 15,
					"room_revenue": 100000,
					"other_revenue": 0,
				}
			).insert(ignore_permissions=True)
		# Prior period: 40 sellable, 20 occupied → 50%.
		for d in (add_days(start, -2), add_days(start, -1)):
			frappe.get_doc(
				{
					"doctype": "Revenue Snapshot",
					"resort_property": self.resort_property,
					"snapshot_date": d,
					"sellable_rooms": 20,
					"occupied_rooms": 10,
					"room_revenue": 50000,
					"other_revenue": 0,
				}
			).insert(ignore_permissions=True)
		result = get_summary(str(start), str(end))["data"]
		self.assertEqual(result["occupancy_pct"], 75.0)
		self.assertEqual(result["deltas"]["occupancy_pct"], 25.0)
		# ADR = 200k/30 = 6666.67 vs 100k/20 = 5000 → Δ ≈ +1667
		self.assertAlmostEqual(result["deltas"]["adr"], 1667, delta=2)

	# ------------------------------------------------------------------
	# Permissions
	# ------------------------------------------------------------------

	def test_rebuild_requires_system_manager(self):
		test_user = "revenue.analyst.test@thereezort.com"
		if not frappe.db.exists("User", test_user):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": test_user,
					"first_name": "Test",
					"send_welcome_email": 0,
					"roles": [{"role": "Resort Manager"}],  # Not System Manager
				}
			).insert(ignore_permissions=True)
		original = frappe.session.user
		try:
			frappe.set_user(test_user)
			with self.assertRaises(frappe.PermissionError):
				rebuild_snapshots(str(add_days(getdate(today()), -1)), str(add_days(getdate(today()), -1)))
		finally:
			frappe.set_user(original)

	def test_summary_requires_analytics_role(self):
		test_user = "front.desk.analytics.test@thereezort.com"
		if not frappe.db.exists("User", test_user):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": test_user,
					"first_name": "Test",
					"send_welcome_email": 0,
					"roles": [{"role": "Front Desk"}],
				}
			).insert(ignore_permissions=True)
		original = frappe.session.user
		try:
			frappe.set_user(test_user)
			with self.assertRaises(frappe.PermissionError):
				get_summary()
		finally:
			frappe.set_user(original)

	# ------------------------------------------------------------------
	# Channel bucketing
	# ------------------------------------------------------------------

	def test_channel_map_buckets_all_source_options(self):
		"""Every booking_source value in the Reservation doctype maps to one
		of the 4 dashboard channels — no orphan sources dropped from analytics."""
		reservation_sources = ["Direct", "Staff", "Corporate", "Travel Agent", "OTA", "Event", "Walk In"]
		for src in reservation_sources:
			self.assertIn(src, CHANNEL_MAP, f"Source {src!r} not mapped")
			self.assertIn(CHANNEL_MAP[src], ["Direct", "OTA", "Corporate", "Walk-in"])
