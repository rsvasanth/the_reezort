"""Idempotent HR masters seed for THE REEZORT.

Owner constraint (2026-06-30): no PF / ESI / PT — earnings only. Seeds:

- 3 Shift Types: Day 09:00–18:00, Evening 14:00–23:00, Night 22:00–07:00
- 3 Leave Types: Casual (12/y), Sick (12/y), Earned (21/y)
- 2 Salary Components: Basic (Earnings, formula `base`) and HRA
  (Earnings, formula `0.4 * base`)
- 1 Salary Structure "Standard Monthly — REEZORT" (Monthly, Basic + HRA)
- 1 Payroll Period for the current financial year (Apr–Mar in IN)

Re-run at any time — every doc is name-idempotent. Company is picked as the
first Company on the site (matches the rest of the setup module).
"""

import frappe
from the_reezort.permissions import system_manager_only
from frappe.utils import today, getdate


def _company():
	return frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")


def _upsert(doctype: str, name: str, defaults: dict, on_create: dict | None = None):
	"""Get-or-create-and-update. Returns the doc name."""
	if frappe.db.exists(doctype, name):
		doc = frappe.get_doc(doctype, name)
		for k, v in defaults.items():
			doc.set(k, v)
		doc.save(ignore_permissions=True)
		return doc.name
	payload = {"doctype": doctype, "name": name, **defaults, **(on_create or {})}
	doc = frappe.get_doc(payload)
	doc.insert(ignore_permissions=True)
	return doc.name


# ---------- Shift Types ----------

SHIFTS = [
	{"name": "Day", "start_time": "09:00:00", "end_time": "18:00:00"},
	{"name": "Evening", "start_time": "14:00:00", "end_time": "23:00:00"},
	{"name": "Night", "start_time": "22:00:00", "end_time": "07:00:00"},
]


def _seed_shifts():
	for s in SHIFTS:
		_upsert(
			"Shift Type",
			s["name"],
			{
				"start_time": s["start_time"],
				"end_time": s["end_time"],
				"enable_auto_attendance": 0,
			},
		)
	return [s["name"] for s in SHIFTS]


# ---------- Leave Types ----------

LEAVE_TYPES = [
	{"name": "Casual Leave", "max_days": 12},
	{"name": "Sick Leave", "max_days": 12},
	{"name": "Earned Leave", "max_days": 21},
]


def _seed_leave_types():
	for lt in LEAVE_TYPES:
		_upsert(
			"Leave Type",
			lt["name"],
			{
				"leave_type_name": lt["name"],
				"max_leaves_allowed": lt["max_days"],
				"is_lwp": 0,
				"is_carry_forward": 0,
				"include_holiday": 0,
			},
		)
	return [lt["name"] for lt in LEAVE_TYPES]


# ---------- Salary Components ----------

def _seed_salary_components():
	"""Basic + HRA only. Both Earnings; no PF/ESI/PT per owner constraint."""
	company = _company()

	# Basic — formula = base
	if not frappe.db.exists("Salary Component", "Basic"):
		basic = frappe.get_doc(
			{
				"doctype": "Salary Component",
				"salary_component": "Basic",
				"salary_component_abbr": "B",
				"type": "Earning",
				"amount_based_on_formula": 1,
				"formula": "base",
				"depends_on_payment_days": 1,
				"is_tax_applicable": 0,
			}
		)
		# Company account row is required in Frappe HR before submitting a
		# Salary Slip in some versions — leave accounts empty and let the
		# Salary Slip pick up defaults from the company. Kept simple here.
		basic.insert(ignore_permissions=True)

	# HRA — formula = 0.4 * base
	if not frappe.db.exists("Salary Component", "HRA"):
		hra = frappe.get_doc(
			{
				"doctype": "Salary Component",
				"salary_component": "HRA",
				"salary_component_abbr": "HRA",
				"type": "Earning",
				"amount_based_on_formula": 1,
				"formula": "0.4 * base",
				"depends_on_payment_days": 1,
				"is_tax_applicable": 0,
			}
		)
		hra.insert(ignore_permissions=True)

	# Keep formulas fresh on re-runs (in case someone tweaked them).
	frappe.db.set_value("Salary Component", "Basic", {"formula": "base", "amount_based_on_formula": 1})
	frappe.db.set_value("Salary Component", "HRA", {"formula": "0.4 * base", "amount_based_on_formula": 1})

	return ["Basic", "HRA"], company


# ---------- Salary Structure ----------

STANDARD_STRUCTURE_NAME = "Standard Monthly — REEZORT"


def _seed_standard_structure():
	company = _company()
	if frappe.db.exists("Salary Structure", STANDARD_STRUCTURE_NAME):
		return STANDARD_STRUCTURE_NAME

	doc = frappe.get_doc(
		{
			"doctype": "Salary Structure",
			"name": STANDARD_STRUCTURE_NAME,
			"is_active": "Yes",
			"payroll_frequency": "Monthly",
			"company": company,
			"currency": frappe.db.get_value("Company", company, "default_currency") or "INR",
			"earnings": [
				{"salary_component": "Basic", "amount_based_on_formula": 1, "formula": "base"},
				{"salary_component": "HRA", "amount_based_on_formula": 1, "formula": "0.4 * base"},
			],
			"deductions": [],
		}
	)
	doc.insert(ignore_permissions=True)
	# The structure needs to be submitted for it to be assignable.
	if doc.docstatus == 0:
		doc.submit()
	return doc.name


# ---------- Payroll Period ----------

def _current_fy_range():
	"""Return (start, end) for the current Indian FY (Apr 1 → Mar 31)."""
	t = getdate(today())
	if t.month < 4:
		fy_start = getdate(f"{t.year - 1}-04-01")
		fy_end = getdate(f"{t.year}-03-31")
	else:
		fy_start = getdate(f"{t.year}-04-01")
		fy_end = getdate(f"{t.year + 1}-03-31")
	return fy_start, fy_end


def _seed_payroll_period():
	company = _company()
	start, end = _current_fy_range()
	name = f"FY-{start.year}-{end.year}"
	if frappe.db.exists("Payroll Period", name):
		return name
	frappe.get_doc(
		{
			"doctype": "Payroll Period",
			"name": name,
			"company": company,
			"start_date": str(start),
			"end_date": str(end),
		}
	).insert(ignore_permissions=True)
	return name


# ---------- Public entrypoint ----------

@frappe.whitelist()
@system_manager_only
def seed_hr_masters():
	"""Whitelisted so a System Manager can trigger from the console/desk."""
	shifts = _seed_shifts()
	leave_types = _seed_leave_types()
	components, company = _seed_salary_components()
	structure = _seed_standard_structure()
	payroll_period = _seed_payroll_period()
	frappe.db.commit()
	return {
		"shifts": shifts,
		"leave_types": leave_types,
		"salary_components": components,
		"salary_structure": structure,
		"payroll_period": payroll_period,
		"company": company,
	}
