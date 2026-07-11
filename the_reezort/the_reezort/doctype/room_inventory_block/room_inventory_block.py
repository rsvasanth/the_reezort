"""Room Inventory Block — manual operational room or room-type hold.

Prevents the same room being double-blocked (hard block) and prevents
room-type scope blocks from over-blocking below zero sellable rooms.
"""

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, now_datetime

from the_reezort.the_reezort.doctype.validators import validate_link_property


class RoomInventoryBlock(Document):
	def before_insert(self):
		if not self.created_by:
			self.created_by = frappe.session.user
		if not self.status:
			self.status = "Active"

	def validate(self):
		self._validate_scope()
		self._validate_dates()
		self._validate_property_links()
		self._check_hard_block_overlap()

	# ------------------------------------------------------------------ #
	# Private helpers                                                       #
	# ------------------------------------------------------------------ #

	def _validate_scope(self):
		if self.scope == "Room" and not self.room:
			frappe.throw(
				_("Room is required when Scope is 'Room'."),
				frappe.MandatoryError,
			)
		if self.scope == "Room Type" and not self.room_type:
			frappe.throw(
				_("Room Type is required when Scope is 'Room Type'."),
				frappe.MandatoryError,
			)

	def _validate_dates(self):
		if not self.start_date or not self.end_date:
			return
		if getdate(self.end_date) < getdate(self.start_date):
			frappe.throw(
				_("End Date cannot be before Start Date."),
				frappe.ValidationError,
			)

	def _validate_property_links(self):
		if self.room:
			validate_link_property("Room", self.room, self.resort_property, "Room")
		if self.room_type:
			validate_link_property(
				"Room Type", self.room_type, self.resort_property, "Room Type"
			)

	def _check_hard_block_overlap(self):
		"""Enforce hard-block exclusivity rules.

		Room scope:   no two hard blocks on the same room can overlap.
		Room Type scope: total overlapping hard blocks cannot exceed the
		                 number of active physical rooms of that type.
		Only checked when the current block is Active (so editing a
		Released/Cancelled block never re-triggers the guard).
		"""
		if not self.is_hard_block or self.status in ("Released", "Cancelled"):
			return

		if self.scope == "Room" and self.room:
			self._guard_room_overlap()
		elif self.scope == "Room Type" and self.room_type:
			self._guard_room_type_over_block()

	def _overlap_policy(self):
		"""The property's hard_block_overlap_policy setting drives how strictly
		overlaps are rejected. Defaults to Strict when unset.

		- Strict:            any overlapping active hard block is rejected.
		- Allow Same Source: overlap allowed only when every overlapping block
		                     shares this block's (source_doctype, source_name);
		                     a different source (or a manual/unsourced block
		                     overlapping a sourced one) is still rejected.
		- Manual Approval:   overlap is permitted (a human reconciles it
		                     operationally); no hard rejection here.
		"""
		from the_reezort.the_reezort.doctype.property_settings.property_settings import (
			_get_setting_or_none,
		)

		return _get_setting_or_none(self.resort_property, "hard_block_overlap_policy") or "Strict"

	def _guard_room_overlap(self):
		policy = self._overlap_policy()
		if policy == "Manual Approval":
			return

		filters = {
			"scope": "Room",
			"room": self.room,
			"is_hard_block": 1,
			"status": "Active",
			"start_date": ["<", self.end_date],
			"end_date": [">", self.start_date],
		}
		if self.name:
			filters["name"] = ["!=", self.name]

		overlapping = frappe.get_all(
			"Room Inventory Block",
			filters=filters,
			fields=["name", "source_doctype", "source_name"],
		)
		if not overlapping:
			return

		if policy == "Allow Same Source":
			same_source = all(
				(b.source_doctype or "") == (self.source_doctype or "")
				and (b.source_name or "") == (self.source_name or "")
				for b in overlapping
			)
			if same_source:
				return

		frappe.throw(
			_(
				"A hard block already exists for Room {0} overlapping {1} to {2}. "
				"Release or cancel the existing block first."
			).format(self.room, self.start_date, self.end_date),
			frappe.ValidationError,
			title=_("Overlapping Block"),
		)

	def _guard_room_type_over_block(self):
		# Manual Approval defers over-block reconciliation to a human; the
		# count-based guard is a hard rule under both Strict and Allow Same
		# Source (source identity does not change physical room counts).
		if self._overlap_policy() == "Manual Approval":
			return

		filters = {
			"scope": "Room Type",
			"room_type": self.room_type,
			"is_hard_block": 1,
			"status": "Active",
			"start_date": ["<", self.end_date],
			"end_date": [">", self.start_date],
		}
		if self.name:
			filters["name"] = ["!=", self.name]

		existing_count = frappe.db.count("Room Inventory Block", filters)
		total_rooms = frappe.db.count(
			"Room", {"room_type": self.room_type, "is_active": 1}
		)

		if existing_count >= total_rooms:
			frappe.throw(
				_(
					"Adding this block would over-block Room Type {0}: "
					"{1} room(s) already hard-blocked for this period, "
					"{2} total active room(s) in this type."
				).format(self.room_type, existing_count, total_rooms),
				frappe.ValidationError,
				title=_("Over-Block Prevented"),
			)
