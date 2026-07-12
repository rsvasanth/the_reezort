"""CRM Loyalty endpoints for The Reezort.

Callable as:
  the_reezort.crm.loyalty.enroll_loyalty_member
  the_reezort.crm.loyalty.post_loyalty_transaction
  the_reezort.crm.loyalty.list_loyalty_transactions
  the_reezort.crm.loyalty.get_membership
"""

import uuid

import frappe
from frappe import _

from the_reezort.utils import as_dict, envelope as _envelope, require_permission as _require_permission
from the_reezort.crm.seed_loyalty import seed_default_loyalty_program, DEFAULT_PROGRAM_NAME


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _generate_membership_number():
    """Generate a short unique membership number prefixed RZL-."""
    short = uuid.uuid4().hex[:8].upper()
    return f"RZL-{short}"


def _recompute_points_balance(membership_name):
    """Sum all Posted transaction points for a membership and persist."""
    total = (
        frappe.db.sql(
            """
            SELECT COALESCE(SUM(points), 0)
            FROM `tabLoyalty Transaction`
            WHERE loyalty_membership = %s AND status = 'Posted'
            """,
            (membership_name,),
        )[0][0]
        or 0.0
    )
    frappe.db.set_value("Loyalty Membership", membership_name, "points_balance", total)
    frappe.db.commit()
    return float(total)


# ---------------------------------------------------------------------------
# Whitelisted endpoints
# ---------------------------------------------------------------------------


@frappe.whitelist()
def enroll_loyalty_member(payload=None):
    """Enroll a guest profile in a loyalty program.

    If loyalty_program is omitted or blank the default seeded program is used.

    Request payload fields:
        guest_profile  (str, required)
        loyalty_program (str, optional — defaults to REEZORT Rewards)

    Returns envelope with loyalty_membership name and status.
    """
    _require_permission("Loyalty Membership", "create")

    data = as_dict(payload)
    guest_profile = data.get("guest_profile")
    if not guest_profile:
        frappe.throw(_("guest_profile is required."), frappe.ValidationError)

    if not frappe.db.exists("Guest Profile", guest_profile):
        frappe.throw(_("Guest Profile {0} not found.").format(guest_profile), frappe.DoesNotExistError)

    # Resolve program — seed default when none provided
    loyalty_program = data.get("loyalty_program") or None
    if not loyalty_program:
        loyalty_program = seed_default_loyalty_program()
    else:
        if not frappe.db.exists("Resort Loyalty Program", loyalty_program):
            frappe.throw(
                _("Resort Loyalty Program {0} not found.").format(loyalty_program),
                frappe.DoesNotExistError,
            )
        prog_status = frappe.db.get_value("Resort Loyalty Program", loyalty_program, "status")
        if prog_status != "Active":
            frappe.throw(
                _("Loyalty Program {0} is not Active (status: {1}).").format(loyalty_program, prog_status),
                frappe.ValidationError,
            )

    # Block duplicate active memberships for the same guest + program
    existing = frappe.db.get_value(
        "Loyalty Membership",
        {"guest_profile": guest_profile, "loyalty_program": loyalty_program, "status": "Active"},
        "name",
    )
    if existing:
        frappe.throw(
            _("Guest {0} already has an Active membership in program {1}: {2}.").format(
                guest_profile, loyalty_program, existing
            ),
            frappe.ValidationError,
        )

    membership_number = _generate_membership_number()
    # Ensure uniqueness (extremely unlikely collision, but guard it)
    while frappe.db.exists("Loyalty Membership", {"membership_number": membership_number}):
        membership_number = _generate_membership_number()

    doc = frappe.get_doc(
        {
            "doctype": "Loyalty Membership",
            "guest_profile": guest_profile,
            "loyalty_program": loyalty_program,
            "membership_number": membership_number,
            "status": "Active",
            "points_balance": 0.0,
            "value_balance": 0.0,
            "joined_on": frappe.utils.today(),
        }
    )
    doc.insert(ignore_permissions=False)
    frappe.db.commit()

    return _envelope(
        {
            "loyalty_membership": doc.name,
            "membership_number": doc.membership_number,
            "status": doc.status,
        }
    )


