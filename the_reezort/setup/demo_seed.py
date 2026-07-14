"""Demo seed for a faithful THE REEZORT (India / INR / GST) showcase.

Built to run idempotently against the company `THE REEZORT Private Limited`.
Locally this company is created alongside the existing test company; on prod it
already exists. Layered in verifiable steps: company -> base masters -> GST ->
org/staff -> roles/users.
"""

import frappe
from the_reezort.permissions import system_manager_only
from frappe.utils import add_days, getdate, today

from the_reezort.billing.api import add_folio_line
from the_reezort.pms.api import check_in
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
@system_manager_only
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
@system_manager_only
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
@system_manager_only
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

RESORT_ROLES = ["Front Desk", "Housekeeping", "Housekeeping Supervisor", "Housekeeping Attendant", "Restaurant", "Reservation Agent", "Revenue Manager", "Concierge", "Maintenance", "Resort Manager"]

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
@system_manager_only
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

	# Never echo the password back over the wire — it lands in API responses,
	# browser history, and logs. The operator already knows it (they passed it
	# or it's the documented default).
	return {
		"company": company,
		"departments": len(departments),
		"employees": len(employees),
		"roles": RESORT_ROLES,
		"users": users,
		"password_set": bool(password),
	}


# ---------------------------------------------------------------------------
# In-house guests with open folios (live data for the Folio Workspace demo)
# ---------------------------------------------------------------------------

# (guest_name, room_item, room_rate, extra_item, extra_rate, extra_module)
DEMO_FOLIO_GUESTS = [
	("Vikram Menon", "ROOM-STE", 24500, "FNB-ADD-BUFFET", 2200, "Restaurant"),
	("Anjali Rao", "ROOM-DLX", 14500, "LAUNDRY-SERVICE", 650, "Manual"),
	("Rahul Kapoor", "ROOM-VIL", 38500, "FNB-ROOM-SERVICE", 1800, "Restaurant"),
]


def _create_demo_reservation(property_name, guest_name, room_type):
	email = guest_name.lower().replace(" ", ".") + "@guest.thereezort.com"
	profile_name = frappe.db.get_value("Guest Profile", {"email": email}, "name")
	if not profile_name:
		profile_name = frappe.get_doc(
			{"doctype": "Guest Profile", "guest_full_name": guest_name, "email": email}
		).insert(ignore_permissions=True).name

	reservation = frappe.get_doc(
		{
			"doctype": "Reservation",
			"resort_property": property_name,
			"status": "Confirmed",
			"booking_source": "Direct",
			"arrival_date": today(),
			"departure_date": add_days(today(), 2),
			"currency": CURRENCY,
			"staying_guest_profile": profile_name,
			"guests": [
				{"guest_profile": profile_name, "guest_name": guest_name, "guest_type": "Adult", "is_primary_guest": 1}
			],
			"rooms": [{"room_type": room_type, "adults": 2, "children": 0, "status": "Confirmed"}],
		}
	).insert(ignore_permissions=True)
	return reservation.name


@frappe.whitelist()
@system_manager_only
def seed_demo_folios():
	"""Check a few demo guests in with open folios + charges (idempotent by guest name)."""
	company = ensure_reezort_company()
	set_as_default_company(company)
	property_name = frappe.db.get_value("Resort Property", {}, "name")
	created = []

	for guest_name, room_item, room_rate, extra_item, extra_rate, extra_module in DEMO_FOLIO_GUESTS:
		if frappe.db.exists("Stay", {"primary_guest_name": guest_name, "stay_status": ["in", ["In House", "Due Out"]]}):
			continue

		room_type = frappe.db.get_value(
			"Room",
			{
				"resort_property": property_name,
				"sellable_status": "Sellable",
				"occupancy_status": "Vacant",
				"is_active": 1,
			},
			"room_type",
		)
		if not room_type:
			break

		reservation = _create_demo_reservation(property_name, guest_name, room_type)
		checked_in = check_in(reservation)
		folio, stay = checked_in["folio"], checked_in["stay"]

		add_folio_line(
			folio,
			{
				"line_type": "Charge",
				"item_code": room_item,
				"qty": 1,
				"rate": room_rate,
				"source_module": "Room",
				"source_doctype": "Stay",
				"source_name": stay,
				"description": f"{room_item} room tariff",
			},
		)
		add_folio_line(
			folio,
			{
				"line_type": "Charge",
				"item_code": extra_item,
				"qty": 1,
				"rate": extra_rate,
				"source_module": extra_module,
				"source_doctype": "Stay",
				"source_name": stay,
				"description": extra_item.replace("-", " ").title(),
			},
		)
		created.append({"guest": guest_name, "folio": folio, "stay": stay})

	frappe.db.commit()
	return {"created_folios": created, "count": len(created)}


