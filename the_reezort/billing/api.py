import json
from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import flt, today

from the_reezort.utils import as_dict as _as_dict
from the_reezort.utils import envelope as _envelope
from the_reezort.utils import require_permission as _require_permission


FINANCE_ROLES = {"Accounts User", "Accounts Manager", "Finance Manager", "System Manager"}
# billing/deposits.py has its own CLOSED_FOLIO_STATUSES (the complementary
# terminal set) — the two used to share this exact name with opposite
# contents. Keep them separately named; don't reintroduce the collision.
OPEN_FOLIO_STATUSES = {"Draft", "Open", "Under Review", "Ready for Settlement"}
FOLIO_TOTAL_FIELDS = (
	"total_charges",
	"total_discounts",
	"total_taxes_estimated",
	"total_paid",
	"outstanding_amount",
)
ERP_LINK_FIELDS = (
	"erpnext_sales_invoice",
	"erpnext_payment_entry",
	"erpnext_credit_note",
	"erpnext_journal_entry",
)


# Line types that reduce a folio balance — money leaving the guest's favour.
# These must never be posted by a plain operational login without finance review.
REDUCTION_LINE_TYPES = {"Discount", "Adjustment", "Write-Off", "Refund"}


def _authorize_folio_line(line_type, amount, rate, discount_amount, guest_folio=None, approval_request=None):
	"""Reject folio lines that move money in the guest's favour unless the caller
	holds a finance/manager role, and gate large reductions behind approval.

	- Positive-charge line types (Charge, Tax Preview, etc.) may not carry a
	  negative amount/rate — that would silently reduce the outstanding balance.
	- Reduction line types (Discount / Adjustment / Write-Off / Refund) and any
	  explicit discount_amount require a finance role.
	- Above the `large_discount` policy threshold, the reduction also needs a
	  manager sign-off (reuses the seeded Approval Policy; no policy → proceeds).
	"""
	is_reduction = (
		line_type in REDUCTION_LINE_TYPES
		or amount < 0
		or rate < 0
		or discount_amount > 0
	)
	if not is_reduction:
		return

	if not _is_finance_user():
		frappe.throw(
			_("Discounts, adjustments, refunds, and negative charges require a finance role."),
			frappe.PermissionError,
		)

	reduction_value = max(abs(flt(amount)), flt(discount_amount))
	if reduction_value > 0:
		from the_reezort.approvals.api import require_approval

		require_approval(
			action="large_discount",
			source_doctype="Folio Line",
			source_name=guest_folio or "manual",
			payload={"amount": reduction_value, "line_type": line_type},
			approval_request=approval_request,
		)


def _guest_image_for_folio(doc):
	if not doc.reservation:
		return None

	guest_profile = frappe.db.get_value("Reservation", doc.reservation, "staying_guest_profile")
	if not guest_profile:
		return None

	return frappe.db.get_value("Guest Profile", guest_profile, "image")


def _folio_header(doc):
	stay_info = (
		frappe.db.get_value("Stay", doc.stay, ["stay_status", "current_room", "arrival_date", "departure_date"], as_dict=True)
		if doc.stay
		else None
	)
	current_room = stay_info.current_room if stay_info else None
	room_image = None
	if current_room:
		room_image = frappe.db.get_value("Room", current_room, "image")
		if not room_image:
			rt = frappe.db.get_value("Room", current_room, "room_type")
			if rt:
				room_image = frappe.db.get_value("Room Type", rt, "image")
	return {
		"name": doc.name,
		"resort_property": doc.resort_property,
		"company": doc.company,
		"stay": doc.stay,
		"stay_status": stay_info.stay_status if stay_info else None,
		"current_room": current_room,
		"current_room_image": room_image,
		"arrival_date": str(stay_info.arrival_date) if stay_info and stay_info.arrival_date else None,
		"departure_date": str(stay_info.departure_date) if stay_info and stay_info.departure_date else None,
		"reservation": doc.reservation,
		"customer": doc.customer,
		"guest_image": _guest_image_for_folio(doc),
		"folio_type": doc.folio_type,
		"primary_folio": doc.primary_folio,
		"folio_status": doc.folio_status,
		"currency": doc.currency,
		"balance_status": doc.balance_status,
		"posting_status": doc.posting_status,
		"billing_instruction": doc.billing_instruction,
		"credit_allowed": doc.credit_allowed,
		"closed_by": doc.closed_by,
		"closed_at": doc.closed_at,
	}


