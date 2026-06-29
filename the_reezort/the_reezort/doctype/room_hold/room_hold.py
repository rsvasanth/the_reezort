import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime

from the_reezort.the_reezort.doctype.validators import validate_link_property


class RoomHold(Document):
	def validate(self):
		if self.start_date and self.end_date and self.end_date <= self.start_date:
			frappe.throw(_("Hold end date must be after start date."))

		if self.room_type:
			validate_link_property("Room Type", self.room_type, self.resort_property, "Room Type")
		if self.room:
			validate_link_property("Room", self.room, self.resort_property, "Room")

		if not self.quantity or self.quantity < 1:
			self.quantity = 1

		if self.status == "Active" and self.expires_at and self.expires_at <= now_datetime():
			self.status = "Expired"
