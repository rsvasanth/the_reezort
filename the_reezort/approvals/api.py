"""Approval framework — policy resolution + request lifecycle + decide.

An endpoint that MUST be gated calls `require_approval(action, source_doctype,
source_name, payload)` at the entry point. That helper:

  1. Finds the highest-threshold active Approval Policy matching (action,
     source_doctype). No policy → returns None (no gate).
  2. If policy.threshold_amount > 0 and payload.amount <= threshold → returns
     None (below threshold — no gate).
  3. If policy.auto_approve_for_role matches a role held by the requester →
     creates an Approval Request in state Auto-Approved (still audited) and
     returns None.
  4. Otherwise finds/creates an Approval Request in state Pending and RAISES
     an ApprovalRequired exception carrying the request name — caller must
     stop and return that to the user.

The caller then re-invokes with `approval_request=<name>` once the manager has
approved; the framework validates the request is Approved and lets the action
proceed.
"""

import frappe
from frappe import _
from frappe.utils import flt, now

from the_reezort.audit.api import record_audit_event
from the_reezort.utils import envelope as _envelope


class ApprovalRequired(frappe.ValidationError):
	"""Raised when a gated endpoint needs manager approval before proceeding."""
	pass


def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Login required."), frappe.PermissionError)


def _resolve_policy(action: str, source_doctype: str | None, amount: float):
	"""Highest-threshold matching active policy. Returns None if no gate applies."""
	rows = frappe.get_all(
		"Approval Policy",
		filters={"action": action, "is_active": 1},
		fields=["name", "policy_name", "approver_role", "auto_approve_for_role", "threshold_amount", "source_doctype"],
		order_by="threshold_amount desc",
	)
	for p in rows:
		if p.source_doctype and p.source_doctype != source_doctype:
			continue
		if flt(p.threshold_amount) > 0 and flt(amount) <= flt(p.threshold_amount):
			continue
		return p
	return None


def require_approval(
	action: str,
	source_doctype: str,
	source_name: str,
	payload: dict,
	approval_request: str | None = None,
):
	"""Guard function called at the top of every gated endpoint.

	Returns (proceed: bool, request_name: str | None):
	  - (True, None)          → no policy, or already approved / auto-approved
	  - (False, request_name) → a Pending request exists; caller must return
	    the request name to the frontend for manager review

	Raises `ApprovalRequired` (a ValidationError subclass) when it creates a
	fresh request, so callers who don't handle the tuple still stop safely.
	"""
	_require_login()

	# If the caller passes an existing request that's already Approved, let them proceed.
	if approval_request:
		req = frappe.get_doc("Approval Request", approval_request)
		if req.state in {"Approved", "Auto-Approved"}:
			return True, req.name
		if req.state == "Pending":
			frappe.throw(
				_("Approval Request {0} is still pending.").format(req.name),
				ApprovalRequired,
			)
		frappe.throw(_("Approval Request {0} was {1}; cannot proceed.").format(req.name, req.state))

	amount = flt((payload or {}).get("amount"))
	policy = _resolve_policy(action, source_doctype, amount)
	if not policy:
		return True, None  # no gate

	requester = frappe.session.user
	requester_roles = set(frappe.get_roles(requester))

	# Idempotency: reuse an open request for the same source+action+amount by this requester.
	existing = frappe.db.get_value(
		"Approval Request",
		{
			"action": action,
			"source_doctype": source_doctype,
			"source_name": source_name,
			"requester": requester,
			"amount": amount,
			"state": ["in", ["Pending", "Approved", "Auto-Approved"]],
		},
		"name",
	)
	if existing:
		req = frappe.get_doc("Approval Request", existing)
		if req.state in {"Approved", "Auto-Approved"}:
			return True, req.name
		# Still pending — block.
		frappe.throw(
			_("Approval Request {0} is still pending.").format(req.name),
			ApprovalRequired,
		)

	# Auto-approve when the requester holds the auto-approve role.
	auto = policy.get("auto_approve_for_role") and policy.get("auto_approve_for_role") in requester_roles
	state = "Auto-Approved" if auto else "Pending"

	req = frappe.get_doc(
		{
			"doctype": "Approval Request",
			"policy": policy.name,
			"action": action,
			"state": state,
			"requester": requester,
			"requested_at": now(),
			"source_doctype": source_doctype,
			"source_name": source_name,
			"amount": amount,
			"payload_json": frappe.as_json(payload or {}),
			"reason": (payload or {}).get("reason"),
		}
	).insert(ignore_permissions=True)

	if auto:
		record_audit_event(
			"Approval Request", req.name, "approval_auto",
			reason=f"Auto-approved: requester holds {policy.get('auto_approve_for_role')}",
			details={"policy": policy.name, "amount": amount},
		)
		return True, req.name

	# Fan-out to every user who holds the approver_role — no polling needed.
	try:
		from the_reezort.staff.notify_api import notify_role

		notify_role(
			role=policy.approver_role,
			subject=f"Approval needed · {action} · {source_doctype} {source_name}",
			body=f"Requested by {requester}"
				+ (f" · amount ₹{amount:,.0f}" if amount else ""),
			source_doctype="Approval Request",
			source_name=req.name,
			kind="Assignment",
			exclude_users={requester},
		)
	except Exception:
		pass

	# Blocked — caller must stop.
	frappe.throw(
		_("Approval required (policy: {0}). Request {1} created for {2}.").format(
			policy.policy_name, req.name, policy.approver_role
		),
		ApprovalRequired,
	)