def _folio_totals(doc):
	return {fieldname: flt(doc.get(fieldname)) for fieldname in FOLIO_TOTAL_FIELDS}


def _company_for_property(property_name):
	return frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value(
		"Resort Property", property_name, "company"
	)


def _source_doc(reservation=None, stay=None):
	if reservation:
		return frappe.get_doc("Reservation", reservation)

	if stay:
		if not frappe.db.exists("DocType", "Stay"):
			frappe.throw(_("Stay is not available yet; pass a Reservation to open a folio."))
		return frappe.get_doc("Stay", stay)

	return None


def _find_existing_primary_folio(reservation=None, stay=None):
	if reservation:
		existing = frappe.db.get_value(
			"Guest Folio",
			{"reservation": reservation, "primary_folio": 1},
			"name",
			order_by="creation asc",
		)
		if existing:
			return existing

	if stay:
		return frappe.db.get_value(
			"Guest Folio",
			{"stay": stay, "primary_folio": 1},
			"name",
			order_by="creation asc",
		)

	return None


def _primary_guest_profile(reservation_doc):
	for row in reservation_doc.get("guests") or []:
		if row.is_primary_guest and row.guest_profile:
			return row.guest_profile

	return reservation_doc.get("staying_guest_profile") or reservation_doc.get("booker_guest_profile")


def _default_customer_group():
	customer_group = frappe.db.get_single_value("Selling Settings", "customer_group")
	if customer_group and not frappe.db.get_value("Customer Group", customer_group, "is_group"):
		return customer_group

	if frappe.db.exists("Customer Group", "Individual") and not frappe.db.get_value(
		"Customer Group", "Individual", "is_group"
	):
		return "Individual"

	return frappe.db.get_value("Customer Group", {"is_group": 0}, "name")


def _default_territory():
	territory = frappe.db.get_single_value("Selling Settings", "territory")
	if territory and not frappe.db.get_value("Territory", territory, "is_group"):
		return territory

	if frappe.db.exists("Territory", "India") and not frappe.db.get_value("Territory", "India", "is_group"):
		return "India"

	return frappe.db.get_value("Territory", {"is_group": 0}, "name")


def _customer_by_guest_profile(profile_name):
	if not profile_name:
		return None

	profile = frappe.get_doc("Guest Profile", profile_name)
	if profile.erpnext_customer:
		return profile.erpnext_customer

	customer = None
	customer_meta = frappe.get_meta("Customer")
	if profile.email and customer_meta.has_field("email_id"):
		customer = frappe.db.get_value("Customer", {"email_id": profile.email}, "name")

	if not customer:
		customer = frappe.db.get_value("Customer", {"customer_name": profile.guest_full_name}, "name")

	if customer:
		profile.erpnext_customer = customer
		profile.save(ignore_permissions=True)
		return customer

	customer_group = _default_customer_group()
	territory = _default_territory()
	if not customer_group or not territory:
		frappe.throw(_("Default Customer Group and Territory are required to create a guest customer."))

	values = {
		"doctype": "Customer",
		"customer_name": profile.guest_full_name,
		"customer_group": customer_group,
		"customer_type": "Individual",
		"territory": territory,
	}
	if profile.email and customer_meta.has_field("email_id"):
		values["email_id"] = profile.email

	customer_doc = frappe.get_doc(values)
	customer_doc.insert(ignore_permissions=True)

	profile.erpnext_customer = customer_doc.name
	profile.save(ignore_permissions=True)
	return customer_doc.name


def _resolve_customer(explicit_customer=None, reservation_doc=None):
	if explicit_customer:
		return explicit_customer

	if reservation_doc:
		linked_customer = reservation_doc.get("bill_to_customer") or reservation_doc.get("erpnext_customer")
		if linked_customer:
			return linked_customer

		customer = _customer_by_guest_profile(_primary_guest_profile(reservation_doc))
		if customer:
			reservation_doc.erpnext_customer = customer
			reservation_doc.save(ignore_permissions=True)
			return customer

	frappe.throw(_("A Customer is required before opening a guest folio."))


