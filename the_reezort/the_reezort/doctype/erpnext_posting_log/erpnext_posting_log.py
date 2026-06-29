import frappe
from frappe import _
from frappe.model.document import Document


# Allowed posting_status transitions. Posted and Cancelled are terminal.
ALLOWED_TRANSITIONS = {
	"Pending": {"Processing", "Cancelled"},
	"Processing": {"Posted", "Failed", "Cancelled"},
	"Failed": {"Processing", "Cancelled"},
	"Posted": set(),
	"Cancelled": set(),
}


class ERPNextPostingLog(Document):
	def validate(self):
		self.validate_unique_idempotency_key()
		self.validate_status_transition()

	def validate_unique_idempotency_key(self):
		if not self.idempotency_key:
			return

		filters = {"idempotency_key": self.idempotency_key}
		if self.name:
			filters["name"] = ["!=", self.name]

		if frappe.db.exists("ERPNext Posting Log", filters):
			frappe.throw(_("A posting log already exists for idempotency key {0}.").format(self.idempotency_key))

	def validate_status_transition(self):
		if self.is_new():
			return

		previous = self.get_doc_before_save()
		if not previous:
			return

		old_status = previous.posting_status
		new_status = self.posting_status
		if old_status == new_status:
			return

		if new_status not in ALLOWED_TRANSITIONS.get(old_status, set()):
			frappe.throw(
				_("Cannot move posting log from {0} to {1}.").format(old_status, new_status)
			)