# ---------- decisions ----------

@frappe.whitelist()
def list_pending_for_me():
	"""Requests whose approver_role is held by the current user, still Pending."""
	_require_login()
	my_roles = set(frappe.get_roles())
	rows = frappe.get_all(
		"Approval Request",
		filters={"state": "Pending"},
		fields=["name", "policy", "action", "requester", "requested_at", "source_doctype", "source_name", "amount", "reason", "payload_json"],
		order_by="requested_at desc",
	)
	out = []
	for r in rows:
		policy = frappe.db.get_value("Approval Policy", r.policy, ["approver_role", "policy_name"], as_dict=True)
		if policy and policy.approver_role in my_roles:
			r["policy_name"] = policy.policy_name
			r["approver_role"] = policy.approver_role
			r["requester_name"] = frappe.db.get_value("User", r.requester, "full_name")
			out.append(r)
	return _envelope({"requests": out})


@frappe.whitelist()
def list_all_open():
	_require_login()
	if "System Manager" not in frappe.get_roles() and "Resort Manager" not in frappe.get_roles():
		frappe.throw(_("Only managers can browse all open approvals."), frappe.PermissionError)
	rows = frappe.get_all(
		"Approval Request",
		filters={"state": "Pending"},
		fields=["name", "policy", "action", "requester", "requested_at", "source_doctype", "source_name", "amount", "reason", "payload_json"],
		order_by="requested_at desc",
	)
	for r in rows:
		p = frappe.db.get_value("Approval Policy", r.policy, ["approver_role", "policy_name"], as_dict=True)
		r["policy_name"] = p.policy_name if p else None
		r["approver_role"] = p.approver_role if p else None
		r["requester_name"] = frappe.db.get_value("User", r.requester, "full_name")
	return _envelope({"requests": rows})


@frappe.whitelist()
def list_my_requests(limit=100):
	_require_login()
	rows = frappe.get_all(
		"Approval Request",
		filters={"requester": frappe.session.user},
		fields=["name", "action", "state", "source_doctype", "source_name", "amount", "requested_at", "decided_at", "decision_notes"],
		order_by="requested_at desc",
		limit=int(limit),
	)
	return _envelope({"requests": rows})


@frappe.whitelist()
def decide_request(name, decision, notes=""):
	"""Approve or Reject a Pending request. Approver ≠ requester."""
	_require_login()
	req = frappe.get_doc("Approval Request", name)
	if req.state != "Pending":
		frappe.throw(_("Request {0} is already {1}.").format(name, req.state))

	if req.requester == frappe.session.user:
		frappe.throw(_("Approver cannot approve their own request."), frappe.PermissionError)

	policy = frappe.db.get_value("Approval Policy", req.policy, "approver_role")
	if policy and policy not in frappe.get_roles():
		frappe.throw(_("You do not hold the required role ({0}).").format(policy), frappe.PermissionError)

	if decision not in {"Approved", "Rejected"}:
		frappe.throw(_("Decision must be Approved or Rejected."))

	req.state = decision
	req.decided_by = frappe.session.user
	req.decided_at = now()
	req.decision_notes = notes or ""
	req.save(ignore_permissions=True)
	frappe.db.commit()

	record_audit_event(
		"Approval Request", req.name, "approval_decided",
		reason=notes or f"{decision} by {frappe.session.user}",
		details={"policy": req.policy, "action": req.action, "state": decision, "amount": req.amount},
	)
	return _envelope({"request": req.name, "state": req.state})