def _line_dict(line, expose_erpnext_links):
	row = {
		"name": line.name,
		"guest_folio": line.guest_folio,
		"line_type": line.line_type,
		"source_module": line.source_module,
		"source_doctype": line.source_doctype,
		"source_name": line.source_name,
		"source_row_id": line.source_row_id,
		"idempotency_key": line.idempotency_key,
		"service_date": line.service_date,
		"department": line.department,
		"cost_center": line.cost_center,
		"item_code": line.item_code,
		"description": line.description,
		"qty": flt(line.qty),
		"rate": flt(line.rate),
		"amount": flt(line.amount),
		"tax_treatment": line.tax_treatment,
		"discount_amount": flt(line.discount_amount),
		"line_status": line.line_status,
	}

	for fieldname in ERP_LINK_FIELDS:
		row[fieldname] = line.get(fieldname) if expose_erpnext_links else None

	return row


def _is_finance_user():
	return bool(set(frappe.get_roles(frappe.session.user)).intersection(FINANCE_ROLES))


# Roles permitted to see guest government-ID data (legal/compliance need).
KYC_VIEW_ROLES = FINANCE_ROLES | {"Front Desk", "Resort Manager"}


def _can_view_kyc():
	return bool(set(frappe.get_roles(frappe.session.user)).intersection(KYC_VIEW_ROLES))


def _can_view_erpnext_links():
	return _is_finance_user()


def _group_lines(lines, expose_erpnext_links):
	grouped = defaultdict(lambda: defaultdict(list))

	for line in lines:
		grouped[str(line.service_date)][line.department or None].append(_line_dict(line, expose_erpnext_links))

	return [
		{
			"service_date": service_date,
			"departments": [
				{"department": department, "lines": department_lines}
				for department, department_lines in departments.items()
			],
		}
		for service_date, departments in grouped.items()
	]


@frappe.whitelist()
def get_or_create_folio(reservation=None, stay=None, customer=None, folio_type="Guest"):
	_require_permission("Guest Folio", "create")

	if not reservation and not stay:
		frappe.throw(_("Reservation or Stay is required to open a folio."))

	existing = _find_existing_primary_folio(reservation=reservation, stay=stay)
	if existing:
		return _envelope({"folio": _folio_header(frappe.get_doc("Guest Folio", existing))})

	source_doc = _source_doc(reservation=reservation, stay=stay)
	property_name = source_doc.get("resort_property")
	currency = source_doc.get("currency") or frappe.db.get_value("Resort Property", property_name, "default_currency")
	company = _company_for_property(property_name)
	customer_name = _resolve_customer(customer, source_doc if reservation else None)

	if not property_name or not company or not currency:
		frappe.throw(_("Property, company, and currency are required to open a folio."))

	folio = frappe.get_doc(
		{
			"doctype": "Guest Folio",
			"resort_property": property_name,
			"company": company,
			"stay": stay,
			"reservation": reservation,
			"customer": customer_name,
			"folio_type": folio_type,
			"primary_folio": 1,
			"folio_status": "Open",
			"currency": currency,
		}
	)
	folio.insert(ignore_permissions=True, ignore_links=bool(stay))
	frappe.db.commit()

	return _envelope({"folio": _folio_header(folio)})


@frappe.whitelist()
def add_folio_line(guest_folio, payload, approval_request=None):
	_require_permission("Guest Folio", "write")
	payload = _as_dict(payload)

	qty = flt(payload.get("qty") or 1)
	rate = flt(payload.get("rate"))
	amount = payload.get("amount")
	if amount is None:
		amount = qty * rate
	amount = flt(amount)

	line_type = payload.get("line_type") or "Charge"
	_authorize_folio_line(
		line_type, amount, rate, flt(payload.get("discount_amount")),
		guest_folio=guest_folio, approval_request=approval_request,
	)

	line = frappe.get_doc(
		{
			"doctype": "Folio Line",
			"guest_folio": guest_folio,
			"line_type": line_type,
			"source_module": payload.get("source_module") or "Manual",
			"source_doctype": payload.get("source_doctype"),
			"source_name": payload.get("source_name"),
			"source_row_id": payload.get("source_row_id"),
			"idempotency_key": payload.get("idempotency_key") or frappe.generate_hash(length=20),
			"service_date": payload.get("service_date") or today(),
			"department": payload.get("department"),
			"cost_center": payload.get("cost_center"),
			"item_code": payload.get("item_code"),
			"description": payload.get("description"),
			"qty": qty,
			"rate": rate,
			"amount": flt(amount),
			"tax_treatment": payload.get("tax_treatment") or "Standard",
			"discount_amount": flt(payload.get("discount_amount")),
		}
	)
	line.insert(ignore_permissions=True)
	frappe.db.commit()

	folio = frappe.get_doc("Guest Folio", guest_folio)
	return _envelope({"folio_line": line.name, "folio_totals": _folio_totals(folio)})


