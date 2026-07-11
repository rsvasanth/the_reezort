"""Preventive Maintenance Plan and Task API — spec 009.

Whitelisted endpoints:
  create_preventive_plan(payload)
  generate_preventive_tasks(property, through_date)
  list_preventive_plans(property)
  list_preventive_tasks(property, filters)

Scheduler entry point:
  run_daily_preventive_generation()
"""

from __future__ import annotations

from datetime import date, timedelta

import frappe
from frappe import _
from frappe.utils import getdate, now_datetime, today

from the_reezort.utils import as_dict, as_list, envelope as _envelope, require_permission as _require_permission

# ---------------------------------------------------------------------------
# Recurrence helpers
# ---------------------------------------------------------------------------

_RECURRENCE_DELTAS: dict[str, dict] = {
    "Daily": {"days": 1},
    "Weekly": {"weeks": 1},
    "Monthly": {"months": 1},
    "Quarterly": {"months": 3},
    "Annual": {"years": 1},
}


def _advance_date(current: date, recurrence_type: str) -> date:
    """Return the next due date for a plan given its recurrence type.

    Runtime Based, Seasonal, and Manual plans are not advanced automatically —
    their next_due_date is left unchanged so a human or integration can update
    it explicitly.
    """
    delta = _RECURRENCE_DELTAS.get(recurrence_type)
    if delta is None:
        # Runtime Based / Seasonal / Manual — do not auto-advance
        return current

    days = delta.get("days", 0)
    weeks = delta.get("weeks", 0)
    months = delta.get("months", 0)
    years = delta.get("years", 0)

    result = current
    if days or weeks:
        result = result + timedelta(days=days + weeks * 7)
    if months or years:
        total_months = result.month + months + years * 12
        year_offset = (total_months - 1) // 12
        new_month = (total_months - 1) % 12 + 1
        new_year = result.year + year_offset
        # Clamp day to last day of the target month
        import calendar
        max_day = calendar.monthrange(new_year, new_month)[1]
        result = date(new_year, new_month, min(result.day, max_day))

    return result


# ---------------------------------------------------------------------------
# Public whitelisted endpoints
# ---------------------------------------------------------------------------


