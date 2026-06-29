import frappe
from frappe import _
from frappe.model.document import Document


ALLOWED_TRANSITIONS = {
	"Draft": {"In Progress", "Cancelled"},
	"In Progress": {"Passed", "Failed", "Maintenance Required", "Accepted With Exception", "Cancelled"},
	"Failed": {"Rework Required", "Cancelled"},
}


class RoomInspection(Document):
	def validate(self):
		self.validate_status_transition()
		self.validate_exception_approval()

	def validate_status_transition(self):
		if self.is_new():
			return

		before = self.get_doc_before_save()
		if not before or before.inspection_status == self.inspection_status:
			return

		old_status = before.inspection_status
		new_status = self.inspection_status
		if new_status not in ALLOWED_TRANSITIONS.get(old_status, set()):
			frappe.throw(
				_("Room Inspection cannot move from {0} to {1}.").format(old_status, new_status),
				frappe.ValidationError,
			)

	def validate_exception_approval(self):
		if self.inspection_status == "Accepted With Exception" and not self.exception_approval:
			frappe.throw(_("Accepted-with-exception inspections require an exception approval."), frappe.ValidationError)