@frappe.whitelist()
def get_folio_detail(guest_folio):
	_require_permission("Guest Folio", "read")

	folio = frappe.get_doc("Guest Folio", guest_folio)
	lines = frappe.get_all(
		"Folio Line",
		filters={"guest_folio": guest_folio},
		fields=[
			"name",
			"guest_folio",
			"line_type",
			"source_module",
			"source_doctype",
			"source_name",
			"source_row_id",
			"idempotency_key",
			"service_date",
			"department",
			"cost_center",
			"item_code",
			"description",
			"qty",
			"rate",
			"amount",
			"tax_treatment",
			"discount_amount",
			"line_status",
			*ERP_LINK_FIELDS,
		],
		order_by="service_date asc, department asc, creation asc",
	)

	# Return a FLAT list of lines; the SPA groups by service_date -> department
	# client-side (per the UI contract). Returning a pre-grouped shape broke the
	# frontend's groupLines() and crashed on undefined line fields.
	expose_links = _can_view_erpnext_links()
	# TODO: Replace this basic role check with formal field-level masking in the permissions packet.
	next_actions = ["add_line"] if folio.folio_status in OPEN_FOLIO_STATUSES else []
	# Offer settlement once the folio carries unposted charges to invoice.
	if folio.folio_status in OPEN_FOLIO_STATUSES and flt(folio.total_charges) > 0 and folio.posting_status != "Posted":
		next_actions.append("open_settlement")
	return _envelope(
		{
			"folio": _folio_header(folio),
			"lines": [_line_dict(line, expose_links) for line in lines],
			"totals": _folio_totals(folio),
			"balance_status": folio.balance_status,
			"posting_status": folio.posting_status,
		},
		next_actions=next_actions,
	)


@frappe.whitelist()
def get_active_folios(limit=20):
	"""Live list of in-house / open folios for the workspace sidebar."""
	_require_permission("Guest Folio", "read")

	folios = frappe.get_all(
		"Guest Folio",
		filters={"folio_status": ["in", ["Draft", "Open", "Under Review", "Ready for Settlement"]]},
		fields=["name", "customer", "reservation", "stay", "folio_status", "outstanding_amount", "currency"],
		order_by="modified desc",
		limit=int(limit),
	)

	result = []
	for folio in folios:
		guest = folio.customer
		room = None
		if folio.stay:
			stay = frappe.db.get_value("Stay", folio.stay, ["primary_guest_name", "current_room"], as_dict=True)
			if stay:
				guest = stay.primary_guest_name or guest
				room = stay.current_room
		result.append(
			{
				"name": folio.name,
				"guest": guest,
				"guest_image": _guest_image_for_folio(folio),
				"room": room,
				"folio_status": folio.folio_status,
				"outstanding": flt(folio.outstanding_amount),
				"currency": folio.currency,
			}
		)

	return _envelope({"folios": result})


