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


def _company_abbr(company):
	return frappe.db.get_value("Company", company, "abbr")


def _get_account(company, account_name=None, account_type=None, root_type=None):
	filters = {"company": company, "is_group": 0}
	if account_name:
		filters["account_name"] = account_name
	if account_type:
		filters["account_type"] = account_type
	if root_type:
		filters["root_type"] = root_type

	return frappe.db.get_value("Account", filters, "name")


def _get_or_create_warehouse(company, warehouse_name, parent_warehouse=None, is_group=0):
	warehouse = frappe.db.get_value(
		"Warehouse", {"company": company, "warehouse_name": warehouse_name}, "name"
	)
	if warehouse:
		return warehouse

	doc = frappe.get_doc(
		{
			"doctype": "Warehouse",
			"warehouse_name": warehouse_name,
			"company": company,
			"parent_warehouse": parent_warehouse,
			"is_group": is_group,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _get_or_create_cost_center(company, cost_center_name, parent_cost_center=None):
	cost_center = frappe.db.get_value(
		"Cost Center", {"company": company, "cost_center_name": cost_center_name}, "name"
	)
	if cost_center:
		return cost_center

	doc = frappe.get_doc(
		{
			"doctype": "Cost Center",
			"cost_center_name": cost_center_name,
			"company": company,
			"parent_cost_center": parent_cost_center,
			"is_group": 0,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _ensure_territory(country):
	territory = country if frappe.db.exists("Territory", country) else None
	if territory:
		return territory

	root = frappe.db.get_value("Territory", {"is_group": 1}, "name") or "All Territories"
	if country:
		doc = frappe.get_doc(
			{
				"doctype": "Territory",
				"territory_name": country,
				"parent_territory": root,
				"is_group": 0,
			}
		)
		doc.insert(ignore_permissions=True)
		return doc.name

	return frappe.db.get_value("Territory", {"is_group": 0}, "name") or root


def _upsert_doc(doctype, filters, values):
	name = frappe.db.get_value(doctype, filters, "name")
	if name:
		doc = frappe.get_doc(doctype, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
		return doc

	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True)
	return doc


def _upsert_item(item_code, values, defaults):
	doc = _upsert_doc("Item", {"item_code": item_code}, {"item_code": item_code, **values})
	doc.set("item_defaults", [defaults])
	doc.save(ignore_permissions=True)
	return doc


def _upsert_item_price(item_code, price_list, rate, currency, buying=0, selling=0):
	return _upsert_doc(
		"Item Price",
		{"item_code": item_code, "price_list": price_list, "buying": buying, "selling": selling},
		{
			"item_code": item_code,
			"price_list": price_list,
			"price_list_rate": rate,
			"currency": currency,
			"buying": buying,
			"selling": selling,
			"valid_from": today(),
		},
	)


def _seed_parties(company, country, currency):
	territory = _ensure_territory(country)
	customers = [
		("RZ-WALK-IN", "Walk-in Guest", "Individual"),
		("RZ-CORP-ALPHA", "Alpha Corporate Retreats", "Commercial"),
		("RZ-OTA-DEMO", "OTA Demo Channel", "Commercial"),
	]
	suppliers = [
		("RZ-SUP-FRESH", "Fresh Coast Foods", "Local"),
		("RZ-SUP-LINEN", "Premier Linen Services", "Services"),
		("RZ-SUP-ENG", "Resort Engineering Supplies", "Hardware"),
	]

	for name, customer_name, group in customers:
		_upsert_doc(
			"Customer",
			{"customer_name": customer_name},
			{
				"customer_name": customer_name,
				"customer_group": group if frappe.db.exists("Customer Group", group) else "All Customer Groups",
				"customer_type": "Individual" if group == "Individual" else "Company",
				"territory": territory,
				"default_currency": currency,
			},
		)

	for name, supplier_name, group in suppliers:
		_upsert_doc(
			"Supplier",
			{"supplier_name": supplier_name},
			{
				"supplier_name": supplier_name,
				"supplier_group": group if frappe.db.exists("Supplier Group", group) else "All Supplier Groups",
				"supplier_type": "Company",
				"default_currency": currency,
			},
		)

	return {"customers": len(customers), "suppliers": len(suppliers)}


def _seed_payment_modes(company):
	cash_account = _get_account(company, account_type="Cash")
	bank_account = _get_account(company, account_type="Bank") or cash_account
	rows = [
		("Cash", cash_account),
		("Credit Card", bank_account),
		("UPI", bank_account),
		("Bank Transfer", bank_account),
		("Room Folio Transfer", _get_account(company, account_type="Receivable") or cash_account),
	]

	for mode, account in rows:
		if not account:
			continue

		doc = _upsert_doc("Mode of Payment", {"mode_of_payment": mode}, {"mode_of_payment": mode, "enabled": 1})
		doc.set("accounts", [{"company": company, "default_account": account}])
		doc.save(ignore_permissions=True)

	return {"payment_modes": len(rows)}


def _seed_warehouses_and_cost_centers(company):
	root_warehouse = frappe.db.get_value("Warehouse", {"company": company, "is_group": 1}, "name")
	root_cost_center = frappe.db.get_value("Cost Center", {"company": company, "is_group": 1}, "name")

	warehouses = {
		"main_stores": _get_or_create_warehouse(company, "Main Stores", root_warehouse),
		"housekeeping_store": _get_or_create_warehouse(company, "Housekeeping Store", root_warehouse),
		"fb_store": _get_or_create_warehouse(company, "F&B Store", root_warehouse),
		"engineering_store": _get_or_create_warehouse(company, "Engineering Store", root_warehouse),
	}
	cost_centers = {
		"rooms": _get_or_create_cost_center(company, "Rooms", root_cost_center),
		"food_and_beverage": _get_or_create_cost_center(company, "Food and Beverage", root_cost_center),
		"banquets": _get_or_create_cost_center(company, "Banquets", root_cost_center),
		"housekeeping": _get_or_create_cost_center(company, "Housekeeping", root_cost_center),
		"engineering": _get_or_create_cost_center(company, "Engineering", root_cost_center),
	}

	return warehouses, cost_centers


def _seed_items(company, currency, warehouses, cost_centers):
	service_income = _get_account(company, account_name="Service") or _get_account(company, root_type="Income")
	sales_income = _get_account(company, account_name="Sales") or service_income
	cogs = _get_account(company, account_type="Cost of Goods Sold") or _get_account(company, root_type="Expense")
	default_warehouse = warehouses["main_stores"]
	selling_price_list = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
	buying_price_list = frappe.db.get_value("Price List", {"buying": 1, "enabled": 1}, "name")

	service_items = [
		("ROOM-DLX", "Deluxe Sea View Room Night", 14500, cost_centers["rooms"]),
		("ROOM-STE", "Executive Suite Room Night", 24500, cost_centers["rooms"]),
		("ROOM-VIL", "Beachfront Villa Room Night", 38500, cost_centers["rooms"]),
		("FNB-ADD-BUFFET", "All Day Dining Buffet", 2200, cost_centers["food_and_beverage"]),
		("FNB-ROOM-SERVICE", "Room Service Dining Charge", 1800, cost_centers["food_and_beverage"]),
		("BANQUET-HALL-RENTAL", "Banquet Hall Rental", 75000, cost_centers["banquets"]),
		("LAUNDRY-SERVICE", "Guest Laundry Service", 650, cost_centers["housekeeping"]),
	]
	stock_items = [
		("HK-LINEN-KIT", "Guest Linen Kit", "Consumable", warehouses["housekeeping_store"], 850, 120),
		("HK-AMENITY-KIT", "Guest Amenity Kit", "Consumable", warehouses["housekeeping_store"], 180, 250),
		("FNB-BOTTLED-WATER", "Premium Bottled Water", "Consumable", warehouses["fb_store"], 35, 500),
		("FNB-COFFEE", "House Coffee Beans", "Consumable", warehouses["fb_store"], 950, 40),
		("ENG-MAINTENANCE-KIT", "Room Maintenance Kit", "Consumable", warehouses["engineering_store"], 1250, 25),
	]

	for item_code, item_name, rate, cost_center in service_items:
		_upsert_item(
			item_code,
			{
				"item_name": item_name,
				"item_group": "Services",
				"stock_uom": "Nos",
				"is_stock_item": 0,
				"is_sales_item": 1,
				"is_purchase_item": 0,
			},
			{
				"company": company,
				"income_account": service_income,
				"selling_cost_center": cost_center,
			},
		)
		if selling_price_list:
			_upsert_item_price(item_code, selling_price_list, rate, currency, selling=1)

	for item_code, item_name, item_group, warehouse, valuation_rate, opening_qty in stock_items:
		_upsert_item(
			item_code,
			{
				"item_name": item_name,
				"item_group": item_group,
				"stock_uom": "Nos" if item_code != "FNB-COFFEE" else "Kg",
				"is_stock_item": 1,
				"is_sales_item": 1 if item_code == "FNB-BOTTLED-WATER" else 0,
				"is_purchase_item": 1,
				"valuation_rate": valuation_rate,
				"standard_rate": valuation_rate,
			},
			{
				"company": company,
				"default_warehouse": warehouse,
				"income_account": sales_income,
				"expense_account": cogs,
				"buying_cost_center": cost_centers["housekeeping"],
				"selling_cost_center": cost_centers["food_and_beverage"],
			},
		)
		if buying_price_list:
			_upsert_item_price(item_code, buying_price_list, valuation_rate, currency, buying=1)
		if selling_price_list and item_code == "FNB-BOTTLED-WATER":
			_upsert_item_price(item_code, selling_price_list, 150, currency, selling=1)

	return {"service_items": len(service_items), "stock_items": len(stock_items), "opening_stock": stock_items}


def _seed_opening_stock(company, stock_items):
	if not stock_items:
		return {"stock_entry": None, "stock_rows": 0}

	rows = []
	for item_code, _item_name, _item_group, warehouse, valuation_rate, opening_qty in stock_items:
		if frappe.db.exists("Stock Ledger Entry", {"item_code": item_code, "warehouse": warehouse, "is_cancelled": 0}):
			continue
		rows.append(
			{
				"item_code": item_code,
				"qty": opening_qty,
				"t_warehouse": warehouse,
				"basic_rate": valuation_rate,
			}
		)

	if not rows:
		return {"stock_entry": None, "stock_rows": 0}

	doc = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"company": company,
			"stock_entry_type": "Material Receipt",
			"purpose": "Material Receipt",
			"posting_date": today(),
			"items": rows,
		}
	)
	doc.insert(ignore_permissions=True)
	doc.submit()
	return {"stock_entry": doc.name, "stock_rows": len(rows)}


def seed_erpnext_demo_masters(company, country="India", currency="INR"):
	warehouses, cost_centers = _seed_warehouses_and_cost_centers(company)
	parties = _seed_parties(company, country, currency)
	payment_modes = _seed_payment_modes(company)
	items = _seed_items(company, currency, warehouses, cost_centers)
	opening_stock = _seed_opening_stock(company, items.pop("opening_stock"))

	return {
		"warehouses": len(warehouses),
		"cost_centers": len(cost_centers),
		**parties,
		**payment_modes,
		**items,
		**opening_stock,
	}


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

	erpnext_seed = seed_erpnext_demo_masters(company=company, country=country, currency=currency)
	seed = seed_demo_property(company=company)
	completeness = run_setup_completeness_check(property=seed["property"])

	frappe.db.commit()

	return {
		"company": company,
		"created_company": created_company,
		"erpnext_seed": erpnext_seed,
		"seed": seed,
		"completeness": completeness,
	}
