"""Restaurant staff hierarchy seeder — F&B Slice 1.5.

Seeds the F&B org tree (14 employees across 5 sub-teams) that closes the
"where are the actual restaurant staff?" gap left by demo_seed.py's single
`Kabir Restaurant` operator row. Idempotent — safe to re-run.

Structure produced:

    F&B Manager (Karan Nair)
    ├── Executive Chef (Rajesh Iyer) · Restaurant Kitchen
    │   └── Sous Chef (Priya Menon)
    │       ├── Chef de Partie (Deepak Krishnan)
    │       └── Kitchen Steward (Ravi Sundaram)
    ├── Restaurant Manager (Anita Reddy) · Restaurant Service
    │   └── Restaurant Captain (Ravi Menon)
    │       ├── Waiter Senior (Suresh Pillai)
    │       └── Waiter Junior (Nisha Kumar)
    ├── Bar Manager (Vikram Singh) · Bar
    │   └── Head Bartender (Rakesh Nair)
    │       └── Bartender (Ankit Sharma)
    └── IRD Supervisor (Sneha Rao) · In-Room Dining
        └── IRD Server (Manoj Das)

Roles fan-out:
- Everyone gets the `Restaurant` role (they touch the POS/IRD screens).
- Managers (F&B / Restaurant / Bar) additionally get `Resort Manager`
  so they can approve F&B void / backdate gates.
- Executive Chef gets `Resort Manager` too — kitchen sign-off authority
  on 86'd items and menu variance.

Idempotency:
- Departments matched on (department_name, company).
- Designations matched by name (global).
- Employees matched by (employee_name, company).
- Users matched by email.
- reports_to is set on second pass so parent rows exist first.
"""

from __future__ import annotations

import frappe
from the_reezort.permissions import system_manager_only

from the_reezort.setup.demo_seed import (
	DEMO_PASSWORD,
	ensure_reezort_company,
	_ensure_department,
	_ensure_designation,
	_ensure_employee,
	_ensure_role,
	_ensure_user,
)

# ---------------------------------------------------------------------------
# Structure
# ---------------------------------------------------------------------------

FNB_ROOT_DEPARTMENT = "Food and Beverage"

FNB_SUB_DEPARTMENTS = [
	"Restaurant Kitchen",
	"Restaurant Service",
	"Bar",
	"In-Room Dining",
	"Cafe",
]

FNB_DESIGNATIONS = [
	"F&B Manager",
	"Executive Chef",
	"Sous Chef",
	"Chef de Partie",
	"Kitchen Steward",
	"Restaurant Manager",
	"Restaurant Captain",
	"Waiter Senior",
	"Waiter Junior",
	"Bar Manager",
	"Head Bartender",
	"Bartender",
	"IRD Supervisor",
	"IRD Server",
]

