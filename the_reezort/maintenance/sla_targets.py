"""SLA policy for the Maintenance ticketing slice — spec 009.

Priority × Category matrix of resolution SLA in minutes. Everything is
tunable per-property via `sla_overrides` in Resort Property Settings later
(deferred to a follow-up slice); this table is the default.

Guest-facing categories (HVAC, Plumbing, Electrical) get tighter SLAs than
back-of-house categories (Landscape, IT). Urgency dominates category — an
Urgent HVAC and an Urgent IT both go the same speed, because a Down device
in a suite is just as guest-visible as a broken AC.
"""

from __future__ import annotations

# (priority, category) → minutes
BASE_MINUTES: dict[str, int] = {
	"Urgent": 30,
	"High": 120,
	"Normal": 480,
	"Low": 1440,
}

CATEGORY_MULTIPLIER: dict[str, float] = {
	"HVAC": 1.0,
	"Plumbing": 1.0,
	"Electrical": 0.8,        # electrical faults get the tightest window
	"Structural": 1.5,        # structural is rarely urgent, longer to source
	"IT": 1.0,
	"Housekeeping Equipment": 1.2,
	"Landscape": 3.0,         # not guest-facing
	"Other": 1.5,
}


def sla_minutes(priority: str, category: str) -> int:
	base = BASE_MINUTES.get(priority, BASE_MINUTES["Normal"])
	mult = CATEGORY_MULTIPLIER.get(category, 1.0)
	return int(round(base * mult))
