import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.the_reezort.doctype.room.test_room import insert_doc


class TestServiceLocation(FrappeTestCase):
	def test_revenue_location_requires_billing_path(self):
		property_doc = insert_doc(
			"Resort Property",
			property_name="Test Resort Service",
			property_code="TST-SVC",
			company="Test Company Service",
			timezone="Asia/Kolkata",
		)

		with self.assertRaises(frappe.ValidationError):
			insert_doc(
				"Service Location",
				resort_property=property_doc.name,
				location_name="All Day Dining",
				location_code="ADD",
				location_type="Restaurant",
				can_bill_direct=0,
				can_post_to_folio=0,
			)

	def test_revenue_location_allows_direct_billing(self):
		property_doc = insert_doc(
			"Resort Property",
			property_name="Test Resort Direct Bill",
			property_code="TST-DIRECT",
			company="Test Company Direct",
			timezone="Asia/Kolkata",
		)

		location = insert_doc(
			"Service Location",
			resort_property=property_doc.name,
			location_name="Pool Bar",
			location_code="POOLBAR",
			location_type="Bar",
			can_bill_direct=1,
			can_post_to_folio=0,
		)

		self.assertEqual(location.can_bill_direct, 1)
