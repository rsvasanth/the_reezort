import frappe
from frappe import _
from frappe.model.document import Document


class EventSpace(Document):
	def validate(self):
		self._validate_space_code_unique()
		self._validate_combination_rows()

	def _validate_space_code_unique(self):
		"""space_code must be unique within a resort_property."""
		existing = frappe.db.get_value(
			"Event Space",
			{
				"resort_property": self.resort_property,
				"space_code": self.space_code,
				"name": ("!=", self.name or ""),
			},
			"name",
		)
		if existing:
			frappe.throw(
				_("Event Space code {0} already exists under property {1}.").format(
					self.space_code, self.resort_property
				)
			)

	def _validate_combination_rows(self):
		"""Each combination row must reference a different Event Space (no self-reference)."""
		for row in self.get("combined_with") or []:
			if row.event_space == self.name:
				frappe.throw(
					_("An Event Space cannot list itself as a combinable space.")
				)