@frappe.whitelist()
def post_loyalty_transaction(payload=None):
    """Post a loyalty transaction (Accrual, Redemption, Adjustment, Expiry, Reversal).

    Rules:
    - Accrual / Redemption / Expiry / Reversal: posted directly as "Posted",
      balance recomputed immediately.
    - Redemption: blocked if points would go negative (409 equivalent).
    - Adjustment: MUST include a reason. If the program has
      requires_approval_for_adjustment=1, status is set to "Draft" (not Posted),
      balance is NOT updated until approved elsewhere.
    - NEVER creates ERPNext Sales Invoices or GL entries.

    Request payload fields:
        loyalty_membership  (str, required)
        transaction_type    (str, required)
        points              (float, required for Accrual/Redemption/Expiry/Reversal)
        value_amount        (float, optional)
        source_doctype      (str, optional)
        source_name         (str, optional)
        guest_folio         (str, optional)
        erpnext_sales_invoice (str, optional — stored as reference only, NOT posted)
        reason              (str, required for Adjustment)

    Returns envelope with loyalty_transaction name, status, points_balance.
    """
    _require_permission("Loyalty Transaction", "create")

    data = as_dict(payload)

    membership_name = data.get("loyalty_membership")
    if not membership_name:
        frappe.throw(_("loyalty_membership is required."), frappe.ValidationError)

    if not frappe.db.exists("Loyalty Membership", membership_name):
        frappe.throw(
            _("Loyalty Membership {0} not found.").format(membership_name), frappe.DoesNotExistError
        )

    transaction_type = data.get("transaction_type")
    valid_types = {"Accrual", "Redemption", "Adjustment", "Expiry", "Reversal"}
    if transaction_type not in valid_types:
        frappe.throw(
            _("transaction_type must be one of: {0}.").format(", ".join(sorted(valid_types))),
            frappe.ValidationError,
        )

    points = float(data.get("points") or 0)
    reason = data.get("reason") or ""

    # Adjustment requires a reason
    if transaction_type == "Adjustment" and not reason.strip():
        frappe.throw(_("reason is required for Adjustment transactions."), frappe.ValidationError)

    # Determine whether this needs approval gating
    program_name = frappe.db.get_value("Loyalty Membership", membership_name, "loyalty_program")
    requires_approval = frappe.db.get_value(
        "Resort Loyalty Program", program_name, "requires_approval_for_adjustment"
    )

    is_gated_adjustment = transaction_type == "Adjustment" and requires_approval

    # For Redemption: check sufficient balance BEFORE creating the record
    if transaction_type == "Redemption":
        current_balance = (
            frappe.db.get_value("Loyalty Membership", membership_name, "points_balance") or 0.0
        )
        if points > current_balance:
            frappe.throw(
                _(
                    "Insufficient loyalty balance. Available: {0}, Requested: {1}."
                ).format(current_balance, points),
                frappe.ValidationError,
            )

    # Determine initial status
    if is_gated_adjustment:
        initial_status = "Draft"
    else:
        initial_status = "Posted"

    # Redemption / Expiry points are stored as negative internally
    stored_points = points
    if transaction_type in ("Redemption", "Expiry"):
        stored_points = -abs(points)
    elif transaction_type == "Accrual":
        stored_points = abs(points)
    # Adjustment and Reversal: take sign as provided

    doc = frappe.get_doc(
        {
            "doctype": "Loyalty Transaction",
            "loyalty_membership": membership_name,
            "transaction_type": transaction_type,
            "status": initial_status,
            "points": stored_points,
            "value_amount": float(data.get("value_amount") or 0),
            "source_doctype": data.get("source_doctype") or "",
            "source_name": data.get("source_name") or "",
            "guest_folio": data.get("guest_folio") or None,
            "erpnext_sales_invoice": data.get("erpnext_sales_invoice") or None,
            "reason": reason,
        }
    )
    doc.insert(ignore_permissions=False)
    frappe.db.commit()

    # Recompute balance only when the transaction is immediately Posted
    if initial_status == "Posted":
        new_balance = _recompute_points_balance(membership_name)
    else:
        new_balance = float(
            frappe.db.get_value("Loyalty Membership", membership_name, "points_balance") or 0.0
        )

    return _envelope(
        {
            "loyalty_transaction": doc.name,
            "status": doc.status,
            "points_balance": new_balance,
        }
    )


@frappe.whitelist()
def list_loyalty_transactions(membership=None):
    """Return all transactions for a loyalty membership.

    Request args:
        membership  (str, required) — Loyalty Membership name

    Returns envelope with list of transaction dicts.
    """
    _require_permission("Loyalty Transaction", "read")

    if not membership:
        frappe.throw(_("membership is required."), frappe.ValidationError)

    if not frappe.db.exists("Loyalty Membership", membership):
        frappe.throw(
            _("Loyalty Membership {0} not found.").format(membership), frappe.DoesNotExistError
        )

    rows = frappe.get_all(
        "Loyalty Transaction",
        filters={"loyalty_membership": membership},
        fields=[
            "name",
            "transaction_type",
            "status",
            "points",
            "value_amount",
            "source_doctype",
            "source_name",
            "guest_folio",
            "reason",
            "creation",
        ],
        order_by="creation desc",
    )

    return _envelope({"transactions": rows, "total": len(rows)})


@frappe.whitelist()
def get_membership(guest_profile=None):
    """Return the active loyalty membership for a guest profile.

    Request args:
        guest_profile  (str, required) — Guest Profile name

    Returns envelope with membership details or null when none found.
    """
    _require_permission("Loyalty Membership", "read")

    if not guest_profile:
        frappe.throw(_("guest_profile is required."), frappe.ValidationError)

    membership = frappe.db.get_value(
        "Loyalty Membership",
        {"guest_profile": guest_profile, "status": "Active"},
        [
            "name",
            "membership_number",
            "loyalty_program",
            "status",
            "tier",
            "points_balance",
            "value_balance",
            "joined_on",
            "expires_on",
        ],
        as_dict=True,
    )

    return _envelope({"membership": membership})
