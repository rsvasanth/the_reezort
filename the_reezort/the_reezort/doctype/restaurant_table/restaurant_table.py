import frappe
from frappe.model.document import Document


class RestaurantTable(Document):
	def autoname(self):
		outlet_code = frappe.db.get_value("FnB Outlet", self.outlet, "outlet_code") or "OUT"
		self.table_full_code = f"{outlet_code}-{self.table_code}"
		self.name = self.table_full_code
