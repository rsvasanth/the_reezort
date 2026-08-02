"""Push dispatch.

Called from existing hooks rather than from new business code, and **enqueued,
never inline**: a failure to notify must never fail the business transaction
that triggered it. A housekeeping task assignment that rolls back because
Firebase timed out would be a far worse bug than a missed notification.
"""

import json

import frappe
from frappe.utils import now_datetime

QUIET_HOURS_EXEMPT = ("SLA Escalation", "Approval Pending")


def _settings():
	return frappe.get_cached_doc("Mobile Settings")


def _in_quiet_hours() -> bool:
	settings = _settings()
	start, end = settings.push_quiet_hours_start, settings.push_quiet_hours_end
	if not start or not end:
		return False
	now = now_datetime().time()
	start, end = (frappe.utils.get_time(start), frappe.utils.get_time(end))
	# Quiet hours normally straddle midnight, so the window wraps.
	return start <= now or now < end if start > end else start <= now < end


def dispatch_push(
	user: str,
	event_type: str,
	title: str,
	body: str,
	deep_link: str = None,
	payload: dict = None,
	source_doctype: str = None,
	source_name: str = None,
) -> None:
	"""Fan out to every active device for a user. Never raises."""
	try:
		frappe.enqueue(
			"the_reezort.mobile.services.push._dispatch_now",
			queue="short",
			user=user,
			event_type=event_type,
			title=title,
			body=body,
			deep_link=deep_link,
			payload=payload,
			source_doctype=source_doctype,
			source_name=source_name,
		)
	except Exception:
		# Redis down, queue full — the originating transaction still commits.
		frappe.log_error(frappe.get_traceback(), "mobile.dispatch_push enqueue")


def _dispatch_now(user, event_type, title, body, deep_link=None, payload=None,
                  source_doctype=None, source_name=None):
	devices = frappe.get_all(
		"Mobile Device",
		filters={"user": user, "is_active": 1},
		fields=["name", "fcm_token"],
	)
	suppressed = event_type not in QUIET_HOURS_EXEMPT and _in_quiet_hours()

	for device in devices:
		event = frappe.new_doc("Mobile Push Event")
		event.user = user
		event.device = device["name"]
		event.event_type = event_type
		event.title = title
		event.body = body
		event.deep_link = deep_link
		event.payload = json.dumps(payload or {}, default=str)
		event.source_doctype = source_doctype
		event.source_name = source_name

		if suppressed:
			event.dispatch_status = "Suppressed"
			event.insert(ignore_permissions=True)
			continue
		if not device["fcm_token"]:
			event.dispatch_status = "Failed"
			event.error_message = "No FCM token registered"
			event.insert(ignore_permissions=True)
			continue

		try:
			event.fcm_message_id = _send_fcm(device["fcm_token"], title, body, deep_link, payload)
			event.dispatch_status = "Sent"
			event.sent_at = now_datetime()
		except _TokenUnregistered:
			# The app was uninstalled or the token rotated away. Not a retryable
			# error — the device row is dead and must stop receiving.
			event.dispatch_status = "Failed"
			event.error_message = "FCM reported the token unregistered"
			frappe.db.set_value(
				"Mobile Device", device["name"],
				{"is_active": 0, "fcm_token": None, "revoked_at": now_datetime(),
				 "revoke_reason": "Token Invalid"},
			)
		except Exception as exc:
			event.dispatch_status = "Failed"
			event.error_message = str(exc)[:500]

		event.insert(ignore_permissions=True)

	frappe.db.commit()


class _TokenUnregistered(Exception):
	pass


def _send_fcm(token: str, title: str, body: str, deep_link: str | None, payload: dict | None) -> str:
	"""Send one message via Firebase Admin.

	**Not yet wired.** The Firebase project and `google-services.json` are Phase 0
	items and do not exist (see tasks.md). Until credentials are present this
	raises, which lands as a `Failed` Mobile Push Event — visible and auditable
	rather than silently swallowed, and harmless to the business transaction
	because dispatch is enqueued.

	Notification content must stay guest-safe and PII-minimal: room number and
	ticket reference are fine, guest name and folio balance are not. Android
	shows these on a lock screen anyone holding the handset can read.
	"""
	credentials = frappe.conf.get("firebase_credentials_path")
	if not credentials:
		raise Exception("Firebase credentials not configured (firebase_credentials_path)")

	import firebase_admin  # noqa: F401  (imported lazily; optional dependency)
	from firebase_admin import credentials as fb_credentials, messaging

	if not firebase_admin._apps:
		firebase_admin.initialize_app(fb_credentials.Certificate(credentials))

	try:
		return messaging.send(
			messaging.Message(
				token=token,
				notification=messaging.Notification(title=title, body=body),
				data={k: str(v) for k, v in (payload or {}).items()}
				| ({"deep_link": deep_link} if deep_link else {}),
			)
		)
	except messaging.UnregisteredError as exc:
		raise _TokenUnregistered() from exc


def purge_push_events():
	"""Scheduled. Push events are audit; they answer "I never got it"."""
	days = _settings().sync_log_retention_days or 90
	frappe.db.delete(
		"Mobile Push Event", {"creation": ["<", frappe.utils.add_days(now_datetime(), -days)]}
	)
	frappe.db.commit()


def purge_oauth_tokens():
	"""Scheduled. Frappe never cleans these up.

	One `OAuth Bearer Token` row is created per authorization *and* per refresh,
	and rotation leaves the old rows Active. At roughly one refresh an hour per
	handset a full floor generates tens of thousands of rows a month.
	"""
	now = now_datetime()
	frappe.db.delete("OAuth Bearer Token", {"expiration_time": ["<", now], "status": "Revoked"})
	frappe.db.delete(
		"OAuth Authorization Code",
		{"creation": ["<", frappe.utils.add_days(now, -1)], "validity": "Invalid"},
	)
	frappe.db.commit()
