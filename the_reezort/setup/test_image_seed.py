"""Tests for the villa render seeder's room-type resolution.

Regression context: `_resolve_room_type` only knew the historical record names
("Signature Arch Villa" / "SAV") and a `%Arch%` name match, but
`property.api._seed_room_types` creates the villa as RZ-DEMO-VIL with
room_type_name "Beachfront Villa". On any freshly seeded site the seeder threw
and the villa renders — which ship in the repo — never attached.

Runs as Administrator inside FrappeTestCase's rolled-back transaction.
`seed_villa_renders` commits internally, so the integration test patches
`frappe.db.commit` to keep isolation. It still writes the image files to the
site's public files directory; uploads are content-hash deduped, so repeated
runs reuse them.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.property.api import seed_demo_property
from the_reezort.setup import image_seed


class TestVillaRenderRoomTypeResolution(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = frappe.db.get_value("Company", {}, "name")

	def setUp(self):
		self.assertTrue(self.company, "test site has no Company to attach a property to")
		# The realistic fixture: exactly what a fresh site gets from the demo seed.
		seed_demo_property(company=self.company)

	def _is_villa(self, room_type: str) -> bool:
		code = frappe.db.get_value("Room Type", room_type, "room_type_code")
		return code == image_seed.ROOM_TYPE_CODE or room_type in image_seed.ROOM_TYPE_NAME_CANDIDATES

	def test_resolves_room_type_produced_by_demo_property_seeder(self):
		"""The regression: resolution must succeed against seed_demo_property output."""
		resolved = image_seed._resolve_room_type()

		self.assertIsNotNone(resolved, "villa room type did not resolve after seed_demo_property")
		self.assertTrue(
			self._is_villa(resolved),
			f"resolved {resolved!r} is not the villa room type "
			f"(code={frappe.db.get_value('Room Type', resolved, 'room_type_code')!r})",
		)

	def test_resolves_by_room_type_code_when_historical_names_absent(self):
		for candidate in image_seed.ROOM_TYPE_NAME_CANDIDATES:
			if frappe.db.exists("Room Type", candidate):
				self.skipTest(f"site carries the historical room type {candidate!r}")

		resolved = image_seed._resolve_room_type()

		self.assertEqual(
			frappe.db.get_value("Room Type", resolved, "room_type_code"),
			image_seed.ROOM_TYPE_CODE,
		)

	def test_explicit_room_type_wins_over_resolution(self):
		other = frappe.db.get_value(
			"Room Type", {"room_type_code": ("!=", image_seed.ROOM_TYPE_CODE)}, "name"
		)
		self.assertTrue(other, "demo property should seed more than one room type")

		self.assertEqual(image_seed._resolve_room_type(other), other)

	def test_explicit_room_type_that_does_not_exist_resolves_to_none(self):
		self.assertIsNone(image_seed._resolve_room_type("ZZ Nonexistent Room Type"))

	def test_seed_villa_renders_succeeds_after_demo_property(self):
		if not image_seed.SEED_DIR.exists() or not any(image_seed.SEED_DIR.iterdir()):
			self.skipTest(f"no render files in {image_seed.SEED_DIR}")

		with patch.object(frappe.db, "commit"):
			result = image_seed.seed_villa_renders()

		self.assertTrue(result.get("ok"), f"seeder did not succeed: {result}")
		self.assertTrue(self._is_villa(result["room_type"]))
		self.assertTrue(result["rooms_updated"], "no rooms received the renders")
		self.assertTrue(result["hero_url"], "no hero image was set on the room type")
