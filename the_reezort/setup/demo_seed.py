"""Demo seed for a faithful THE REEZORT (India / INR / GST) showcase.

Built to run idempotently against the company `THE REEZORT Private Limited`.
Locally this company is created alongside the existing test company; on prod it
already exists. Layered in verifiable steps: company -> base masters -> GST ->
org/staff -> roles/users.
"""

import frappe
from frappe.utils import getdate, today

from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters

REEZORT_COMPANY = "THE REEZORT Private Limited"
REEZORT_ABBR = "TRZ"
CURRENCY = "INR"
COUNTRY = "India"


def _fiscal_year_covers_today():
	return frappe.db.get_value(
		"Fiscal Year",
		{"year_start_date": ["<=", today()], "year_end_date": [">=", today()]},
		"name",
	)


def ensure_fiscal_year():
	existing = _fiscal_year_covers_today()
	if existing:
		return existing

	reference = getdate(today())
	start_year = reference.year if reference.month >= 4 else reference.year - 1
	start, end = f"{start_year}-04-01", f"{start_year + 1}-03-31"
	fy = frappe.get_doc(
		{
			"doctype": "Fiscal Year",
			"year": f"{start_year}-{start_year + 1}",
			"year_start_date": start,
			"year_end_date": end,
		}
	)
	fy.insert(ignore_permissions=True)
	return fy.name


def ensure_reezort_company():
	existing = frappe.db.get_value("Company", {"company_name": REEZORT_COMPANY}, "name")
	if existing:
		return existing

	company = frappe.get_doc(
		{
			"doctype": "Company",
			"company_name": REEZORT_COMPANY,
			"abbr": REEZORT_ABBR,
			"default_currency": CURRENCY,
			"country": COUNTRY,
			"create_chart_of_accounts_based_on": "Standard Template",
		}
	)
	company.insert(ignore_permissions=True)
	return company.name


def set_as_default_company(company):
	global_defaults = frappe.get_doc("Global Defaults")
	global_defaults.default_company = company
	global_defaults.save(ignore_permissions=True)
	frappe.db.set_default("company", company)


@frappe.whitelist()
def seed_company_base():
	"""Step 1: ensure the India company exists, has a fiscal year, and is default."""
	ensure_fiscal_year()
	company = ensure_reezort_company()
	set_as_default_company(company)
	frappe.db.commit()

	return {
		"company": company,
		"abbr": frappe.db.get_value("Company", company, "abbr"),
		"currency": frappe.db.get_value("Company", company, "default_currency"),
		"accounts": frappe.db.count("Account", {"company": company}),
		"default_company": frappe.db.get_single_value("Global Defaults", "default_company"),
	}


@frappe.whitelist()
def seed_base_masters():
	"""Step 2: warehouses, cost centers, parties, payment modes, items, opening stock, property."""
	company = ensure_reezort_company()

	# A multi-company site can carry another company's warehouse as the global
	# default (in Stock Settings AND the `__default` DefaultValue). Frappe stamps
	# that onto every new item_defaults row, so the company-link check fails.
	# Neutralize both before seeding, then repoint to this company's main store.
	frappe.db.set_single_value("Stock Settings", "default_warehouse", None)
	frappe.defaults.clear_default("default_warehouse")

	erpnext_seed = seed_erpnext_demo_masters(company=company, country=COUNTRY, currency=CURRENCY)
	property_seed = seed_demo_property(company=company)

	main_store = frappe.db.get_value(
		"Warehouse", {"company": company, "warehouse_name": "Main Stores"}, "name"
	)
	if main_store:
		frappe.db.set_single_value("Stock Settings", "default_warehouse", main_store)
		frappe.db.set_default("default_warehouse", main_store)

	frappe.db.commit()

	return {"company": company, "erpnext": erpnext_seed, "property": property_seed}


# ---------------------------------------------------------------------------
# Step 1a: India GST
# ---------------------------------------------------------------------------

def _gst_parent_account(company):
	return frappe.db.get_value(
		"Account", {"company": company, "account_name": "Duties and Taxes", "is_group": 1}, "name"
	) or frappe.db.get_value("Account", {"company": company, "root_type": "Liability", "is_group": 1}, "name")


