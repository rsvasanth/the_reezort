from frappe.model.document import Document

from the_reezort.the_reezort.doctype.validators import (
	validate_active_parent,
	validate_link_property,
	validate_unique_within,
)


class ResortFloor(Document):
	def validate(self):
		validate_link_property("Resort Building", self.building, self.resort_property, "Building")
		validate_active_parent("Resort Building", self.building, "Building")
		validate_unique_within(
			"Resort Floor",
			"floor_code",
			self.floor_code,
			{"building": self.building},
			None if self.is_new() else self.name,
		)
