import frappe
from frappe import _
from frappe.model.document import Document

from the_reezort.the_reezort.doctype.validators import (
	validate_active_parent,
	validate_link_property,
	validate_unique_within,
)

MAINTENANCE_BLOCKING_STATUSES = {"Under Maintenance", "Out of Order", "Out of Service"}


class Room(Document):
	def validate(self):
		self.validate_parent_property()
		self.validate_active_parents()
		self.validate_room_number()
		self.validate_connections()
		self.apply_sellable_rules()
		self.set_display_status()

	def validate_parent_property(self):
		validate_link_property("Resort Building", self.building, self.resort_property, "Building")
		validate_link_property("Resort Floor", self.floor, self.resort_property, "Floor")
		validate_link_property("Room Type", self.room_type, self.resort_property, "Room Type")

	def validate_active_parents(self):
		validate_active_parent("Resort Property", self.resort_property, "Resort Property")
		validate_active_parent("Resort Building", self.building, "Building")
		validate_active_parent("Resort Floor", self.floor, "Floor")
		validate_active_parent("Room Type", self.room_type, "Room Type")

	def validate_room_number(self):
		validate_unique_within(
			"Room",
			"room_number",
			self.room_number,
			{"resort_property": self.resort_property, "building": self.building},
			None if self.is_new() else self.name,
		)

	def validate_connections(self):
		for row in self.connecting_rooms:
			if row.connected_room == self.name:
				frappe.throw(_("Connected room cannot be the same room."), title=_("Invalid Connection"))

			validate_link_property("Room", row.connected_room, self.resort_property, "Connected Room")

	def apply_sellable_rules(self):
		if self.maintenance_status in MAINTENANCE_BLOCKING_STATUSES and self.sellable_status == "Sellable":
			self.sellable_status = "Not Sellable"

	def set_display_status(self):
		if self.maintenance_status in MAINTENANCE_BLOCKING_STATUSES:
			self.display_status = self.maintenance_status
			return

		if self.sellable_status != "Sellable":
			self.display_status = self.sellable_status
			return

		parts = [self.occupancy_status, self.housekeeping_status]
		self.display_status = " ".join(part for part in parts if part)
