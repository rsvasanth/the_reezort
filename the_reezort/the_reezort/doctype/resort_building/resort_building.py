from frappe.model.document import Document

from the_reezort.the_reezort.doctype.validators import validate_unique_within


class ResortBuilding(Document):
	def validate(self):
		validate_unique_within(
			"Resort Building",
			"building_code",
			self.building_code,
			{"resort_property": self.resort_property},
			None if self.is_new() else self.name,
		)