# Fields per row:
#   full_name, email, department, designation, reports_to_name (or None)
#   plus extra_roles (in addition to always-present "Restaurant")
FNB_ROSTER = [
	# name,                 email,                                 department,           designation,          reports_to,          extra_roles
	("Karan Nair",          "karan.fnb@thereezort.com",            FNB_ROOT_DEPARTMENT,  "F&B Manager",        "Saanvi Sharma",     ["Resort Manager"]),
	# Kitchen
	("Rajesh Iyer",         "rajesh.chef@thereezort.com",          "Restaurant Kitchen", "Executive Chef",     "Karan Nair",        ["Resort Manager"]),
	("Priya Menon",         "priya.souschef@thereezort.com",       "Restaurant Kitchen", "Sous Chef",          "Rajesh Iyer",       []),
	("Deepak Krishnan",     "deepak.chef@thereezort.com",          "Restaurant Kitchen", "Chef de Partie",     "Priya Menon",       []),
	("Ravi Sundaram",       "ravi.steward@thereezort.com",         "Restaurant Kitchen", "Kitchen Steward",    "Priya Menon",       []),
	# Service
	("Anita Reddy",         "anita.rest@thereezort.com",           "Restaurant Service", "Restaurant Manager", "Karan Nair",        ["Resort Manager"]),
	("Ravi Menon",          "ravi.captain@thereezort.com",         "Restaurant Service", "Restaurant Captain", "Anita Reddy",       []),
	("Suresh Pillai",       "suresh.waiter@thereezort.com",        "Restaurant Service", "Waiter Senior",      "Ravi Menon",        []),
	("Nisha Kumar",         "nisha.waiter@thereezort.com",         "Restaurant Service", "Waiter Junior",      "Ravi Menon",        []),
	# Bar
	("Vikram Singh",        "vikram.bar@thereezort.com",           "Bar",                "Bar Manager",        "Karan Nair",        ["Resort Manager"]),
	("Rakesh Nair",         "rakesh.bartender@thereezort.com",     "Bar",                "Head Bartender",     "Vikram Singh",      []),
	("Ankit Sharma",        "ankit.bartender@thereezort.com",      "Bar",                "Bartender",          "Rakesh Nair",       []),
	# IRD
	("Sneha Rao",           "sneha.ird@thereezort.com",            "In-Room Dining",     "IRD Supervisor",     "Karan Nair",        []),
	("Manoj Das",           "manoj.ird@thereezort.com",            "In-Room Dining",     "IRD Server",         "Sneha Rao",         []),
]


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _ensure_sub_department(company: str, name: str, parent_name: str) -> str:
	"""Create a department under the F&B root, not the top-level parent."""
	existing = frappe.db.get_value(
		"Department", {"department_name": name, "company": company}, "name"
	)
	if existing:
		return existing

	doc = frappe.get_doc(
		{
			"doctype": "Department",
			"department_name": name,
			"company": company,
			"parent_department": parent_name,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _set_reports_to(employee_name: str, reports_to_employee_name: str | None) -> None:
	if not reports_to_employee_name:
		return
	current = frappe.db.get_value("Employee", employee_name, "reports_to")
	if current == reports_to_employee_name:
		return
	frappe.db.set_value(
		"Employee", employee_name, "reports_to", reports_to_employee_name, update_modified=False
	)


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------


@frappe.whitelist()
@system_manager_only
def seed_fnb_staff(password: str = DEMO_PASSWORD) -> dict:
	"""Idempotent — safe to call any number of times."""
	company = ensure_reezort_company()

	# 1. Departments — root (from demo_seed) then five children.
	root = _ensure_department(company, FNB_ROOT_DEPARTMENT)
	for sub in FNB_SUB_DEPARTMENTS:
		_ensure_sub_department(company, sub, root)

	# 2. Designations.
	for des in FNB_DESIGNATIONS:
		_ensure_designation(des)

	# 3. Roles — 'Restaurant' + 'Resort Manager' already exist via demo_seed.
	_ensure_role("Restaurant")
	_ensure_role("Resort Manager")

	# 4. Two-pass employee seed — insert everyone first so reports_to targets exist.
	employees: dict[str, str] = {}
	for full_name, _email, dept, designation, _reports_to, _extra_roles in FNB_ROSTER:
		dept_name = frappe.db.get_value(
			"Department", {"department_name": dept, "company": company}, "name"
		)
		if not dept_name:
			frappe.throw(f"Department '{dept}' not found — seeder ordering issue")
		employees[full_name] = _ensure_employee(company, full_name, dept_name, designation)

	# 5. Set reports_to now that all rows exist.
	for full_name, _email, _dept, _des, reports_to_full_name, _roles in FNB_ROSTER:
		reports_to_employee = employees.get(reports_to_full_name) if reports_to_full_name else None
		if reports_to_full_name and not reports_to_employee:
			# reports_to is an external person (e.g. GM Saanvi Sharma from demo_seed)
			reports_to_employee = frappe.db.get_value(
				"Employee", {"employee_name": reports_to_full_name, "company": company}, "name"
			)
		_set_reports_to(employees[full_name], reports_to_employee)

	# 6. Users — one per employee, always with Restaurant role + any extras.
	created_users = []
	for full_name, email, _dept, _des, _reports_to, extra_roles in FNB_ROSTER:
		roles = ["Restaurant"] + list(extra_roles)
		user_name = _ensure_user(email, full_name.split(" ")[0], roles, password)
		employee_name = employees[full_name]
		if not frappe.db.get_value("Employee", employee_name, "user_id"):
			frappe.db.set_value(
				"Employee", employee_name, "user_id", user_name, update_modified=False
			)
		created_users.append({"user": user_name, "roles": roles, "employee": employee_name})

	frappe.db.commit()

	# Do not echo the password back over the wire (API response / logs / history).
	return {
		"company": company,
		"departments": [FNB_ROOT_DEPARTMENT] + FNB_SUB_DEPARTMENTS,
		"designations": FNB_DESIGNATIONS,
		"employees": len(employees),
		"users": created_users,
		"password_set": bool(password),
	}
