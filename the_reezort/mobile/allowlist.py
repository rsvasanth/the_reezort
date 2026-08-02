"""The server-side action allowlist for `sync_push`.

Every offline-originated write names an action. That name is a **key into this
static map**, never a dotted path resolved from client input — a mobile client
must not be able to reach an arbitrary function on the bench.

Reconciled against the shipped 005/009 services on 2026-08-02. Earlier drafts of
the contract used `housekeeping.set_room_status`; no such service exists, and
room housekeeping status is deliberately not directly settable. It moves as a
side effect of the task lifecycle, so the client queues *task* transitions and
the room follows. That is also why the conflict target for housekeeping is the
Housekeeping Task rather than the Room.
"""

from dataclasses import dataclass
from typing import Callable

from the_reezort.housekeeping import api as housekeeping_api
from the_reezort.maintenance import api as maintenance_api


@dataclass(frozen=True)
class Action:
	"""One allowed offline action.

	`service` receives the target name positionally, then the payload keys named
	in `payload_fields` as keyword arguments. Nothing else from the payload is
	forwarded — an unexpected key is dropped, not passed through to a service
	that might accept it.
	"""

	target_doctype: str
	service: Callable
	payload_fields: tuple[str, ...] = ()
	#: Hard-conflict actions compare base_modified before dispatching. Everything
	#: in this table is hard-conflict today; the column exists because the policy
	#: is per-action by design (data-model.md), not a global rule.
	hard_conflict: bool = True


ALLOWED_ACTIONS: dict[str, Action] = {
	"housekeeping.start_task": Action(
		target_doctype="Housekeeping Task",
		service=housekeeping_api.start_task,
	),
	"housekeeping.pause_task": Action(
		target_doctype="Housekeeping Task",
		service=housekeeping_api.pause_task,
	),
	"housekeeping.complete_task": Action(
		target_doctype="Housekeeping Task",
		service=housekeeping_api.complete_task,
		payload_fields=("checklist", "notes", "photos", "exception_approval"),
	),
	"housekeeping.mark_dnd_or_refused": Action(
		target_doctype="Housekeeping Task",
		service=housekeeping_api.mark_dnd_or_refused,
		payload_fields=("dnd_status", "notes"),
	),
	"housekeeping.record_inspection": Action(
		target_doctype="Room Inspection",
		service=housekeeping_api.record_inspection,
		payload_fields=("outcome", "notes", "checklist_result", "photos"),
	),
	"maintenance.transition_ticket": Action(
		target_doctype="Maintenance Ticket",
		service=maintenance_api.transition_ticket,
		payload_fields=("next_state", "notes"),
	),
}

#: Deliberately absent: 015 approval decisions. They are online-only — a stale
#: approval applied from an outbox is a control failure, not a sync edge case.


def get_action(name: str) -> Action | None:
	return ALLOWED_ACTIONS.get(name)
