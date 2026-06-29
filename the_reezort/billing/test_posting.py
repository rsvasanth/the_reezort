import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.billing.posting import get_or_create_posting_log, run_posting
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


class TestERPNextPostingLog(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
			"Company", {}, "name"
		)
		cls.currency = frappe.db.get_value("Company", cls.company, "default_currency") or "INR"
		seed_erpnext_demo_masters(cls.company, currency=cls.currency)
		seed = seed_demo_property(cls.company)
		cls.resort_property = seed["property"]
		cls.customer = frappe.db.get_value("Customer", {"customer_name": "Walk-in Guest"}, "name")

		folio = frappe.get_doc(
			{
				"doctype": "Guest Folio",
				"resort_property": cls.resort_property,
				"company": cls.company,
				"customer": cls.customer,
				"currency": cls.currency,
				"folio_status": "Open",
			}
		).insert(ignore_permissions=True, ignore_links=True)
		cls.source_doctype = "Guest Folio"
		cls.source_name = folio.name
		cls.initial_sales_invoice_count = frappe.db.count("Sales Invoice")
		cls.initial_payment_entry_count = frappe.db.count("Payment Entry")
		# run_posting commits, so use a unique key prefix per run to avoid colliding
		# with committed logs from earlier runs (idempotency_key is unique).
		cls.key_prefix = frappe.generate_hash(length=10)

	@classmethod
	def tearDownClass(cls):
		frappe.db.delete("ERPNext Posting Log", {"idempotency_key": ("like", f"{cls.key_prefix}%")})
		frappe.db.commit()
		super().tearDownClass()

	def _key(self, suffix):
		return f"{self.key_prefix}-{suffix}"

	def _run(self, suffix, operation):
		return run_posting("Folio Settlement", self.source_doctype, self.source_name, self._key(suffix), operation)

	def test_get_or_create_posting_log_is_idempotent(self):
		key = self._key("IDEM")
		first = get_or_create_posting_log("Folio Settlement", self.source_doctype, self.source_name, key)
		second = get_or_create_posting_log("Folio Settlement", self.source_doctype, self.source_name, key)

		self.assertEqual(first.name, second.name)
		self.assertEqual(frappe.db.count("ERPNext Posting Log", {"idempotency_key": key}), 1)

	def test_successful_posting_marks_posted_and_stores_results(self):
		result = self._run("OK", lambda: {"sales_invoices": ["ACC-SINV-TEST-001"]})

		self.assertEqual(result["posting_status"], "Posted")
		self.assertFalse(result["reused"])
		self.assertEqual(result["results"]["sales_invoices"], ["ACC-SINV-TEST-001"])
		self.assertEqual(frappe.db.get_value("ERPNext Posting Log", result["posting_log"], "retry_count"), 0)

	def test_already_posted_key_reuses_result_without_rerunning(self):
		calls = {"count": 0}

		def operation():
			calls["count"] += 1
			return {"payment_entries": ["ACC-PAY-TEST-001"]}

		first = self._run("REUSE", operation)
		second = self._run("REUSE", operation)

		self.assertEqual(calls["count"], 1)
		self.assertFalse(first["reused"])
		self.assertTrue(second["reused"])
		self.assertEqual(second["results"]["payment_entries"], ["ACC-PAY-TEST-001"])

	def test_failed_posting_marks_failed_increments_retry_and_reraises(self):
		def operation():
			raise ValueError("simulated posting failure")

		with self.assertRaises(ValueError):
			self._run("FAIL", operation)

		log = frappe.get_doc("ERPNext Posting Log", {"idempotency_key": self._key("FAIL")})
		self.assertEqual(log.posting_status, "Failed")
		self.assertEqual(log.retry_count, 1)
		self.assertIn("simulated posting failure", log.error_message)

	def test_retry_after_failure_can_succeed(self):
		state = {"fail": True}

		def operation():
			if state["fail"]:
				state["fail"] = False
				raise ValueError("first attempt fails")
			return {"sales_invoices": ["ACC-SINV-RETRY-001"]}

		with self.assertRaises(ValueError):
			self._run("RETRY", operation)

		result = self._run("RETRY", operation)
		self.assertEqual(result["posting_status"], "Posted")
		self.assertEqual(result["results"]["sales_invoices"], ["ACC-SINV-RETRY-001"])
		self.assertEqual(frappe.db.get_value("ERPNext Posting Log", result["posting_log"], "retry_count"), 1)

	def test_duplicate_idempotency_key_is_rejected_at_doctype_level(self):
		key = self._key("DUP")
		get_or_create_posting_log("Folio Settlement", self.source_doctype, self.source_name, key)

		with self.assertRaises(Exception):
			frappe.get_doc(
				{
					"doctype": "ERPNext Posting Log",
					"posting_type": "Folio Settlement",
					"source_doctype": self.source_doctype,
					"source_name": self.source_name,
					"idempotency_key": key,
					"posting_status": "Pending",
				}
			).insert(ignore_permissions=True)

	def test_posted_log_cannot_transition_back(self):
		result = self._run("TERMINAL", lambda: {"sales_invoices": ["ACC-SINV-TERM-001"]})
		log = frappe.get_doc("ERPNext Posting Log", result["posting_log"])

		log.posting_status = "Processing"
		with self.assertRaises(frappe.ValidationError):
			log.save(ignore_permissions=True)

	def test_no_real_erpnext_documents_are_created_by_scaffold(self):
		self._run("NODOCS", lambda: {"sales_invoices": ["ACC-SINV-FAKE-001"]})

		self.assertEqual(frappe.db.count("Sales Invoice"), self.initial_sales_invoice_count)
		self.assertEqual(frappe.db.count("Payment Entry"), self.initial_payment_entry_count)
