import frappe
from frappe import _
from frappe.model.document import Document


ACTIVE_STATUSES = {"Queued", "Assigned", "In Progress", "Paused", "Completed", "Inspection Required", "Rework Required"}
ALLOWED_TRANSITIONS = {
	"Queued": {"Assigned", "Cancelled"},
	"Assigned": {"In Progress", "Skipped", "Cancelled"},
	"In Progress": {"Paused", "Completed", "Cancelled"},
	"Paused": {"In Progress", "Cancelled"},
	"Completed": {"Inspection Required", "Cancelled"},
	"Inspection Required": {"Rework Required", "Cancelled"},
	"Rework Required": {"Assigned", "Cancelled"},
}


class HousekeepingTask(Document):
	def validate(self):
		self.validate_status_transition()
		self.validate_skip_approval()

	def validate_status_transition(self):
		if self.is_new():
			return

		before = self.get_doc_before_save()
		if not before or before.task_status == self.task_status:
			return

		old_status = before.task_status
		new_status = self.task_status
		if new_status == "Cancelled" and old_status in ACTIVE_STATUSES:
			return

		if new_status not in ALLOWED_TRANSITIONS.get(old_status, set()):
			frappe.throw(
				_("Housekeeping Task cannot move from {0} to {1}.").format(old_status, new_status),
				frappe.ValidationError,
			)

	def validate_skip_approval(self):
		if self.task_status == "Skipped" and not self.exception_approval:
			frappe.throw(_("Skipped housekeeping tasks require an exception approval."), frappe.ValidationError)
