"""Guest Complaint — investigation and resolution lifecycle."""

import frappe
from frappe import _
from frappe.model.document import Document


class GuestComplaint(Document):
	def validate(self):
		self._require_resolution_summary_before_close()
		self._auto_escalate_legal_safety()
		self._set_owner_default()

	def _require_resolution_summary_before_close(self):
		if self.status == "Closed" and not self.resolution_summary:
			frappe.throw(_("Resolution Summary is required before a complaint can be Closed."))

	def _auto_escalate_legal_safety(self):
		"""Flag escalation when legal or safety risk is raised."""
		if self.legal_or_safety_risk and self.status not in (
			"Escalated",
			"Resolved",
			"Closed",
		):
			self.status = "Escalated"

	def _set_owner_default(self):
		if not self.owner_user:
			self.owner_user = frappe.session.user
