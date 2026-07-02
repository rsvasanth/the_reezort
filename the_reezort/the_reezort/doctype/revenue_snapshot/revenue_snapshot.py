from frappe.model.document import Document
from frappe.utils import flt


class RevenueSnapshot(Document):
	def before_save(self):
		self.total_revenue = flt(self.room_revenue) + flt(self.other_revenue)
		self.adr = (
			flt(self.room_revenue) / self.occupied_rooms
			if self.occupied_rooms
			else 0
		)
		self.revpar = (
			flt(self.room_revenue) / self.sellable_rooms
			if self.sellable_rooms
			else 0
		)