@frappe.whitelist()
@system_manager_only
def seed_doctype_permissions():
	"""Grant resort/finance roles access to the operational billing doctypes.

	The folio/PMS doctypes ship System-Manager-only; this opens read/write to the
	staff roles so the role-based SPA demo works. (A formal permissions packet will
	eventually move these into the doctype definitions.)
	"""
	from frappe.permissions import add_permission, update_permission_property

	def grant(doctype, role, write=False, create=False, delete=False):
		if not frappe.db.exists("DocType", doctype):
			return
		add_permission(doctype, role, 0)
		update_permission_property(doctype, role, 0, "read", 1)
		if write:
			update_permission_property(doctype, role, 0, "write", 1)
		if create:
			update_permission_property(doctype, role, 0, "create", 1)
		if delete:
			update_permission_property(doctype, role, 0, "delete", 1)

	all_roles = [
		"Front Desk", "Housekeeping", "Restaurant", "Reservation Agent",
		"Concierge", "Maintenance", "Resort Manager", "Accounts User", "Accounts Manager",
	]
	operator_roles = ["Front Desk", "Resort Manager", "Accounts User", "Accounts Manager"]

	# Read across the operational doctypes the dashboards/screens load.
	read_doctypes = [
		"Resort Property", "Resort Building", "Resort Floor", "Room Type", "Room",
		"Service Location", "Guest Profile", "Reservation", "Room Hold",
		"Guest Folio", "Folio Line", "Stay",
	]
	# Write/create only where staff actually mutate.
	write_doctypes = ["Guest Folio", "Folio Line", "Stay", "Reservation", "Room", "Guest Profile", "Room Hold"]

	# Service Desk: every operational role can raise/work tickets.
	for role in all_roles:
		grant("Service Ticket", role, write=True, create=True)

	for doctype in read_doctypes:
		for role in all_roles:
			grant(doctype, role)
	for doctype in write_doctypes:
		for role in operator_roles:
			grant(doctype, role, write=True, create=True)
	# Property management (the SPA setup + management console) is a manager task —
	# grant the Resort Manager full CRUD on the master-data chain so it works
	# without the desk. Room (write/create) is already granted above.
	setup_doctypes = ["Resort Property", "Resort Building", "Resort Floor", "Room Type", "Room Amenity"]
	for doctype in setup_doctypes:
		grant(doctype, "Resort Manager", write=True, create=True, delete=True)
	grant("Room", "Resort Manager", write=True, create=True, delete=True)
	for role in ["Accounts User", "Accounts Manager", "Resort Manager"]:
		grant("ERPNext Posting Log", role)

	frappe.clear_cache()
	frappe.db.commit()
	return {"read_doctypes": read_doctypes, "write_doctypes": write_doctypes, "roles": all_roles}


# Desk lockdown (D1/D2): operational roles use the SPA only; the ERPNext desk
# is reserved for admin, accounting, and management oversight.
DESK_ACCESS_RETAINED = ["Resort Manager", "Accounts User", "Accounts Manager"]
DESK_ACCESS_REVOKED = [
	"Front Desk", "Housekeeping", "Restaurant", "Reservation Agent", "Concierge", "Maintenance",
]


@frappe.whitelist()
@system_manager_only
def lock_desk_access():
	"""Restrict the ERPNext desk: operational roles lose /app (SPA only); admin/accounts/GM keep it.

	Reversible — re-grant by setting desk_access back to 1. The SPA, its APIs, and SPA login are
	unaffected (desk_access only gates the /app desk UI).
	"""
	for role in DESK_ACCESS_REVOKED:
		if frappe.db.exists("Role", role):
			frappe.db.set_value("Role", role, "desk_access", 0)
	for role in DESK_ACCESS_RETAINED:
		if frappe.db.exists("Role", role):
			frappe.db.set_value("Role", role, "desk_access", 1)
	frappe.clear_cache()
	frappe.db.commit()
	return {"revoked": DESK_ACCESS_REVOKED, "retained": DESK_ACCESS_RETAINED}


DEFAULT_APPROVAL_POLICIES = (
	# (action,             threshold, approver_role,     source_doctype)
	("void",                10000,    "Resort Manager",  "Folio Line"),
	("transfer",            10000,    "Resort Manager",  "Folio Line"),
	("credit_note",         5000,     "Resort Manager",  "Folio Line"),
	("refund",              5000,     "Resort Manager",  "Folio Line"),
	("large_discount",      5000,     "Resort Manager",  "Folio Line"),
	# F&B POS control gates (spec 006). Threshold 0 → every post-KOT void and
	# every >24h backdate needs manager sign-off, regardless of ticket value.
	("restaurant_void",     0,        "Resort Manager",  "Restaurant Order"),
	("restaurant_backdate", 0,        "Resort Manager",  "Restaurant Order"),
	# Reservation overbooking override (spec 002). Threshold 0 → any availability
	# override on confirm / amend needs manager sign-off.
	("reservation_override", 0,       "Resort Manager",  "Reservation"),
)


@frappe.whitelist()
@system_manager_only
def seed_approval_policies():
	"""Idempotent seed of default approval gates for the 4 correction actions
	plus a large-discount slot. Threshold amounts are conservative defaults;
	an admin can raise/lower them per property via the Approval Policy doctype."""
	created = []
	for action, threshold, role, source_doctype in DEFAULT_APPROVAL_POLICIES:
		name = f"{action} > {threshold}"
		if frappe.db.exists("Approval Policy", {"policy_name": name}):
			continue
		doc = frappe.get_doc({
			"doctype": "Approval Policy",
			"policy_name": name,
			"action": action,
			"approver_role": role,
			"threshold_amount": threshold,
			"source_doctype": source_doctype,
			"is_active": 1,
		}).insert(ignore_permissions=True)
		created.append(doc.name)
	frappe.db.commit()
	return {"created": created}


@frappe.whitelist()
@system_manager_only
def seed_full_demo(password=DEMO_PASSWORD):
	"""Run the full idempotent THE REEZORT demo seed end to end."""
	ensure_fiscal_year()
	company = ensure_reezort_company()
	set_as_default_company(company)
	base = seed_base_masters()
	gst = seed_gst_tax()
	org = seed_org_and_users(password=password)
	permissions = seed_doctype_permissions()
	folios = seed_demo_folios()
	policies = seed_approval_policies()
	frappe.db.commit()

	return {"company": company, "base": base, "gst": gst, "org": org, "permissions": permissions, "folios": folios, "policies": policies}
