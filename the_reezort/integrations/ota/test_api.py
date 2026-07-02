"""Tests for the OTA reservation ingest API — spec 013 first slice."""

from __future__ import annotations

import json

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from the_reezort.integrations.ota.adapters import parse_bookingcom_row, parse_expedia_row
from the_reezort.integrations.ota.api import (
	convert_to_reservation,
	get_message,
	ingest_payload,
	list_inbox,
	reject_message,
	retry_dead_letter,
)
from the_reezort.property.api import seed_demo_property
from the_reezort.setup.bootstrap import seed_erpnext_demo_masters


def _bookingcom_csv(external_id: str = "BDC-TEST-1", guest: str = "Test Guest") -> str:
	return (
		"Reservation number,Guest name,Guest email,Guest phone,Check-in,Check-out,Adults,Children,Room,Rate plan,Total price,Currency\n"
		f"{external_id},{guest},{guest.replace(' ', '.').lower()}@example.com,+91 90000 00000,"
		f"{add_days(today(), 5)},{add_days(today(), 7)},2,0,SAV,BAR,28000,INR\n"
	)


class TestOtaApi(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		company = (
			frappe.db.get_single_value("Global Defaults", "default_company")
			or frappe.db.get_value("Company", {}, "name")
		)
		seed_erpnext_demo_masters(company, currency="INR")
		seed = seed_demo_property(company)
		cls.resort_property = seed["property"]

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		frappe.db.delete("OTA Reservation Message")
		frappe.db.delete("OTA Ingest Batch")
		# Reservations created via convert_to_reservation carry a source_reference
		# starting with BDC-/EXP-. Clear them so re-runs don't hit the "already
		# converted" hard dupe check.
		frappe.db.sql(
			"DELETE FROM `tabReservation` WHERE source_reference LIKE 'BDC-%' OR source_reference LIKE 'EXP-%'"
		)
		frappe.db.commit()

	# ------------------------------------------------------------------
	# Adapter
	# ------------------------------------------------------------------

	def test_bookingcom_adapter_maps_all_fields(self):
		row = {
			"Reservation number": "BDC-9999",
			"Guest name": "Alice",
			"Guest email": "alice@x.com",
			"Check-in": "2026-08-01",
			"Check-out": "2026-08-04",
			"Adults": "2",
			"Children": "0",
			"Room": "SAV",
			"Rate plan": "BAR",
			"Total price": "45000",
			"Currency": "INR",
		}
		parsed = parse_bookingcom_row(row)
		self.assertEqual(parsed["external_id"], "BDC-9999")
		self.assertEqual(parsed["parsed_guest_name"], "Alice")
		self.assertEqual(parsed["parsed_arrival"], "2026-08-01")
		self.assertEqual(parsed["parsed_departure"], "2026-08-04")
		self.assertEqual(parsed["parsed_adults"], 2)
		self.assertEqual(parsed["parsed_total"], 45000)

	def test_expedia_adapter_uses_alt_column_names(self):
		"""Expedia's export uses 'Confirmation number' + 'Arrival' instead of
		Booking.com's names — the adapter recognises them."""
		row = {"Confirmation number": "EXP-1", "Arrival": "2026-08-10", "Departure": "2026-08-12"}
		parsed = parse_expedia_row(row)
		self.assertEqual(parsed["external_id"], "EXP-1")
		self.assertEqual(parsed["parsed_arrival"], "2026-08-10")

	# ------------------------------------------------------------------
	# Ingest
	# ------------------------------------------------------------------

	def test_ingest_csv_creates_one_message_per_row(self):
		result = ingest_payload("Booking.com", _bookingcom_csv("BDC-100", "Aarav"))
		self.assertEqual(result["data"]["success_count"], 1)
		self.assertEqual(result["data"]["duplicate_count"], 0)
		self.assertFalse(result["data"]["reused"])
		msg = frappe.get_all("OTA Reservation Message", filters={"external_id": "BDC-100"}, pluck="name")
		self.assertEqual(len(msg), 1)

	def test_ingest_same_payload_returns_prior_batch(self):
		"""File-level idempotency: re-uploading identical payload reuses the batch."""
		payload = _bookingcom_csv("BDC-200", "Diya")
		r1 = ingest_payload("Booking.com", payload)
		r2 = ingest_payload("Booking.com", payload)
		self.assertEqual(r1["data"]["batch"], r2["data"]["batch"])
		self.assertTrue(r2["data"]["reused"])
		self.assertEqual(frappe.db.count("OTA Ingest Batch"), 1)

	def test_ingest_different_payload_same_external_id_dedupes_row(self):
		"""Row-level idempotency: two different files carrying the same
		(source, external_id) — the second row is skipped, batch.duplicate_count++"""
		ingest_payload("Booking.com", _bookingcom_csv("BDC-300", "Rita"))
		# Same external_id, different guest (so payload hash differs).
		second = ingest_payload("Booking.com", _bookingcom_csv("BDC-300", "Rita Menon"))
		self.assertEqual(second["data"]["success_count"], 0)
		self.assertEqual(second["data"]["duplicate_count"], 1)

	def test_ingest_bad_csv_produces_dead_letter(self):
		"""A row missing the external_id column goes to Dead-letter, not silent drop."""
		payload = (
			"Guest name,Check-in,Check-out\n"
			"NoExternalId,2026-08-01,2026-08-03\n"
		)
		result = ingest_payload("Booking.com", payload)
		self.assertEqual(result["data"]["success_count"], 0)
		self.assertEqual(result["data"]["dead_letter_count"], 1)

	def test_ingest_json_payload(self):
		payload = json.dumps(
			[
				{
					"external_id": "MAN-1",
					"parsed_guest_name": "JSON Guest",
					"parsed_arrival": str(add_days(today(), 5)),
					"parsed_departure": str(add_days(today(), 7)),
					"parsed_room_type_code": "SAV",
					"parsed_total": 30000,
				}
			]
		)
		result = ingest_payload("Manual", payload)
		self.assertEqual(result["data"]["success_count"], 1)

	# ------------------------------------------------------------------
	# Convert
	# ------------------------------------------------------------------

	def _seat_a_new_message(self, ext_id: str = "BDC-C1", room_code: str = "SAV") -> str:
		# Use a real Room Type code from seeded property so convert can resolve.
		rt = frappe.db.get_value("Room Type", {}, ["name", "room_type_code"], as_dict=True)
		room_code_final = rt.room_type_code if rt else room_code
		ingest_payload(
			"Booking.com",
			(
				"Reservation number,Guest name,Guest email,Check-in,Check-out,Adults,Room,Rate plan,Total price\n"
				f"{ext_id},Convert Test,convert.{ext_id.lower()}@example.com,"
				f"{add_days(today(), 5)},{add_days(today(), 7)},2,{room_code_final},BAR,30000\n"
			),
		)
		return frappe.db.get_value("OTA Reservation Message", {"external_id": ext_id}, "name")

	def test_convert_creates_reservation_with_ota_source(self):
		name = self._seat_a_new_message("BDC-CONVERT-1")
		result = convert_to_reservation(name, resort_property=self.resort_property)
		res_name = result["data"]["reservation"]
		self.assertIsNotNone(res_name)
		res = frappe.get_doc("Reservation", res_name)
		self.assertEqual(res.booking_source, "OTA")
		self.assertEqual(res.source_reference, "BDC-CONVERT-1")
		msg = frappe.get_doc("OTA Reservation Message", name)
		self.assertEqual(msg.state, "Converted")
		self.assertEqual(msg.converted_reservation, res_name)

	def test_convert_refuses_when_external_id_already_used(self):
		"""Prevents double-inserting the same OTA reservation as a native one."""
		name = self._seat_a_new_message("BDC-DUPE")
		convert_to_reservation(name, resort_property=self.resort_property)
		# Second message with same external_id shouldn't exist due to row-dedupe,
		# but a fresh-seat with the same id via a different code path would collide.
		# Simulate: another OTA message with the same external_id (different source).
		frappe.get_doc(
			{
				"doctype": "OTA Reservation Message",
				"source": "Expedia",
				"external_id": "BDC-DUPE",
				"state": "New",
				"parsed_guest_name": "Dupe",
				"parsed_arrival": add_days(today(), 5),
				"parsed_departure": add_days(today(), 7),
				"parsed_room_type_code": frappe.db.get_value("Room Type", {}, "room_type_code"),
			}
		).insert(ignore_permissions=True)
		second_name = frappe.db.get_value(
			"OTA Reservation Message", {"source": "Expedia", "external_id": "BDC-DUPE"}, "name"
		)
		with self.assertRaises(frappe.ValidationError):
			convert_to_reservation(second_name, resort_property=self.resort_property)

	def test_convert_refuses_on_invalid_dates(self):
		name = self._seat_a_new_message("BDC-BAD-DATES")
		# Force departure <= arrival.
		frappe.db.set_value("OTA Reservation Message", name, "parsed_departure", frappe.db.get_value("OTA Reservation Message", name, "parsed_arrival"))
		with self.assertRaises(frappe.ValidationError):
			convert_to_reservation(name, resort_property=self.resort_property)

	def test_convert_refuses_on_unresolvable_room_type(self):
		name = self._seat_a_new_message("BDC-BAD-ROOM")
		frappe.db.set_value("OTA Reservation Message", name, "parsed_room_type_code", "NOT-A-REAL-CODE-12345")
		with self.assertRaises(frappe.ValidationError):
			convert_to_reservation(name, resort_property=self.resort_property)

	# ------------------------------------------------------------------
	# Reject
	# ------------------------------------------------------------------

	def test_reject_stores_reason_and_transitions(self):
		name = self._seat_a_new_message("BDC-REJ")
		result = reject_message(name, reason="Guest also booked direct")
		self.assertEqual(result["data"]["message"]["state"], "Rejected")
		self.assertEqual(result["data"]["message"]["rejection_reason"], "Guest also booked direct")

	def test_reject_requires_reason(self):
		name = self._seat_a_new_message("BDC-REJ2")
		with self.assertRaises(frappe.ValidationError):
			reject_message(name, reason="")

	def test_reject_refuses_already_processed(self):
		name = self._seat_a_new_message("BDC-REJ3")
		reject_message(name, reason="first reject")
		with self.assertRaises(frappe.ValidationError):
			reject_message(name, reason="second reject")

	# ------------------------------------------------------------------
	# Reads + similar hints
	# ------------------------------------------------------------------

	def test_list_inbox_filters_by_state_and_source(self):
		self._seat_a_new_message("BDC-L1")
		self._seat_a_new_message("BDC-L2")
		new_only = list_inbox(state="New")["data"]
		self.assertEqual(len(new_only["messages"]), 2)
		bcom_only = list_inbox(source="Booking.com")["data"]
		self.assertEqual(len(bcom_only["messages"]), 2)

	def test_get_message_surfaces_similar_hints_on_external_id_match(self):
		name = self._seat_a_new_message("BDC-HINT")
		# Mint a Hold Reservation with the same external_id — Hold doesn't need
		# a guest child row and the hint check filters by source_reference alone.
		room_type = frappe.db.get_value("Room Type", {}, "name")
		frappe.get_doc(
			{
				"doctype": "Reservation",
				"resort_property": self.resort_property,
				"status": "Hold",
				"booking_source": "Direct",
				"source_reference": "BDC-HINT",
				"arrival_date": add_days(today(), 5),
				"departure_date": add_days(today(), 7),
				"rooms": [{"room_type": room_type, "adults": 2, "status": "Held"}],
			}
		).insert(ignore_permissions=True)
		result = get_message(name)["data"]
		matches = [h["match"] for h in result["similar_reservations"]]
		self.assertIn("external_id", matches)

	# ------------------------------------------------------------------
	# Dead-letter retry
	# ------------------------------------------------------------------

	def test_retry_dead_letter_recovers_reparseable_rows(self):
		"""A Dead-letter row whose raw_payload NOW parses cleanly gets reset to New."""
		frappe.get_doc(
			{
				"doctype": "OTA Reservation Message",
				"source": "Booking.com",
				"external_id": "BDC-DEAD-1",
				"state": "Dead-letter",
				"dead_letter_error": "Simulated failure",
				"raw_payload": json.dumps(
					{
						"Reservation number": "BDC-DEAD-1",
						"Guest name": "Retry Test",
						"Check-in": str(add_days(today(), 5)),
						"Check-out": str(add_days(today(), 7)),
					}
				),
			}
		).insert(ignore_permissions=True)
		reset = retry_dead_letter()
		self.assertGreaterEqual(reset, 1)
		# Look up by external_id, not name — RZ-OTA-... is the actual doc name.
		state = frappe.db.get_value(
			"OTA Reservation Message",
			{"external_id": "BDC-DEAD-1"},
			"state",
		)
		self.assertEqual(state, "New")