@frappe.whitelist()
def create_preventive_plan(payload: dict | str) -> dict:
    """Create a Preventive Maintenance Plan.

    Required fields: plan_name, property, plan_scope, recurrence_type, next_due_date.
    """
    _require_permission("Preventive Maintenance Plan", "create")

    data = as_dict(payload)

    required = ["plan_name", "property", "plan_scope", "recurrence_type", "next_due_date"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        frappe.throw(_("Missing required fields: {0}").format(", ".join(missing)))

    doc = frappe.new_doc("Preventive Maintenance Plan")
    doc.update(
        {
            "plan_name": data["plan_name"],
            "property": data["property"],
            "plan_scope": data["plan_scope"],
            "recurrence_type": data["recurrence_type"],
            "next_due_date": getdate(data["next_due_date"]),
            "active": data.get("active", 1),
            "room": data.get("room"),
            "room_type": data.get("room_type"),
            "erpnext_asset": data.get("erpnext_asset"),
            "asset_category": data.get("asset_category"),
            "checklist_template": data.get("checklist_template"),
            "expected_minutes": data.get("expected_minutes"),
            "responsible_team": data.get("responsible_team"),
        }
    )
    doc.insert(ignore_permissions=False)
    frappe.db.commit()

    return _envelope({"plan": doc.name})


@frappe.whitelist()
def generate_preventive_tasks(property: str, through_date: str) -> dict:
    """Generate Preventive Maintenance Tasks for all active plans in a property.

    Idempotent: will not create a second task for the same plan + due_date pair.
    For each generated task, optionally auto-creates a Maintenance Ticket of
    type "Preventive Maintenance" and links it to the task.
    Advances the plan's next_due_date by its recurrence after generation.

    Args:
        property: Resort Property name.
        through_date: ISO date string. Plans with next_due_date <= this date are processed.
    """
    _require_permission("Preventive Maintenance Plan", "read")

    through = getdate(through_date)
    now = now_datetime()

    plans = frappe.get_all(
        "Preventive Maintenance Plan",
        filters={"property": property, "active": 1, "next_due_date": ["<=", through]},
        fields=["name", "plan_name", "recurrence_type", "next_due_date",
                "room", "room_type", "erpnext_asset", "responsible_team",
                "expected_minutes", "checklist_template", "plan_scope"],
    )

    generated = []
    skipped = []

    for plan in plans:
        due = getdate(plan["next_due_date"])

        # Idempotency: check whether a task already exists for this plan + due_date
        existing = frappe.db.exists(
            "Preventive Maintenance Task",
            {"preventive_plan": plan["name"], "due_date": due},
        )
        if existing:
            skipped.append({"plan": plan["name"], "due_date": str(due), "existing_task": existing})
            continue

        # Create Maintenance Ticket first so the task can link to it
        ticket_name = _create_pm_ticket(plan, due, property)

        task_doc = frappe.new_doc("Preventive Maintenance Task")
        task_doc.update(
            {
                "preventive_plan": plan["name"],
                "due_date": due,
                "task_status": "Generated",
                "generated_at": now,
                "maintenance_ticket": ticket_name,
            }
        )
        task_doc.insert(ignore_permissions=True)

        # Advance plan's next_due_date
        new_due = _advance_date(due, plan["recurrence_type"])
        frappe.db.set_value(
            "Preventive Maintenance Plan",
            plan["name"],
            "next_due_date",
            new_due,
            update_modified=True,
        )

        generated.append(
            {
                "plan": plan["name"],
                "task": task_doc.name,
                "ticket": ticket_name,
                "due_date": str(due),
                "next_due_date": str(new_due),
            }
        )

    frappe.db.commit()

    return _envelope(
        {
            "generated": generated,
            "skipped": skipped,
            "generated_count": len(generated),
            "skipped_count": len(skipped),
        }
    )


@frappe.whitelist()
def list_preventive_plans(property: str) -> dict:
    """Return all Preventive Maintenance Plans for a property (active and inactive)."""
    _require_permission("Preventive Maintenance Plan", "read")

    plans = frappe.get_all(
        "Preventive Maintenance Plan",
        filters={"property": property},
        fields=[
            "name", "plan_name", "plan_scope", "recurrence_type",
            "next_due_date", "active", "responsible_team",
            "room", "room_type", "erpnext_asset", "asset_category",
        ],
        order_by="next_due_date asc",
    )

    return _envelope({"plans": plans, "total": len(plans)})


@frappe.whitelist()
def list_preventive_tasks(property: str, filters: dict | str | None = None) -> dict:
    """Return Preventive Maintenance Tasks for a property.

    Optional filters dict supports: plan, task_status, due_date_from, due_date_to.
    """
    _require_permission("Preventive Maintenance Task", "read")

    f = as_dict(filters) if filters else {}

    # Build filter list for frappe.get_all
    db_filters: list = []

    # Join via Preventive Maintenance Plan to filter by property
    # We fetch plan names for the property first, then filter tasks.
    plan_names = frappe.get_all(
        "Preventive Maintenance Plan",
        filters={"property": property},
        pluck="name",
    )
    if not plan_names:
        return _envelope({"tasks": [], "total": 0})

    db_filters.append(["preventive_plan", "in", plan_names])

    if f.get("plan"):
        db_filters.append(["preventive_plan", "=", f["plan"]])
    if f.get("task_status"):
        db_filters.append(["task_status", "=", f["task_status"]])
    if f.get("due_date_from"):
        db_filters.append(["due_date", ">=", getdate(f["due_date_from"])])
    if f.get("due_date_to"):
        db_filters.append(["due_date", "<=", getdate(f["due_date_to"])])

    tasks = frappe.get_all(
        "Preventive Maintenance Task",
        filters=db_filters,
        fields=[
            "name", "preventive_plan", "maintenance_ticket",
            "due_date", "task_status", "generated_at", "completed_at",
        ],
        order_by="due_date asc",
    )

    return _envelope({"tasks": tasks, "total": len(tasks)})


# ---------------------------------------------------------------------------
# Scheduler entry point
# ---------------------------------------------------------------------------


def run_daily_preventive_generation() -> None:
    """Scheduler wrapper: generate tasks for every active property through today.

    Called by hooks.py scheduler_events["daily"].
    Errors per property are caught and logged so one bad property does not
    abort processing for others.
    """
    through = today()

    properties = frappe.get_all(
        "Resort Property",
        filters={"disabled": 0},
        pluck="name",
    )

    for prop in properties:
        try:
            generate_preventive_tasks(property=prop, through_date=through)
        except Exception:
            frappe.log_error(
                title=f"PM generation failed for property {prop}",
                message=frappe.get_traceback(),
            )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _create_pm_ticket(plan: dict, due_date: date, property: str) -> str | None:
    """Create a Maintenance Ticket for a PM task and return its name.

    Returns None if ticket creation fails (non-fatal for task generation).
    """
    try:
        # Determine location_type from plan_scope
        scope_to_location = {
            "Room": "Room",
            "Room Type": "Room",
            "Asset": "Asset",
            "Asset Category": "Asset",
            "Building": "Public Area",
            "Floor": "Public Area",
            "Outlet": "Outlet",
            "Facility": "Facility",
            "Vehicle": "Other",
            "Utility": "Utility",
        }
        location_type = scope_to_location.get(plan.get("plan_scope", ""), "Other")

        ticket = frappe.new_doc("Maintenance Ticket")
        ticket.update(
            {
                "resort_property": property,
                "subject": f"PM: {plan['plan_name']} — {due_date}",
                "category": "Other",
                "priority": "Normal",
                "state": "Reported",
                "room": plan.get("room"),
                "reported_at": now_datetime(),
                "raised_by": frappe.session.user,
                "description": (
                    f"Auto-generated preventive maintenance task.\n"
                    f"Plan: {plan['name']} ({plan['plan_name']})\n"
                    f"Due: {due_date}"
                ),
                "source_doctype": "Preventive Maintenance Plan",
                "source_name": plan["name"],
            }
        )
        ticket.insert(ignore_permissions=True)
        return ticket.name
    except Exception:
        frappe.log_error(
            title=f"PM ticket creation failed for plan {plan.get('name')}",
            message=frappe.get_traceback(),
        )
        return None
