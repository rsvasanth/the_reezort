"""Idempotent seeder: ensures a default Resort Loyalty Program exists.

Call seed_default_loyalty_program() before any enroll that needs a
fallback program. Safe to call multiple times — creates only once.
"""

import frappe

DEFAULT_PROGRAM_NAME = "REEZORT Rewards"


def seed_default_loyalty_program():
    """Create the default loyalty program if it does not already exist.

    Returns the program_name (= its document name since autoname=field:program_name).
    """
    if frappe.db.exists("Resort Loyalty Program", DEFAULT_PROGRAM_NAME):
        return DEFAULT_PROGRAM_NAME

    doc = frappe.get_doc(
        {
            "doctype": "Resort Loyalty Program",
            "program_name": DEFAULT_PROGRAM_NAME,
            "status": "Active",
            "accrual_basis": "Spend",
            "redemption_basis": "Points",
            "requires_approval_for_adjustment": 0,
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return DEFAULT_PROGRAM_NAME
