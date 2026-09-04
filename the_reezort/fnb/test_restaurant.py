"""Restaurant POS + KOT tests — spec 006 · Slice 4."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from the_reezort.approvals.api import ApprovalRequired
from the_reezort.fnb.api import seed_fnb_catalog
from the_reezort.fnb.restaurant import (
	add_items,
	cancel_order,
	close_walk_in,
	get_order,
	list_active_kots,
	list_orders_by_state,
	list_tables,
	mark_kot_status,
	merge_orders,
	open_walk_in_order,
	send_to_kitchen,
	transfer_table,
)
from the_reezort.fnb.table_seed import seed_restaurant_tables
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestRestaurantPos(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]
		seed_fnb_catalog(resort_property=cls.resort_property)
		seed_restaurant_tables(resort_property=cls.resort_property)
		cls.outlet = frappe.db.get_value(
			"FnB Outlet", {"resort_property": cls.resort_property, "outlet_code": "SIGREST"}, "name"
		)

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		# Wipe any open orders from prior test cases so each test starts fresh.
		for name in frappe.get_all(
			"Restaurant Order", filters={"outlet": self.outlet}, pluck="name"
		):
			frappe.delete_doc("Restaurant Order", name, force=True, ignore_permissions=True)

	def _first_two_items(self):
		return frappe.get_all(
			"Menu Item",
			filters={"outlet": self.outlet, "is_available": 1},
			fields=["name", "price"],
			limit=2,
		)

	def _any_table(self):
		return frappe.db.get_value("Restaurant Table", {"outlet": self.outlet, "is_active": 1}, "name")

	# ---------- seeder ----------

	def test_table_seeder_is_idempotent(self):
		before = frappe.db.count("Restaurant Table", {"outlet": self.outlet})
		result = seed_restaurant_tables(resort_property=self.resort_property)
		after = frappe.db.count("Restaurant Table", {"outlet": self.outlet})
		self.assertEqual(before, after)
		self.assertTrue(result["ok"])

	def test_signature_restaurant_has_8_tables(self):
		self.assertEqual(frappe.db.count("Restaurant Table", {"outlet": self.outlet}), 8)

	# ---------- floor plan ----------

	def test_list_tables_returns_vacant_by_default(self):
		result = list_tables(self.outlet)
		self.assertEqual(len(result["data"]["tables"]), 8)
		for t in result["data"]["tables"]:
			self.assertEqual(t["live_status"], "Vacant")
			self.assertIsNone(t["open_order"])

	def test_list_tables_reflects_open_order(self):
		table = self._any_table()
		open_walk_in_order(self.outlet, table)
		result = list_tables(self.outlet)
		by_name = {t["name"]: t for t in result["data"]["tables"]}
		self.assertEqual(by_name[table]["live_status"], "Seated")
		self.assertIsNotNone(by_name[table]["open_order"])

	def test_list_tables_handles_outlet_with_no_tables(self):
		# Regression: an outlet with zero tables (e.g. In-Room Dining) used to
		# crash with IndexError from a malformed Restaurant Order filter.
		outlet_name = f"{self.resort_property}-NOTBL"
		if not frappe.db.exists("FnB Outlet", outlet_name):
			frappe.get_doc(
				{
					"doctype": "FnB Outlet",
					"resort_property": self.resort_property,
					"outlet_name": "No Tables Outlet",
					"outlet_code": "NOTBL",
					"outlet_type": "In-Room Dining",
					"is_active": 1,
				}
			).insert(ignore_permissions=True)
		result = list_tables(outlet_name)
		self.assertTrue(result["ok"])
		self.assertEqual(result["data"]["tables"], [])

	# ---------- lifecycle ----------

	def test_open_walk_in_creates_draft_order(self):
		table = self._any_table()
		result = open_walk_in_order(self.outlet, table, party_size=4, guest_name="Test Guest")
		order = result["data"]["order"]
		self.assertEqual(order["state"], "Draft")
		self.assertEqual(order["party_size"], 4)
		self.assertEqual(order["guest_name"], "Test Guest")
		self.assertEqual(order["table"], table)

	def test_open_walk_in_is_idempotent_on_same_table(self):
		table = self._any_table()
		r1 = open_walk_in_order(self.outlet, table)
		r2 = open_walk_in_order(self.outlet, table)
		self.assertEqual(r1["data"]["order"]["name"], r2["data"]["order"]["name"])
		self.assertTrue(r2["data"]["reused"])

	def test_open_walk_in_rejects_unknown_table(self):
		with self.assertRaises(frappe.ValidationError):
			open_walk_in_order(self.outlet, "FAKE-TABLE-999")

	def test_add_items_computes_totals(self):
		table = self._any_table()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		items = self._first_two_items()
		add_result = add_items(
			order["name"],
			[
				{"menu_item": items[0].name, "quantity": 2},
				{"menu_item": items[1].name, "quantity": 1},
			],
		)
		result_order = add_result["data"]["order"]
		self.assertEqual(len(result_order["items"]), 2)
		expected_subtotal = flt(items[0].price) * 2 + flt(items[1].price)
		self.assertAlmostEqual(result_order["subtotal"], expected_subtotal, delta=1)
		# grand_total = subtotal + service + tax; both should be > subtotal (18% GST default)
		self.assertGreater(result_order["grand_total"], expected_subtotal)

	def test_add_items_ignores_a_client_supplied_rate(self):
		"""Regression: add_items used to accept row.get("rate") over the menu
		price, letting any caller with Restaurant Order write access (waiters,
		cooks) post an arbitrary price for a dish."""
		table = self._any_table()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		items = self._first_two_items()

		add_result = add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1, "rate": 1}])

		posted_rate = add_result["data"]["order"]["items"][0]["rate"]
		self.assertEqual(flt(posted_rate), flt(items[0].price))
		self.assertNotEqual(flt(posted_rate), 1)

	def test_add_items_allowed_after_kitchen_send_but_not_when_settling(self):
		# Multi-round dining: a second round can be added after the first is fired.
		table = self._any_table()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		items = self._first_two_items()
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		send_to_kitchen(order["name"])
		# Now in "Sent to Kitchen" — a further round is allowed.
		add_items(order["name"], [{"menu_item": items[1].name, "quantity": 1}])
		# But once the bill is being settled, no more items.
		frappe.db.set_value("Restaurant Order", order["name"], "state", "Bill Pending")
		with self.assertRaises(frappe.ValidationError):
			add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])

	def test_add_items_rejects_wrong_outlet_item(self):
		# Create an item in another outlet.
		other_outlet = frappe.db.get_value(
			"FnB Outlet", {"resort_property": self.resort_property, "outlet_code": "POOLBAR"}, "name"
		)
		other_item = frappe.get_all(
			"Menu Item", filters={"outlet": other_outlet}, pluck="name", limit=1
		)
		self.assertTrue(other_item)
		table = self._any_table()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		with self.assertRaises(frappe.ValidationError):
			add_items(order["name"], [{"menu_item": other_item[0], "quantity": 1}])

	def test_send_to_kitchen_transitions_state_and_stamps_items(self):
		table = self._any_table()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		items = self._first_two_items()
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		result = send_to_kitchen(order["name"])
		out = result["data"]["order"]
		self.assertEqual(out["state"], "Sent to Kitchen")
		self.assertTrue(out["kot_number"].startswith("KOT-SIGREST-"))
		self.assertIsNotNone(out["sent_to_kitchen_at"])
		for item in out["items"]:
			self.assertEqual(item["line_status"], "Sent")
			self.assertIsNotNone(item["sent_at"])

	def test_send_to_kitchen_rejects_empty_order(self):
		table = self._any_table()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		with self.assertRaises(frappe.ValidationError):
			send_to_kitchen(order["name"])

	def test_list_active_kots_returns_orders_in_kitchen_states(self):
		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		send_to_kitchen(order["name"])
		result = list_active_kots(self.outlet)
		self.assertEqual(len(result["data"]["orders"]), 1)
		self.assertEqual(result["data"]["orders"][0]["name"], order["name"])

	def test_state_machine_marches_forward_correctly(self):
		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		send_to_kitchen(order["name"])

		mark_kot_status(order["name"], "Preparing")
		self.assertEqual(get_order(order["name"])["data"]["order"]["state"], "Preparing")

		mark_kot_status(order["name"], "Ready")
		out = get_order(order["name"])["data"]["order"]
		self.assertEqual(out["state"], "Ready")
		self.assertIsNotNone(out["ready_at"])

		mark_kot_status(order["name"], "Served")
		out = get_order(order["name"])["data"]["order"]
		self.assertEqual(out["state"], "Served")
		self.assertIsNotNone(out["served_at"])

	def test_invalid_transitions_are_rejected(self):
		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		# Draft → Ready is not allowed.
		with self.assertRaises(frappe.ValidationError):
			mark_kot_status(order["name"], "Ready")

	def test_close_walk_in_creates_sales_invoice_and_settles(self):
		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 2}])
		send_to_kitchen(order["name"])
		mark_kot_status(order["name"], "Preparing")
		mark_kot_status(order["name"], "Ready")
		mark_kot_status(order["name"], "Served")

		order_state = get_order(order["name"])["data"]["order"]
		order_grand_total = order_state["grand_total"]
		result = close_walk_in(order["name"], payments=[{"mode_of_payment": "Cash", "amount": order_grand_total}])

		self.assertEqual(result["data"]["order"]["state"], "Settled")
		self.assertIsNotNone(result["data"]["sales_invoice"])
		self.assertIsNotNone(result["data"]["payment_entry"])
		# SI is submitted; SI grand_total = subtotal + tax (service charge is not
		# on the SI in Slice 4 — it's added in Slice 5). SI grand_total should
		# always be <= order.grand_total.
		si_doc = frappe.get_doc("Sales Invoice", result["data"]["sales_invoice"])
		self.assertEqual(si_doc.docstatus, 1)
		self.assertLessEqual(flt(si_doc.grand_total), flt(order_grand_total) + 1)

	def test_close_walk_in_is_idempotent(self):
		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		send_to_kitchen(order["name"])
		mark_kot_status(order["name"], "Preparing")
		mark_kot_status(order["name"], "Ready")
		mark_kot_status(order["name"], "Served")
		grand_total = get_order(order["name"])["data"]["order"]["grand_total"]
		r1 = close_walk_in(order["name"], payments=[{"mode_of_payment": "Cash", "amount": grand_total}])
		r2 = close_walk_in(order["name"])
		self.assertEqual(r1["data"]["order"]["erpnext_sales_invoice"], r2["data"]["order"]["erpnext_sales_invoice"])
		self.assertTrue(r2["data"]["reused"])

	def test_cancel_order(self):
		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		result = cancel_order(order["name"], reason="Guest walked out")
		self.assertEqual(result["data"]["order"]["state"], "Cancelled")

	def test_close_walk_in_works_for_restaurant_only_user(self):
		"""Regression guard: prod QA (2026-07-02) hit HTTP 403 'No permission for
		Item Price' when a Restaurant / Resort Manager operator closed a walk-in.
		The SI/PE posting path must run elevated so it can touch Item Price /
		GL Entry / Stock Ledger that operational roles don't own."""
		# Seed a user with ONLY the Restaurant role — no Accounts access.
		test_user = "waiter.pos.test@thereezort.com"
		if not frappe.db.exists("User", test_user):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": test_user,
					"first_name": "Test",
					"send_welcome_email": 0,
					"roles": [{"role": "Restaurant"}],
				}
			).insert(ignore_permissions=True)

		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		send_to_kitchen(order["name"])
		mark_kot_status(order["name"], "Preparing")
		mark_kot_status(order["name"], "Ready")
		mark_kot_status(order["name"], "Served")
		grand_total = get_order(order["name"])["data"]["order"]["grand_total"]

		# Switch to the low-privilege user and close the walk-in — must succeed.
		original = frappe.session.user
		try:
			frappe.set_user(test_user)
			result = close_walk_in(order["name"], payments=[{"mode_of_payment": "Cash", "amount": grand_total}])
		finally:
			frappe.set_user(original)

		self.assertEqual(result["data"]["order"]["state"], "Settled")
		self.assertIsNotNone(result["data"]["sales_invoice"])
		self.assertIsNotNone(result["data"]["payment_entry"])
		# And after the elevated block ends, session.user should be restored.
		self.assertEqual(frappe.session.user, "Administrator")

	def test_open_walk_in_order_blocked_for_unprivileged_role(self):
		"""Security regression guard (2026-07-10 audit): every Restaurant endpoint
		used to only check frappe.session.user != "Guest" — any authenticated
		staff login (e.g. Housekeeping) could open/settle POS orders. Endpoints
		must now enforce doctype-level RBAC via frappe.has_permission."""
		test_user = "housekeeping.pos.test@thereezort.com"
		if not frappe.db.exists("User", test_user):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": test_user,
					"first_name": "Test",
					"send_welcome_email": 0,
					"roles": [{"role": "Housekeeping"}],
				}
			).insert(ignore_permissions=True)

		table = self._any_table()
		original = frappe.session.user
		try:
			frappe.set_user(test_user)
			with self.assertRaises(frappe.PermissionError):
				open_walk_in_order(self.outlet, table)
		finally:
			frappe.set_user(original)

	def test_cancel_served_order(self):
		"""Comp'd meal / walkout / dispute path — a manager can void a Served
		order without ever settling. Regression guard for a T02 order stuck
		in Served on prod because Served → Cancelled wasn't in the state machine."""
		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		send_to_kitchen(order["name"])
		mark_kot_status(order["name"], "Preparing")
		mark_kot_status(order["name"], "Ready")
		mark_kot_status(order["name"], "Served")
		result = cancel_order(order["name"], reason="Guest comp'd — manager sign-off")
		self.assertEqual(result["data"]["order"]["state"], "Cancelled")

	# ---------- KDS financial-leak guard (spec.md:829) ----------

	def test_kds_payload_hides_financial_totals(self):
		"""The kitchen role must never see money (spec 006, spec.md:829). The
		KDS payload carries prep data only — no order totals, no per-item price."""
		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 2}])
		send_to_kitchen(order["name"])
		kot = list_active_kots(self.outlet)["data"]["orders"][0]
		for money_field in (
			"subtotal",
			"discount_amount",
			"service_charge_amount",
			"total_taxes",
			"grand_total",
			"currency",
		):
			self.assertNotIn(money_field, kot)
		self.assertTrue(kot["items"])
		for line in kot["items"]:
			self.assertNotIn("rate", line)
			self.assertNotIn("amount", line)
			# Prep data the kitchen DOES need is still present.
			self.assertIn("item_name", line)
			self.assertIn("line_status", line)

	# ---------- post-KOT void approval gate (spec.md:179) ----------

	def _seed_void_policy(self, auto_role=None, threshold=0):
		"""Create an active restaurant_void Approval Policy for the current test.

		Approval Policy autonames on (action, threshold_amount) alone, so every
		call here — from any test in this class, or a prior run that committed
		for real — targets the same row. Clear it first so tests don't collide.
		"""
		frappe.db.delete("Approval Policy", {"action": "restaurant_void", "threshold_amount": threshold})
		return frappe.get_doc(
			{
				"doctype": "Approval Policy",
				"policy_name": f"restaurant_void test {auto_role or 'none'}",
				"action": "restaurant_void",
				"approver_role": "Resort Manager",
				"auto_approve_for_role": auto_role,
				"threshold_amount": threshold,
				"source_doctype": "Restaurant Order",
				"is_active": 1,
			}
		).insert(ignore_permissions=True)

	def test_post_kot_void_requires_approval(self):
		"""Voiding an order the kitchen has already seen needs manager sign-off
		when a restaurant_void policy is active (spec 006, spec.md:179)."""
		self._seed_void_policy()
		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		send_to_kitchen(order["name"])
		with self.assertRaises(ApprovalRequired):
			cancel_order(order["name"], reason="waiter tried to void a fired ticket")
		# The order must remain in its pre-void state.
		self.assertEqual(get_order(order["name"])["data"]["order"]["state"], "Sent to Kitchen")

	def test_draft_void_is_free_even_with_policy(self):
		"""A Draft order (nothing sent to the kitchen) cancels without approval —
		the gate is specific to post-KOT voids."""
		self._seed_void_policy()
		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		result = cancel_order(order["name"], reason="guest left before ordering")
		self.assertEqual(result["data"]["order"]["state"], "Cancelled")

	def test_post_kot_void_proceeds_when_auto_approved(self):
		"""With an auto-approve role the requester holds, the void proceeds —
		the manager-self-serve path (still audited)."""
		self._seed_void_policy(auto_role="System Manager")  # Administrator holds it
		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		send_to_kitchen(order["name"])
		result = cancel_order(order["name"], reason="manager comp")
		self.assertEqual(result["data"]["order"]["state"], "Cancelled")

	# ---------- table transfer + merge (spec 006 Workflow 4) ----------

	def _two_tables(self):
		tables = frappe.get_all(
			"Restaurant Table", filters={"outlet": self.outlet, "is_active": 1}, pluck="name", limit=2
		)
		self.assertEqual(len(tables), 2)
		return tables[0], tables[1]

	def test_transfer_table_moves_open_order(self):
		t1, t2 = self._two_tables()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, t1)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		out = transfer_table(order["name"], t2)["data"]["order"]
		self.assertEqual(out["table"], t2)

	def test_transfer_rejects_occupied_table(self):
		t1, t2 = self._two_tables()
		a = open_walk_in_order(self.outlet, t1)["data"]["order"]
		open_walk_in_order(self.outlet, t2)  # t2 now occupied
		with self.assertRaises(frappe.ValidationError):
			transfer_table(a["name"], t2)

	def test_transfer_rejects_settled_order(self):
		t1, t2 = self._two_tables()
		order = open_walk_in_order(self.outlet, t1)["data"]["order"]
		frappe.db.set_value("Restaurant Order", order["name"], "state", "Settled")
		with self.assertRaises(frappe.ValidationError):
			transfer_table(order["name"], t2)

	def test_merge_orders_combines_items_and_cancels_source(self):
		t1, t2 = self._two_tables()
		items = self._first_two_items()
		primary = open_walk_in_order(self.outlet, t1)["data"]["order"]
		add_items(primary["name"], [{"menu_item": items[0].name, "quantity": 1}])
		source = open_walk_in_order(self.outlet, t2)["data"]["order"]
		add_items(source["name"], [{"menu_item": items[1].name, "quantity": 2}])

		out = merge_orders(primary["name"], source["name"])["data"]
		self.assertEqual(out["absorbed"], source["name"])
		self.assertEqual(len(out["order"]["items"]), 2)
		# Source is cancelled and emptied; primary carries both lines.
		self.assertEqual(frappe.db.get_value("Restaurant Order", source["name"], "state"), "Cancelled")
		self.assertGreater(out["order"]["grand_total"], 0)

	def test_merge_rejects_self(self):
		t1, _ = self._two_tables()
		order = open_walk_in_order(self.outlet, t1)["data"]["order"]
		with self.assertRaises(frappe.ValidationError):
			merge_orders(order["name"], order["name"])

	def test_merge_rejects_settled_source(self):
		t1, t2 = self._two_tables()
		primary = open_walk_in_order(self.outlet, t1)["data"]["order"]
		source = open_walk_in_order(self.outlet, t2)["data"]["order"]
		frappe.db.set_value("Restaurant Order", source["name"], "state", "Settled")
		with self.assertRaises(frappe.ValidationError):
			merge_orders(primary["name"], source["name"])

	def test_list_orders_by_state_filter(self):
		table = self._any_table()
		items = self._first_two_items()
		order = open_walk_in_order(self.outlet, table)["data"]["order"]
		add_items(order["name"], [{"menu_item": items[0].name, "quantity": 1}])
		# Draft filter
		drafts = list_orders_by_state(self.outlet, states=["Draft"])["data"]["orders"]
		self.assertEqual(len(drafts), 1)
		# Send + filter should now show empty Drafts
		send_to_kitchen(order["name"])
		drafts_after = list_orders_by_state(self.outlet, states=["Draft"])["data"]["orders"]
		self.assertEqual(len(drafts_after), 0)
		sent_after = list_orders_by_state(self.outlet, states=["Sent to Kitchen"])["data"]["orders"]
		self.assertEqual(len(sent_after), 1)
