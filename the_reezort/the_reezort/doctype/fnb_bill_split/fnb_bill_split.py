import frappe
from frappe.model.document import Document
from frappe.utils import flt


class FnBBillSplit(Document):
	def validate(self):
		# Item amounts are always rate × qty; totals are set by the split planner
		# service (fnb.split), which apportions service charge + tax across splits.
		for row in self.split_items or []:
			row.amount = flt(row.qty) * flt(row.rate)
