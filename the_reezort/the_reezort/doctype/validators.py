import frappe
from frappe import _


def validate_unique_within(
	doctype: str,
	fieldname: str,
	value: str | None,
	filters: dict,
	current_name: str | None = None,
):
	if not value:
		return

	lookup_filters = {**filters, fieldname: value}
	existing_name = frappe.db.get_value(doctype, lookup_filters, "name")

	if existing_name and existing_name != current_name:
		filter_text = ", ".join(f"{key}: {val}" for key, val in filters.items())
		frappe.throw(
			_("{0} '{1}' already exists for {2}.").format(frappe.bold(fieldname), value, filter_text),
			title=_("Duplicate Code"),
		)


def validate_link_property(
	link_doctype: str,
	link_name: str | None,
	expected_property: str | None,
	label: str,
):
	if not link_name or not expected_property:
		return

	actual_property = frappe.db.get_value(link_doctype, link_name, "resort_property")

	if actual_property and actual_property != expected_property:
		frappe.throw(
			_("{0} must belong to Resort Property {1}.").format(label, frappe.bold(expected_property)),
			title=_("Property Mismatch"),
		)


def validate_active_parent(doctype: str, name: str | None, label: str):
	if not name:
		return

	is_active = frappe.db.get_value(doctype, name, "is_active")

	if is_active == 0:
		frappe.throw(
			_("{0} {1} is inactive.").format(label, frappe.bold(name)),
			title=_("Inactive Parent"),
		)
