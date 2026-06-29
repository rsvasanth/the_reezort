import frappe
from frappe import _
from frappe.model.document import Document


CLOSED_FOLIO_STATUSES = {"Closed", "Settled", "Cancelled"}
IMMUTABLE_LINE_STATUSES = {"Posted", "Credited", "Refunded", "Written Off"}
IMMUTABLE_FIELDS = (
	"guest_folio",
	"line_type",
	"source_module",
	"source_doctype",
	"source_name",
	"source_row_id",
	"idempotency_key",
	"service_date",
	"department",
	"cost_center",
	"item_code",
	"description",
	"qty",
	"rate",
	"amount",
	"tax_treatment",
	"discount_amount",
	"line_status",
)


class FolioLine(Document):
	def validate(self):
		self.validate_unique_idempotency_key()
		self.validate_parent_accepts_charge()
		self.validate_immutable_posted_line()

	def after_insert(self):
		self.update_folio_totals()

	def on_update(self):
		self.update_folio_totals()

	def on_trash(self):
		self.update_folio_totals()

	def validate_unique_idempotency_key(self):
		if not self.idempotency_key:
			return

		filters = {"idempotency_key": self.idempotency_key}
		if self.name:
			filters["name"] = ["!=", self.name]

		if frappe.db.exists("Folio Line", filters):
			frappe.throw(_("Duplicate folio line idempotency key is not allowed."))

	def validate_parent_accepts_charge(self):
		if not self.is_new() or self.line_type != "Charge":
			return

		folio_status = frappe.db.get_value("Guest Folio", self.guest_folio, "folio_status")
		if folio_status in CLOSED_FOLIO_STATUSES:
			frappe.throw(_("Cannot add charge lines to a {0} folio.").format(folio_status))

	def validate_immutable_posted_line(self):
		if self.is_new():
			return

		previous = self.get_doc_before_save()
		if not previous or previous.line_status not in IMMUTABLE_LINE_STATUSES:
			return

		for fieldname in IMMUTABLE_FIELDS:
			if self.get(fieldname) != previous.get(fieldname):
				frappe.throw(_("Folio Line cannot be edited after it is {0}.").format(previous.line_status))

	def update_folio_totals(self):
		if not self.guest_folio or not frappe.db.exists("Guest Folio", self.guest_folio):
			return

		folio = frappe.get_doc("Guest Folio", self.guest_folio)
		folio.recalculate_totals()
		folio.db_update()
