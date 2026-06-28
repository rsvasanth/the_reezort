import frappe
from frappe import _
from frappe.model.document import Document

from the_reezort.the_reezort.doctype.validators import validate_link_property, validate_unique_within

REVENUE_LOCATION_TYPES = {"Restaurant", "Bar", "Cafe", "Room Service", "Spa", "Retail", "Activity"}


class ServiceLocation(Document):
	def validate(self):
		self.validate_property_links()
		self.validate_billing_policy()
		validate_unique_within(
			"Service Location",
			"location_code",
			self.location_code,
			{"resort_property": self.resort_property},
			None if self.is_new() else self.name,
		)

	def validate_property_links(self):
		validate_link_property("Resort Building", self.building, self.resort_property, "Building")
		validate_link_property("Resort Floor", self.floor, self.resort_property, "Floor")

	def validate_billing_policy(self):
		if self.location_type in REVENUE_LOCATION_TYPES and not self.can_bill_direct and not self.can_post_to_folio:
			frappe.throw(
				_("Revenue service locations must allow direct billing, guest folio posting, or both."),
				title=_("Billing Policy Required"),
			)
