import frappe
from frappe import _
from frappe.model.document import Document


APPEND_ONLY_FIELDS = (
	"resort_property",
	"room",
	"condition_type",
	"old_status",
	"new_status",
	"source_doctype",
	"source_name",
	"changed_by",
	"changed_at",
	"reason",
)


class RoomConditionLog(Document):
	def validate(self):
		self.block_edits_after_insert()

	def block_edits_after_insert(self):
		if self.is_new() or "System Manager" in frappe.get_roles(frappe.session.user):
			return

		before = self.get_doc_before_save()
		if not before:
			return

		for fieldname in APPEND_ONLY_FIELDS:
			if before.get(fieldname) != self.get(fieldname):
				frappe.throw(_("Room Condition Log is append-only."), frappe.ValidationError)
