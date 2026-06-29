import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


# Stay status state machine (003 PMS Stay Lifecycle, thin slice).
ALLOWED_TRANSITIONS = {
	"Draft": {"Reserved", "Due In", "In House", "Cancelled"},
	"Reserved": {"Due In", "Cancelled"},
	"Due In": {"In House", "No Show", "Cancelled"},
	"In House": {"Due Out", "Checked Out", "Cancelled"},
	"Due Out": {"Checked Out", "Cancelled"},
	"Checked Out": set(),
	"No Show": set(),
	"Cancelled": set(),
}

ROOM_REQUIRED_STATUSES = {"In House", "Due Out", "Checked Out"}


class Stay(Document):
	def validate(self):
		self.validate_dates()
		self.validate_current_room()
		self.validate_status_transition()

	def validate_dates(self):
		if self.arrival_date and self.departure_date and getdate(self.departure_date) <= getdate(self.arrival_date):
			frappe.throw(_("Departure date must be after arrival date."))

	def validate_current_room(self):
		if self.stay_status in ROOM_REQUIRED_STATUSES and not self.current_room:
			frappe.throw(_("A current room is required once the stay is {0}.").format(self.stay_status))

	def validate_status_transition(self):
		if self.is_new():
			return

		previous = self.get_doc_before_save()
		if not previous or previous.stay_status == self.stay_status:
			return

		if self.stay_status not in ALLOWED_TRANSITIONS.get(previous.stay_status, set()):
			frappe.throw(_("Cannot move stay from {0} to {1}.").format(previous.stay_status, self.stay_status))
