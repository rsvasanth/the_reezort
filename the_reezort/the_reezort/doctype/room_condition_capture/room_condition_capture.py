import frappe
from frappe import _
from frappe.model.document import Document


APPEND_ONLY_FIELDS = (
	"resort_property",
	"stay",
	"room",
	"capture_stage",
	"captured_by",
	"captured_at",
	"overall_condition",
	"notes",
)


class RoomConditionCapture(Document):
	def validate(self):
		self.validate_photos()
		self.block_edits_after_insert()

	def validate_photos(self):
		if not self.get("photos"):
			frappe.throw(_("Room Condition Capture requires at least one photo."), frappe.ValidationError)

	def block_edits_after_insert(self):
		if self.is_new() or "System Manager" in frappe.get_roles(frappe.session.user):
			return

		before = self.get_doc_before_save()
		if not before:
			return

		for fieldname in APPEND_ONLY_FIELDS:
			if before.get(fieldname) != self.get(fieldname):
				frappe.throw(_("Room Condition Capture is append-only."), frappe.ValidationError)

		if len(before.get("photos") or []) != len(self.get("photos") or []):
			frappe.throw(_("Room Condition Capture photos are append-only."), frappe.ValidationError)

		for old_row, new_row in zip(before.get("photos") or [], self.get("photos") or []):
			if old_row.image != new_row.image or old_row.caption != new_row.caption or old_row.area != new_row.area:
				frappe.throw(_("Room Condition Capture photos are append-only."), frappe.ValidationError)