def _get_or_create_tax_account(company, account_name, parent):
	existing = frappe.db.get_value("Account", {"company": company, "account_name": account_name}, "name")
	if existing:
		return existing

	doc = frappe.get_doc(
		{
			"doctype": "Account",
			"account_name": account_name,
			"parent_account": parent,
			"company": company,
			"account_type": "Tax",
			"root_type": "Liability",
			"report_type": "Balance Sheet",
			"is_group": 0,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _upsert_item_tax_template(company, title, rows):
	name = frappe.db.get_value("Item Tax Template", {"title": title, "company": company}, "name")
	doc = frappe.get_doc("Item Tax Template", name) if name else frappe.new_doc("Item Tax Template")
	doc.title = title
	doc.company = company
	doc.set("taxes", [{"tax_type": account, "tax_rate": rate} for account, rate in rows])
	doc.save(ignore_permissions=True)
	return doc.name


def _upsert_sales_tax_template(company, title, rows, is_default=0):
	name = frappe.db.get_value("Sales Taxes and Charges Template", {"title": title, "company": company}, "name")
	doc = frappe.get_doc("Sales Taxes and Charges Template", name) if name else frappe.new_doc(
		"Sales Taxes and Charges Template"
	)
	doc.title = title
	doc.company = company
	doc.is_default = is_default
	doc.set(
		"taxes",
		[
			{"charge_type": "On Net Total", "account_head": account, "rate": rate, "description": description}
			for account, rate, description in rows
		],
	)
	doc.save(ignore_permissions=True)
	return doc.name


@frappe.whitelist()
def seed_gst_tax():
	"""Step 1a: India GST accounts, item tax templates, sales tax template, item assignment."""
	company = ensure_reezort_company()
	parent = _gst_parent_account(company)

	cgst = _get_or_create_tax_account(company, "Output Tax CGST", parent)
	sgst = _get_or_create_tax_account(company, "Output Tax SGST", parent)
	igst = _get_or_create_tax_account(company, "Output Tax IGST", parent)

	item_tax_templates = {
		"GST 18%": _upsert_item_tax_template(company, "GST 18%", [(cgst, 9), (sgst, 9)]),
		"GST 12%": _upsert_item_tax_template(company, "GST 12%", [(cgst, 6), (sgst, 6)]),
		"GST 5%": _upsert_item_tax_template(company, "GST 5%", [(cgst, 2.5), (sgst, 2.5)]),
	}
	sales_template = _upsert_sales_tax_template(
		company,
		"Resort GST 18% (Intra-State)",
		[(cgst, 9, "CGST 9%"), (sgst, 9, "SGST 9%")],
		is_default=1,
	)

	item_slabs = {
		"GST 18%": ["ROOM-DLX", "ROOM-STE", "ROOM-VIL", "BANQUET-HALL-RENTAL", "LAUNDRY-SERVICE"],
		"GST 5%": ["FNB-ADD-BUFFET", "FNB-ROOM-SERVICE", "FNB-BOTTLED-WATER"],
	}
	assigned = 0
	for slab, item_codes in item_slabs.items():
		for item_code in item_codes:
			if not frappe.db.exists("Item", item_code):
				continue
			item = frappe.get_doc("Item", item_code)
			item.set("taxes", [{"item_tax_template": item_tax_templates[slab]}])
			item.save(ignore_permissions=True)
			assigned += 1

	frappe.db.commit()

	return {
		"company": company,
		"tax_accounts": [cgst, sgst, igst],
		"item_tax_templates": item_tax_templates,
		"sales_template": sales_template,
		"items_assigned": assigned,
	}


# ---------------------------------------------------------------------------
# Step 1b + 1c: org structure, staff, roles, demo login users
# ---------------------------------------------------------------------------

DEMO_PASSWORD = "Reezort@Demo2026"  # demo-only login for the showcase; override via arg

RESORT_DESIGNATIONS = [
	"Front Desk Executive",
	"Housekeeping Attendant",
	"Restaurant Cashier",
	"Accounts Executive",
	"Maintenance Technician",
	"General Manager",
]

# (employee_full_name, department, designation)
EMPLOYEES = [
	("Aarav Front Desk", "Front Office", "Front Desk Executive"),
	("Diya Housekeeping", "Housekeeping", "Housekeeping Attendant"),
	("Kabir Restaurant", "Food and Beverage", "Restaurant Cashier"),
	("Meera Accounts", "Accounts", "Accounts Executive"),
	("Rohan Engineering", "Engineering", "Maintenance Technician"),
	("Saanvi Sharma", "Management", "General Manager"),
]

RESORT_ROLES = ["Front Desk", "Housekeeping", "Restaurant", "Reservation Agent", "Concierge", "Maintenance", "Resort Manager"]

# (email, first_name, roles, employee_full_name)
DEMO_USERS = [
	("frontdesk@thereezort.com", "Front Desk", ["Front Desk"], "Aarav Front Desk"),
	("housekeeping@thereezort.com", "Housekeeping", ["Housekeeping"], "Diya Housekeeping"),
	("restaurant@thereezort.com", "Restaurant", ["Restaurant"], "Kabir Restaurant"),
	("accounts@thereezort.com", "Accounts", ["Accounts User", "Accounts Manager"], "Meera Accounts"),
	("maintenance@thereezort.com", "Maintenance", ["Maintenance"], "Rohan Engineering"),
	("gm@thereezort.com", "General Manager", ["Resort Manager", "Accounts Manager"], "Saanvi Sharma"),
]


def _ensure_department(company, name):
	existing = frappe.db.get_value("Department", {"department_name": name, "company": company}, "name")
	if existing:
		return existing

	parent = frappe.db.get_value("Department", {"is_group": 1, "company": company}, "name") or frappe.db.get_value(
		"Department", {"is_group": 1}, "name"
	)
	doc = frappe.get_doc(
		{"doctype": "Department", "department_name": name, "company": company, "parent_department": parent}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _ensure_designation(name):
	if frappe.db.exists("Designation", name):
		return name
	frappe.get_doc({"doctype": "Designation", "designation_name": name}).insert(ignore_permissions=True)
	return name


def _ensure_employee(company, full_name, department, designation):
	existing = frappe.db.get_value("Employee", {"employee_name": full_name, "company": company}, "name")
	if existing:
		return existing

	doc = frappe.get_doc(
		{
			"doctype": "Employee",
			"first_name": full_name,
			"company": company,
			"department": department,
			"designation": designation,
			"gender": "Other",
			"date_of_birth": "1995-01-01",
			"date_of_joining": "2026-01-01",
			"status": "Active",
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _ensure_role(role_name):
	if frappe.db.exists("Role", role_name):
		return role_name
	frappe.get_doc({"doctype": "Role", "role_name": role_name, "desk_access": 1}).insert(ignore_permissions=True)
	return role_name


def _ensure_user(email, first_name, roles, password):
	existing = frappe.db.exists("User", email)
	doc = frappe.get_doc("User", email) if existing else frappe.new_doc("User")
	doc.email = email
	doc.first_name = first_name
	doc.enabled = 1
	doc.send_welcome_email = 0
	if not existing:
		doc.new_password = password
	doc.set("roles", [{"role": r} for r in roles if frappe.db.exists("Role", r)])
	doc.flags.ignore_password_policy = True
	doc.save(ignore_permissions=True)
	return doc.name


@frappe.whitelist()
def seed_org_and_users(password=DEMO_PASSWORD):
	"""Step 1b + 1c: departments, designations, employees, roles, and per-role demo users."""
	company = ensure_reezort_company()

	departments = {dept: _ensure_department(company, dept) for _, dept, _ in EMPLOYEES}
	for designation in RESORT_DESIGNATIONS:
		_ensure_designation(designation)

	employees = {}
	for full_name, dept, designation in EMPLOYEES:
		employees[full_name] = _ensure_employee(company, full_name, departments[dept], designation)

	for role in RESORT_ROLES:
		_ensure_role(role)

	users = []
	for email, first_name, roles, employee_name in DEMO_USERS:
		user = _ensure_user(email, first_name, roles, password)
		employee = employees.get(employee_name)
		if employee and not frappe.db.get_value("Employee", employee, "user_id"):
			frappe.db.set_value("Employee", employee, "user_id", user)
		users.append({"user": user, "roles": roles})

	frappe.db.commit()

	return {
		"company": company,
		"departments": len(departments),
		"employees": len(employees),
		"roles": RESORT_ROLES,
		"users": users,
		"demo_password": password,
	}


@frappe.whitelist()
def seed_full_demo(password=DEMO_PASSWORD):
	"""Run the full idempotent THE REEZORT demo seed end to end."""
	ensure_fiscal_year()
	company = ensure_reezort_company()
	set_as_default_company(company)
	base = seed_base_masters()
	gst = seed_gst_tax()
	org = seed_org_and_users(password=password)
	frappe.db.commit()

	return {"company": company, "base": base, "gst": gst, "org": org}
