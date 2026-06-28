import frappe
from frappe import _
from frappe.model.document import Document

from the_reezort.the_reezort.doctype.validators import validate_unique_within


class RoomType(Document):
	def validate(self):
		self.validate_occupancy()
		validate_unique_within(
			"Room Type",
			"room_type_code",
			self.room_type_code,
			{"resort_property": self.resort_property},
			None if self.is_new() else self.name,
		)

	def validate_occupancy(self):
		if self.standard_adults and self.max_occupancy and self.standard_adults > self.max_occupancy:
			frappe.throw(
				_("Standard adults cannot exceed maximum occupancy."),
				title=_("Invalid Occupancy"),
			)

		total_standard = (self.standard_adults or 0) + (self.standard_children or 0)

		if total_standard and self.max_occupancy and total_standard > self.max_occupancy:
			frappe.throw(
				_("Standard adults and children cannot exceed maximum occupancy."),
				title=_("Invalid Occupancy"),
			)
