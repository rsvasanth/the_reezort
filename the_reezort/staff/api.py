"""Staff & Access — onboard staff logins + directory from the SPA (no ERPNext desk).

Security model: this is a *controlled elevation* surface. The caller must hold a
staff-admin role (System Manager or Resort Manager); the actual User/Employee
writes run with ignore_permissions. Only a whitelist of resort roles can be
granted — privileged roles (System Manager, Administrator, …) can never be
assigned through this API, so it cannot be used to escalate privilege.
"""

import json

import frappe
from frappe import _
from frappe.utils import validate_email_address

from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import as_list as _as_list
from the_reezort.utils import envelope as _envelope

# Roles a staff-admin may grant through this screen. Deliberately excludes
# System Manager / Administrator and any system/privileged role.
ASSIGNABLE_ROLES = [
	"Front Desk",
	"Housekeeping",
	"Restaurant",
	"Reservation Agent",
	"Concierge",
	"Maintenance",
	"Resort Manager",
	"Accounts User",
	"Accounts Manager",
]

# Who may manage staff.
STAFF_ADMIN_ROLES = {"System Manager", "Resort Manager"}

# Never editable/disableable through this API.
PROTECTED_USERS = {"Administrator", "Guest"}


def _require_staff_admin():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)
	if not (STAFF_ADMIN_ROLES & set(frappe.get_roles())):
		frappe.throw(_("Only a manager can manage staff and access."), frappe.PermissionError)


def _validate_roles(roles):
	roles = [r for r in _as_list(roles) if r]
	invalid = [r for r in roles if r not in ASSIGNABLE_ROLES]
	if invalid:
		frappe.throw(_("These roles cannot be assigned here: {0}").format(", ".join(invalid)))
	return roles


def _resort_roles_of(user):
	return sorted(set(frappe.get_roles(user)) & set(ASSIGNABLE_ROLES))


def _staff_row(user_name):
	user = frappe.db.get_value(
		"User", user_name, ["name", "full_name", "enabled", "user_image"], as_dict=True
	)
	if not user:
		return None
	emp = frappe.db.get_value(
		"Employee",
		{"user_id": user_name},
		["name", "designation", "department", "image", "status"],
		as_dict=True,
	)
	return {
		"user": user.name,
		"full_name": user.full_name or user.name,
		"enabled": user.enabled,
		"image": (emp and emp.image) or user.user_image,
		"roles": _resort_roles_of(user_name),
		"designation": emp.designation if emp else None,
		"department": emp.department if emp else None,
		"employee": emp.name if emp else None,
		"is_system_manager": "System Manager" in frappe.get_roles(user_name),
	}


# ---------- reads ----------

@frappe.whitelist()
def list_staff():
	_require_staff_admin()
	# Users who hold at least one assignable resort role.
	rows = frappe.get_all(
		"Has Role",
		filters={"role": ["in", ASSIGNABLE_ROLES], "parenttype": "User"},
		fields=["parent"],
		distinct=True,
	)
	names = sorted({r.parent for r in rows} - PROTECTED_USERS)
	staff = [s for s in (_staff_row(n) for n in names) if s]
	return _envelope({"staff": staff, "count": len(staff)})


@frappe.whitelist()
def list_staff_options():
	_require_staff_admin()
	return _envelope(
		{
			"roles": ASSIGNABLE_ROLES,
			"designations": [d.name for d in frappe.get_all("Designation", fields=["name"], order_by="name")],
			"departments": [d.name for d in frappe.get_all("Department", fields=["name"], order_by="name")],
		}
	)


# ---------- writes ----------

@frappe.whitelist()
def create_staff(payload):
	"""Create (or update) a staff login + roles, optionally linking an Employee.

	Idempotent on email: an existing user is updated, not duplicated.
	"""
	_require_staff_admin()
	payload = _as_dict(payload)

	email = (payload.get("email") or "").strip().lower()
	first_name = (payload.get("first_name") or "").strip()
	if not email:
		frappe.throw(_("Email is required."))
	validate_email_address(email, throw=True)
	if not first_name:
		frappe.throw(_("First name is required."))

	roles = _validate_roles(payload.get("roles"))
	if not roles:
		frappe.throw(_("Assign at least one role."))

	password = payload.get("password")
	if password and len(password) < 8:
		frappe.throw(_("Password must be at least 8 characters."))

	existing = frappe.db.exists("User", email)
	user = frappe.get_doc("User", email) if existing else frappe.new_doc("User")
	user.email = email
	user.first_name = first_name
	if payload.get("last_name"):
		user.last_name = payload["last_name"].strip()
	user.enabled = 1
	user.send_welcome_email = 0
	user.user_type = "System User"
	if not existing:
		if password:
			user.new_password = password
			user.flags.ignore_password_policy = True
		else:
			user.send_welcome_email = 1
	# Replace assignable roles, preserving any non-assignable ones the user already has.
	preserved = [r for r in frappe.get_roles(email) if r not in ASSIGNABLE_ROLES] if existing else []
	keep = sorted(set(preserved) | set(roles))
	user.set("roles", [{"role": r} for r in keep if frappe.db.exists("Role", r)])
	user.save(ignore_permissions=True)

	# Optional Employee link (designation/department).
	employee = _link_employee(user.name, first_name, payload)

	return _envelope(
		{"user": _staff_row(user.name), "employee": employee, "reused": bool(existing)},
		next_actions=["assign_more"],
	)


def _link_employee(user_name, first_name, payload):
	designation = payload.get("designation")
	department = payload.get("department")
	if not designation and not department:
		return None
	existing = frappe.db.get_value("Employee", {"user_id": user_name}, "name")
	if existing:
		if designation:
			frappe.db.set_value("Employee", existing, "designation", designation)
		if department:
			frappe.db.set_value("Employee", existing, "department", department)
		return existing
	company = frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")
	emp = frappe.get_doc(
		{
			"doctype": "Employee",
			"first_name": (payload.get("full_name") or first_name),
			"company": company,
			"designation": designation,
			"department": department,
			"status": "Active",
			"user_id": user_name,
		}
	)
	emp.insert(ignore_permissions=True)
	return emp.name


@frappe.whitelist()
def update_staff_roles(user, roles):
	_require_staff_admin()
	if user in PROTECTED_USERS:
		frappe.throw(_("This account cannot be modified here."))
	roles = _validate_roles(roles)
	preserved = [r for r in frappe.get_roles(user) if r not in ASSIGNABLE_ROLES]
	keep = sorted(set(preserved) | set(roles))
	doc = frappe.get_doc("User", user)
	doc.set("roles", [{"role": r} for r in keep if frappe.db.exists("Role", r)])
	doc.save(ignore_permissions=True)
	return _envelope({"user": _staff_row(user)})


@frappe.whitelist()
def set_staff_enabled(user, enabled):
	_require_staff_admin()
	if user in PROTECTED_USERS:
		frappe.throw(_("This account cannot be modified here."))
	if "System Manager" in frappe.get_roles(user) and "System Manager" not in frappe.get_roles():
		frappe.throw(_("Only a System Manager can enable or disable another System Manager."))
	value = 1 if str(enabled) in ("1", "true", "True") else 0
	frappe.db.set_value("User", user, "enabled", value)
	return _envelope({"user": user, "enabled": value})
