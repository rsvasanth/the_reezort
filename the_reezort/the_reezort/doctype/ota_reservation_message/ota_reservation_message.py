import frappe
from frappe import _
from frappe.model.document import Document


class OTAReservationMessage(Document):
	def validate(self):
		# (source, external_id) must be unique — the OTA-side id is the source of truth
		# for row-level dedupe. Same file re-uploaded doesn't create two rows for the same
		# reservation; two different OTAs with the same numeric external_id are fine.
		if self.source and self.external_id:
			existing = frappe.db.get_value(
				"OTA Reservation Message",
				{
					"source": self.source,
					"external_id": self.external_id,
					"name": ["!=", self.name],
				},
				"name",
			)
			if existing:
				frappe.throw(
					_("OTA Reservation Message with source {0} + external_id {1} already exists as {2}.").format(
						self.source, self.external_id, existing
					)
				)
