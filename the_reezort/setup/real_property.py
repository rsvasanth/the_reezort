"""Reset to the real THE REEZORT property — clean slate + 7 signature villas.

Wipes ALL operational + demo financial data (keeping company/finance/staff masters)
and stands up the real property: one room type "Signature Arch Villa" priced via a
real ERPNext Item Price, with 7 units (Villa 1-7) each carrying WiFi/TV/AC.

Idempotent: safe to re-run (re-wipes, re-creates, refreshes the nightly rate).
"""

import frappe
from the_reezort.permissions import system_manager_only

from the_reezort.setup import api as setup_api
from the_reezort.setup import management


# ---------- teardown ----------

def _delete_all(doctype):
	for name in frappe.get_all(doctype, pluck="name"):
		try:
			frappe.delete_doc(doctype, name, force=True, ignore_permissions=True, delete_permanently=True)
		except Exception:
			frappe.db.delete(doctype, {"name": name})


def _cancel_and_delete(doctype):
	for name in frappe.get_all(doctype, filters={"docstatus": 1}, pluck="name"):
		try:
			frappe.get_doc(doctype, name).cancel()
		except Exception:
			pass
	_delete_all(doctype)


def wipe_operational():
	"""Remove all operational + demo financial records. Keeps company/finance/staff masters."""
	# Submitted financial documents first.
	_cancel_and_delete("Payment Entry")
	_cancel_and_delete("Sales Invoice")
	if frappe.db.exists("DocType", "ERPNext Posting Log"):
		_delete_all("ERPNext Posting Log")

	# Operational records (children/referencers before their parents).
	operational = [
		"Service Ticket",
		"Room Inspection",
		"Housekeeping Checklist Result",
		"Housekeeping Task",
		"Room Condition Capture",
		"Folio Line",
		"Guest Folio",
		"Room Hold",
		"Reservation",
		"Stay",
		"Guest Profile",
	]
	for dt in operational:
		if frappe.db.exists("DocType", dt):
			_delete_all(dt)

	# Property hierarchy: rooms first, property last.
	for dt in ["Room", "Resort Floor", "Resort Building", "Room Type", "Resort Property"]:
		_delete_all(dt)

	frappe.db.commit()


# ---------- build ----------

REAL_PROPERTY_NAME = "THE REEZORT"
REAL_PROPERTY_CODE = "REEZORT"
UNIT_TYPE_NAME = "Signature Arch Villa"
UNIT_TYPE_CODE = "SAV"
UNIT_COUNT = 7
EQUIPMENT = [("WiFi", "WIFI"), ("Television", "TV"), ("Air Conditioner", "AC")]


@frappe.whitelist()
@system_manager_only
def reset_and_seed_real_property(nightly_rate=18000, wipe=1):
	"""Clean slate, then build THE REEZORT with 7 priced Signature Arch Villas."""
	nightly_rate = float(nightly_rate)
	if str(wipe) in ("1", "true", "True"):
		wipe_operational()

	company = setup_api._resort_company()

	prop = setup_api.create_property(
		{
			"property_name": REAL_PROPERTY_NAME,
			"property_code": REAL_PROPERTY_CODE,
			"company": company,
			"timezone": "Asia/Kolkata",
			"default_currency": "INR",
		}
	)["data"]["property"]["name"]

	building = setup_api.create_building(
		{"resort_property": prop, "building_name": "Resort Grounds", "building_code": "GROUNDS"}
	)["data"]["building"]["name"]

	floor = setup_api.create_floor(
		{"resort_property": prop, "building": building, "floor_label": "Ground", "floor_code": "G"}
	)["data"]["floor"]["name"]

	room_type = setup_api.create_room_type(
		{
			"resort_property": prop,
			"room_type_name": UNIT_TYPE_NAME,
			"room_type_code": UNIT_TYPE_CODE,
			"standard_adults": 2,
			"standard_children": 1,
			"max_occupancy": 3,
			"nightly_rate": nightly_rate,
		}
	)["data"]["room_type"]["name"]

	# Equipment catalog.
	amenities = {
		code: management.create_amenity({"amenity_name": nm, "amenity_code": code})["data"]["amenity"]["name"]
		for nm, code in EQUIPMENT
	}

	# 7 villas.
	villa_numbers = [f"V{i}" for i in range(1, UNIT_COUNT + 1)]
	setup_api.create_rooms_bulk(
		{
			"resort_property": prop,
			"building": building,
			"floor": floor,
			"room_type": room_type,
			"room_numbers": villa_numbers,
		}
	)

	# Name + equip each villa (resolve the autonamed Room by property + number).
	equip_items = [{"amenity": amenities[c], "condition": "Working"} for _, c in EQUIPMENT]
	for i, vn in enumerate(villa_numbers, 1):
		room = frappe.db.get_value("Room", {"resort_property": prop, "room_number": vn}, "name")
		if not room:
			continue
		frappe.db.set_value("Room", room, "room_name", f"Villa {i}")
		management.set_room_equipment(room, equip_items)

	frappe.db.commit()
	return {
		"property": prop,
		"room_type": room_type,
		"item": f"ROOM-{UNIT_TYPE_CODE}",
		"nightly_rate": nightly_rate,
		"units": villa_numbers,
	}
