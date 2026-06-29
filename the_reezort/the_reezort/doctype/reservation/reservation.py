import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import date_diff, now_datetime

from the_reezort.the_reezort.doctype.validators import validate_active_parent, validate_link_property


FINAL_STATUSES = {"Cancelled", "No Show", "Checked In", "Completed"}


class Reservation(Document):
	def validate(self):
		self.validate_dates()
		self.validate_property_links()
		self.validate_guests()
		self.set_nights()
		self.set_currency()
		self.set_room_totals()

	def validate_dates(self):
		if self.arrival_date and self.departure_date and self.departure_date <= self.arrival_date:
			frappe.throw(_("Departure date must be after arrival date."), title=_("Invalid Stay Dates"))

	def validate_property_links(self):
		validate_active_parent("Resort Property", self.resort_property, "Resort Property")

		for row in self.rooms:
			validate_link_property("Room Type", row.room_type, self.resort_property, "Room Type")
			if row.room:
				validate_link_property("Room", row.room, self.resort_property, "Room")

	def validate_guests(self):
		if self.status in {"Confirmed", "Checked In"} and not self.guests:
			frappe.throw(_("At least one guest is required for confirmed reservations."))

		primary_count = sum(1 for row in self.guests if row.is_primary_guest)
		if self.guests and primary_count != 1:
			frappe.throw(_("Exactly one primary guest is required."))

	def set_nights(self):
		self.nights = date_diff(self.departure_date, self.arrival_date) if self.arrival_date and self.departure_date else 0

	def set_currency(self):
		if not self.currency and self.resort_property:
			self.currency = frappe.db.get_value("Resort Property", self.resort_property, "default_currency")

	def set_room_totals(self):
		self.total_estimated_amount = sum(row.estimated_amount or 0 for row in self.rooms)

	def before_save(self):
		if self.status == "Confirmed" and not self.confirmed_at:
			self.confirmed_at = now_datetime()
		if self.status == "Cancelled" and not self.cancelled_at:
			self.cancelled_at = now_datetime()

	def on_update(self):
		if self.status == "Confirmed":
			frappe.db.set_value(
				"Room Hold",
				{"reservation": self.name, "status": "Active"},
				"status",
				"Consumed",
			)
		elif self.status in FINAL_STATUSES:
			frappe.db.set_value(
				"Room Hold",
				{"reservation": self.name, "status": "Active"},
				"status",
				"Released",
			)
