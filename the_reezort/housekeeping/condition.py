import frappe
from frappe import _
from frappe.utils import now


STATUS_FIELD_BY_CONDITION = {
	"Housekeeping": "housekeeping_status",
	"Maintenance": "maintenance_status",
	"Occupancy": "occupancy_status",
	"Sellable": "sellable_status",
}


def log_room_condition(room, condition_type, new_status, source_doctype=None, source_name=None, reason=None):
	status_field = STATUS_FIELD_BY_CONDITION.get(condition_type)
	if not status_field:
		frappe.throw(_("Unsupported room condition type: {0}").format(condition_type))

	room_doc = frappe.get_doc("Room", room)
	old_status = room_doc.get(status_field)
	if old_status == new_status:
		return None

	log = frappe.get_doc(
		{
			"doctype": "Room Condition Log",
			"resort_property": room_doc.resort_property,
			"room": room_doc.name,
			"condition_type": condition_type,
			"old_status": old_status,
			"new_status": new_status,
			"source_doctype": source_doctype,
			"source_name": source_name,
			"changed_by": frappe.session.user,
			"changed_at": now(),
			"reason": reason,
		}
	)
	log.insert(ignore_permissions=True)

	frappe.db.set_value("Room", room_doc.name, status_field, new_status)

	return log
