"""Spa Room — treatment/wellness room (spec 001 §Spa Room).

Schema + validation only; appointment booking is out of scope for 001 and
belongs to the spa/activities child spec (007). Kept distinct from Activity
Area (broad recreational areas) because the spec models it as its own entity
with an outlet link and a turnover buffer.
"""

import frappe
from frappe import _
from frappe.model.document import Document

from the_reezort.the_reezort.doctype.validators import validate_link_property


class SpaRoom(Document):
	def validate(self):
		if self.outlet:
			validate_link_property(
				"Service Location", self.outlet, self.resort_property, "Outlet"
			)
		if self.capacity is not None and int(self.capacity or 0) < 0:
			frappe.throw(_("Capacity cannot be negative."), frappe.ValidationError)
		if self.default_duration_buffer is not None and int(self.default_duration_buffer or 0) < 0:
			frappe.throw(_("Duration buffer cannot be negative."), frappe.ValidationError)
