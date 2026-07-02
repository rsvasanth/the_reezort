from frappe.model.document import Document
from frappe.utils import flt


class LinenMovement(Document):
	def validate(self):
		short = 0
		damaged = 0
		missing = 0
		value = 0.0
		for row in self.items or []:
			par = int(row.par or 0)
			found = int(row.found or 0)
			d = int(row.damaged or 0)
			m = int(row.missing or 0)
			damaged += d
			missing += m
			if par and found < par:
				short += (par - found)
			unit_cost = flt(row.get("unit_cost")) or flt(
				(row.linen_item and __import__("frappe").db.get_value("Linen Item", row.linen_item, "unit_cost"))
				or 0
			)
			value += (d + m) * unit_cost
		self.short_count = short
		self.damaged_count = damaged
		self.missing_count = missing
		self.damage_value = round(value, 2)
