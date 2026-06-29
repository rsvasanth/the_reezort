import frappe
from frappe import _
from frappe.utils import getdate, today

from the_reezort.property.api import run_setup_completeness_check, seed_demo_property


def _india_fiscal_year(reference_date=None):
	reference = getdate(reference_date or today())
	start_year = reference.year if reference.month >= 4 else reference.year - 1
	return f"{start_year}-04-01", f"{start_year + 1}-03-31"


def _get_company(company_name=None):
	if company_name:
		company = frappe.db.get_value("Company", {"company_name": company_name}, "name")
		if company:
			return company

	return frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
		"Company", {}, "name"
	)


def _run_erpnext_setup(company_name, company_abbr, country, currency, chart_of_accounts):
	from frappe.desk.page.setup_wizard.setup_wizard import setup_complete

	fy_start_date, fy_end_date = _india_fiscal_year()
	setup_complete(
		{
			"currency": currency,
			"full_name": "THE REEZORT Administrator",
			"company_name": company_name,
			"timezone": "Asia/Kolkata",
			"company_abbr": company_abbr,
			"industry": "Hospitality",
			"domain": "Services",
			"country": country,
			"fy_start_date": fy_start_date,
			"fy_end_date": fy_end_date,
			"language": "english",
			"company_tagline": "Five-star resort operations",
			"email": "admin@app.thereezort.com",
			"password": frappe.generate_hash(length=24),
			"chart_of_accounts": chart_of_accounts,
		}
	)

	return _get_company(company_name)


@frappe.whitelist()
def bootstrap_demo_site(
	company_name="THE REEZORT Private Limited",
	company_abbr="TRZ",
	country="India",
	currency="INR",
	chart_of_accounts="India - Chart of Accounts",
):
	created_company = False
	company = _get_company(company_name)

	if not company:
		company = _run_erpnext_setup(
			company_name=company_name,
			company_abbr=company_abbr,
			country=country,
			currency=currency,
			chart_of_accounts=chart_of_accounts,
		)
		created_company = True

	if not company:
		frappe.throw(_("ERPNext Company setup did not complete."))

	seed = seed_demo_property(company=company)
	completeness = run_setup_completeness_check(property=seed["property"])

	frappe.db.commit()

	return {
		"company": company,
		"created_company": created_company,
		"seed": seed,
		"completeness": completeness,
	}
