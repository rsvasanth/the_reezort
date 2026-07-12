"""Seed a baseline Guest Request Type catalog so guest requests can be
created out of the box. Idempotent — safe to re-run on any property.

Guest Request.request_type is a required Link to Guest Request Type; without
at least one type the module is unusable, so this ships a sensible default set.
"""

import frappe

# (name, code, department, priority, response_min, resolution_min, handoff_module, guest_visible)
_DEFAULT_TYPES = [
	("Amenity / Extra Item", "AMENITY", "Housekeeping", "Normal", 30, 120, "Housekeeping", 1),
	("Housekeeping Request", "HK-REQ", "Housekeeping", "Normal", 30, 120, "Housekeeping", 1),
	("Maintenance Request", "MAINT-REQ", "Maintenance", "High", 30, 240, "Maintenance", 1),
	("Concierge / Booking", "CONCIERGE", "Concierge", "Normal", 60, 480, "None", 1),
	("F&B / In-Room Dining", "FNB-REQ", "F&B", "Normal", 20, 90, "F&B", 1),
	("Transport / Pickup", "TRANSPORT", "Transport", "Normal", 60, 240, "None", 1),
	("General Enquiry", "GENERAL", "Front Desk", "Normal", 60, 480, "None", 1),
]


def seed_default_request_types(resort_property=None):
	created = []
	for name, code, dept, prio, resp, reso, handoff, visible in _DEFAULT_TYPES:
		if frappe.db.exists("Guest Request Type", code):
			continue
		doc = frappe.get_doc(
			{
				"doctype": "Guest Request Type",
				"request_type_name": name,
				"request_type_code": code,
				"resort_property": resort_property,
				"default_department": dept,
				"default_priority": prio,
				"default_privacy_level": "Normal",
				"response_sla_minutes": resp,
				"resolution_sla_minutes": reso,
				"handoff_module": handoff,
				"is_guest_visible": visible,
				"is_active": 1,
			}
		)
		doc.insert(ignore_permissions=True)
		created.append(code)
	return created
