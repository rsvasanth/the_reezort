import frappe
from frappe import _

from the_reezort.utils import envelope as _envelope


GENERIC_ROLES = {
	"All",
	"Guest",
	"Desk User",
	"Employee",
	"Employee Self Service",
	"Customer",
	"Supplier",
}

ROLE_PRIORITY = [
	"Resort Manager",
	"Accounts Manager",
	"Accounts User",
	"Front Desk",
	"Reservation Agent",
	"Concierge",
	"Restaurant",
	"Housekeeping",
	"Maintenance",
	"System Manager",
]


def _meaningful_roles(roles):
	return sorted(role for role in roles if role not in GENERIC_ROLES)


def _primary_role(roles):
	role_set = set(roles)
	for role in ROLE_PRIORITY:
		if role in role_set:
			return role
	return "Staff"


@frappe.whitelist()
def get_current_user_profile():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)

	session_user = frappe.session.user
	roles = frappe.get_roles(session_user)
	user = frappe.get_doc("User", session_user)

	return _envelope(
		{
			"user": session_user,
			"full_name": user.full_name,
			"roles": _meaningful_roles(roles),
			"primary_role": _primary_role(roles),
			"is_system_manager": "System Manager" in roles,
		}
	)