@frappe.whitelist()
def get_invoice_bundle(guest_folio):
	"""Everything needed to render a proper guest Tax Invoice PDF.

	Combines the folio, its Sales Invoice (net_total, CGST/SGST/IGST split,
	place of supply, grand_total), the guest profile (address, ID, phone),
	the stay, and the payment entries. Used only for display/PDF; no writes.
	"""
	_require_permission("Guest Folio", "read")
	folio = frappe.get_doc("Guest Folio", guest_folio)

	# Guest profile — via the reservation (if any), else the folio's customer.
	# Government-ID fields are PII: only expose them to KYC-authorized roles.
	guest_profile = None
	if folio.reservation:
		p = frappe.db.get_value("Reservation", folio.reservation, "staying_guest_profile")
		if p:
			fields = ["name", "guest_full_name", "email", "phone", "date_of_birth",
				"nationality", "address"]
			if _can_view_kyc():
				fields += ["id_type", "id_number"]
			guest_profile = frappe.db.get_value("Guest Profile", p, fields, as_dict=True)

	# Stay
	stay = None
	if folio.stay:
		stay = frappe.db.get_value(
			"Stay", folio.stay,
			["name", "stay_status", "current_room", "arrival_date", "departure_date", "adult_count", "child_count"],
			as_dict=True,
		)

	# Sales Invoice(s) posted from this folio's charge lines.
	invoice_names = list({
		row.erpnext_sales_invoice
		for row in frappe.get_all(
			"Folio Line",
			filters={"guest_folio": guest_folio, "erpnext_sales_invoice": ["is", "set"]},
			fields=["erpnext_sales_invoice"],
		)
		if row.erpnext_sales_invoice
	})
	# Some ERPNext installs don't have India GST enabled → no gst_hsn_code on Item.
	item_has_hsn = frappe.db.has_column("Item", "gst_hsn_code")

	invoices = []
	for name in invoice_names:
		si = frappe.get_doc("Sales Invoice", name)
		invoices.append(
			{
				"name": si.name,
				"posting_date": str(si.posting_date),
				"due_date": str(si.due_date) if si.due_date else None,
				"net_total": flt(si.net_total),
				"total_taxes_and_charges": flt(si.total_taxes_and_charges),
				"grand_total": flt(si.grand_total),
				"rounded_total": flt(si.rounded_total or si.grand_total),
				"total_advance": flt(si.total_advance),
				"outstanding_amount": flt(si.outstanding_amount),
				"place_of_supply": si.place_of_supply if hasattr(si, "place_of_supply") else None,
				"currency": si.currency,
				"customer": si.customer,
				"customer_name": si.customer_name,
				"items": [
					{
						"item_code": r.item_code,
						"item_name": r.item_name,
						"description": r.description,
						"qty": flt(r.qty),
						"rate": flt(r.rate),
						"amount": flt(r.amount),
						# GST fields — HSN is common on ERPNext items; not all installs have gst_hsn_code
						"hsn_code": (
							frappe.db.get_value("Item", r.item_code, "gst_hsn_code") if r.item_code and item_has_hsn else None
						),
					}
					for r in si.items
				],
				"taxes": [
					{"description": t.description, "rate": flt(t.rate), "tax_amount": flt(t.tax_amount)}
					for t in si.taxes
				],
			}
		)

	# Payment Entries (advance deposits + settlement payments).
	pe_names = list({
		row.erpnext_payment_entry
		for row in frappe.get_all(
			"Folio Line",
			filters={"guest_folio": guest_folio, "erpnext_payment_entry": ["is", "set"]},
			fields=["erpnext_payment_entry"],
		)
		if row.erpnext_payment_entry
	})
	payments = []
	for pe in pe_names:
		row = frappe.db.get_value(
			"Payment Entry", pe,
			["name", "posting_date", "mode_of_payment", "paid_amount", "reference_no"],
			as_dict=True,
		)
		if row:
			row["posting_date"] = str(row.posting_date) if row.posting_date else None
			payments.append(row)

	# Company for GSTIN / address. Some installs don't have gst_category.
	company_fields = ["name", "abbr", "country", "phone_no", "email"]
	if frappe.db.has_column("Company", "gst_category"):
		company_fields.append("gst_category")
	company = frappe.db.get_value("Company", folio.company, company_fields, as_dict=True)
	# GSTIN lives on Address linked to Company, or on Company itself. Guard both.
	company_gstin = None
	try:
		if frappe.db.has_column("Address", "gstin"):
			company_gstin = frappe.db.get_value(
				"Address", {"is_your_company_address": 1, "gstin": ["is", "set"]}, "gstin"
			)
	except Exception:
		company_gstin = None

	return _envelope(
		{
			"folio": _folio_header(folio),
			"totals": _folio_totals(folio),
			"guest_profile": guest_profile,
			"stay": stay,
			"invoices": invoices,
			"payments": payments,
			"company": company,
			"company_gstin": company_gstin,
			"resort_property": folio.resort_property,
		}
	)
