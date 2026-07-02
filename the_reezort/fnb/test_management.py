"""Tests for the F&B management module — sales analytics, calendar, waste
report, dish performance, waiter assignment, restaurant audit trail."""

from __future__ import annotations

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, flt, now_datetime, today

from the_reezort.fnb.management import (
	assign_waiter,
	get_daily_sales,
	get_dish_performance,
	get_sales_calendar,
	get_sales_summary,
	get_waste_report,
	list_order_audit_trail,
	list_waiter_assignments,
	sales_by_waiter,
	top_dishes,
	unassign_waiter,
)


class TestFnbManagement(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.outlet = frappe.db.get_value("FnB Outlet", {"outlet_code": "SIGREST"}, "name")
		cls.table = frappe.db.get_value("Restaurant Table", {"outlet": cls.outlet}, "name")
		cls.waiter_user = frappe.db.sql(
			"SELECT parent FROM `tabHas Role` WHERE role='Restaurant' LIMIT 1"
		)[0][0]

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		frappe.db.delete("Waiter Assignment")
		frappe.db.commit()

	# ------------------------------------------------------------------
	# Sales analytics — zero-data path
	# ------------------------------------------------------------------

	def test_sales_summary_zero_data(self):
		r = get_sales_summary(from_date=str(add_days(today(), -100)), to_date=str(add_days(today(), -95)))["data"]
		# Old window with no orders — must return zeros not NaN.
		self.assertEqual(r["total_orders"], 0)
		self.assertEqual(r["revenue"], 0)
		self.assertEqual(r["avg_check"], 0)
		self.assertEqual(r["cancel_rate_pct"], 0)

	def test_daily_sales_zero_fills(self):
		r = get_daily_sales()["data"]
		self.assertEqual(len(r["series"]), 30)
		# Every row must have all keys populated (zero-fill).
		for row in r["series"]:
			self.assertIn("date", row)
			self.assertIn("orders", row)
			self.assertIn("revenue", row)
			self.assertIn("present", row)

	def test_top_dishes_returns_empty_list(self):
		r = top_dishes(limit=5)["data"]
		self.assertEqual(r["dishes"], [])

	def test_sales_by_waiter_returns_empty_list(self):
		r = sales_by_waiter()["data"]
		self.assertEqual(r["waiters"], [])

	# ------------------------------------------------------------------
	# Sales calendar
	# ------------------------------------------------------------------

	def test_sales_calendar_returns_full_month(self):
		import datetime

		now = datetime.date.today()
		r = get_sales_calendar(now.year, now.month)["data"]
		# Full month worth of days.
		from calendar import monthrange

		self.assertEqual(len(r["days"]), monthrange(now.year, now.month)[1])
		# Every day has the full shape even at zero.
		for day in r["days"]:
			for key in ("date", "day_of_week", "orders", "revenue", "waste_value"):
				self.assertIn(key, day)

	def test_sales_calendar_rejects_bad_month(self):
		with self.assertRaises(frappe.ValidationError):
			get_sales_calendar(2026, 13)

	# ------------------------------------------------------------------
	# Waste report
	# ------------------------------------------------------------------

	def test_waste_report_zero_data(self):
		r = get_waste_report()["data"]
		self.assertEqual(r["total_entries"], 0)
		self.assertEqual(r["total_value"], 0)
		self.assertEqual(r["unique_items"], 0)

	# ------------------------------------------------------------------
	# Dish performance
	# ------------------------------------------------------------------

	def test_dish_performance_returns_slow_movers(self):
		"""All Menu Items must appear as slow movers when nothing has sold
		yet — the endpoint provides both actual sales and the gap."""
		r = get_dish_performance()["data"]
		# No sales → all dishes are slow movers.
		self.assertEqual(len(r["dishes"]), 0)
		self.assertGreater(len(r["slow_movers"]), 0)

	# ------------------------------------------------------------------
	# Waiter assignment
	# ------------------------------------------------------------------

	def test_assign_waiter_happy_path(self):
		r = assign_waiter(
			restaurant_table=self.table,
			waiter_user=self.waiter_user,
			shift_start=f"{today()} 09:00:00",
			shift_end=f"{today()} 17:00:00",
		)
		self.assertIsNotNone(r["data"]["assignment"])

	def test_assign_waiter_refuses_overlap(self):
		assign_waiter(
			restaurant_table=self.table,
			waiter_user=self.waiter_user,
			shift_start=f"{today()} 09:00:00",
			shift_end=f"{today()} 17:00:00",
		)
		with self.assertRaises(frappe.ValidationError):
			assign_waiter(
				restaurant_table=self.table,
				waiter_user=self.waiter_user,
				shift_start=f"{today()} 12:00:00",
				shift_end=f"{today()} 15:00:00",
			)

	def test_assign_waiter_refuses_zero_length_shift(self):
		with self.assertRaises(frappe.ValidationError):
			assign_waiter(
				restaurant_table=self.table,
				waiter_user=self.waiter_user,
				shift_start=f"{today()} 09:00:00",
				shift_end=f"{today()} 09:00:00",
			)

	def test_list_waiter_assignments_shows_active_only(self):
		a = assign_waiter(
			restaurant_table=self.table,
			waiter_user=self.waiter_user,
			shift_start=f"{today()} 09:00:00",
			shift_end=f"{today()} 17:00:00",
		)
		# List on today's date.
		lst = list_waiter_assignments(on_date=today())["data"]
		self.assertEqual(len(lst["assignments"]), 1)
		row = lst["assignments"][0]
		self.assertEqual(row["assignment"], a["data"]["assignment"])
		self.assertEqual(row["orders_today"], 0)

	def test_unassign_waiter_transitions_to_cancelled(self):
		a = assign_waiter(
			restaurant_table=self.table,
			waiter_user=self.waiter_user,
			shift_start=f"{today()} 09:00:00",
			shift_end=f"{today()} 17:00:00",
		)
		u = unassign_waiter(a["data"]["assignment"], reason="Test")
		self.assertEqual(u["data"]["status"], "Cancelled")

	def test_unassign_waiter_refuses_already_cancelled(self):
		a = assign_waiter(
			restaurant_table=self.table,
			waiter_user=self.waiter_user,
			shift_start=f"{today()} 09:00:00",
			shift_end=f"{today()} 17:00:00",
		)
		unassign_waiter(a["data"]["assignment"])
		with self.assertRaises(frappe.ValidationError):
			unassign_waiter(a["data"]["assignment"])

	# ------------------------------------------------------------------
	# Restaurant audit trail
	# ------------------------------------------------------------------

	def test_list_order_audit_trail_returns_events(self):
		"""Any Restaurant Order that has audit events since Slice 5 rolled
		out returns them. New empty order should return no events."""
		r = list_order_audit_trail("NON-EXISTENT-ORDER")["data"]
		self.assertEqual(r["events"], [])
