import frappe
from frappe import _
from frappe.model.document import Document


class ActivityArea(Document):
	def validate(self):
		self._validate_area_code_unique()
		self._validate_service_location_property()

	def _validate_area_code_unique(self):
		"""area_code must be unique within a resort_property."""
		existing = frappe.db.get_value(
			"Activity Area",
			{
				"resort_property": self.resort_property,
				"area_code": self.area_code,
				"name": ("!=", self.name or ""),
			},
			"name",
		)
		if existing:
			frappe.throw(
				_("Activity Area code {0} already exists under property {1}.").format(
					self.area_code, self.resort_property
				)
			)

	def _validate_service_location_property(self):
		"""If a Service Location is linked, it must belong to the same property."""
		if not self.linked_service_location:
			return
		sl_property = frappe.db.get_value(
			"Service Location", self.linked_service_location, "resort_property"
		)
		if sl_property and sl_property != self.resort_property:
			frappe.throw(
				_("Service Location {0} does not belong to property {1}.").format(
					self.linked_service_location, self.resort_property
				)
			)
