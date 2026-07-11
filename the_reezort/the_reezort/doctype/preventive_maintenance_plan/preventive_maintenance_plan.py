# Copyright (c) 2026, Alphaworkz and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe.model.document import Document


class PreventiveMaintenancePlan(Document):
    def validate(self):
        self._validate_scope_fields()

    def _validate_scope_fields(self):
        scope_field_map = {
            "Room": "room",
            "Room Type": "room_type",
            "Asset": "erpnext_asset",
            "Asset Category": "asset_category",
        }
        required_field = scope_field_map.get(self.plan_scope)
        if required_field and not self.get(required_field):
            frappe.throw(
                frappe._(
                    "Field '{0}' is required when Plan Scope is '{1}'."
                ).format(required_field.replace("_", " ").title(), self.plan_scope)
            )
