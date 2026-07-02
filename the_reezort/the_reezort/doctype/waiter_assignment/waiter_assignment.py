import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_datetime


class WaiterAssignment(Document):
	def validate(self):
		if get_datetime(self.shift_end) <= get_datetime(self.shift_start):
			frappe.throw(_("Shift end must be after shift start."))
		# Auto-derive Employee from User link — used for shift reports.
		if self.waiter_user and not self.waiter_employee:
			emp = frappe.db.get_value("Employee", {"user_id": self.waiter_user}, "name")
			if emp:
				self.waiter_employee = emp
		# Refuse overlapping active shifts on the same table.
		if self.status == "Active":
			overlap = frappe.db.sql(
				"""
				SELECT name FROM `tabWaiter Assignment`
				WHERE restaurant_table = %s
				  AND status = 'Active'
				  AND name != %s
				  AND shift_start < %s
				  AND shift_end > %s
				""",
				(self.restaurant_table, self.name or "", self.shift_end, self.shift_start),
			)
			if overlap:
				frappe.throw(
					_("Table {0} already has an active waiter shift overlapping {1}–{2}.").format(
						self.restaurant_table, self.shift_start, self.shift_end
					)
				)
