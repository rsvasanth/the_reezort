"""Session registration and bootstrap.

There is no `mobile_login`. Authentication is stock Frappe OAuth2 with PKCE
(AD-016-002), so by the time anything here runs the caller is already
authenticated — these endpoints do device bookkeeping, not credential exchange.
"""

import hashlib
import json

import frappe
from frappe import _
from frappe.utils import now_datetime

from the_reezort.utils import as_dict, envelope

APPS = ("Ops", "Guest")


def _settings():
	return frappe.get_cached_doc("Mobile Settings")


def _version_tuple(value: str) -> tuple:
	try:
		return tuple(int(part) for part in str(value or "0").split("."))
	except ValueError:
		return (0,)


def current_bearer_token() -> str | None:
	"""The access token backing this request, read from the request context.

	Never accepted as a parameter: a body copy would be redundant, would land in
	request logs, and would invite trusting client input over the header that
	actually authenticated the call.
	"""
	header = frappe.get_request_header("Authorization") or ""
	parts = header.split(" ", 1)
	if len(parts) == 2 and parts[0].lower() == "bearer":
		return parts[1].strip()
	return None


def token_fingerprint(token: str) -> str:
	"""SHA-256 of the access token.

	Frappe names an `OAuth Bearer Token` row after the token itself
	(`autoname: field:access_token`), so a Link field would persist a live
	credential in plaintext on a row support staff read for triage. The
	fingerprint identifies the row and is useless to anyone who reads it.
	"""
	return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _revoke_token_chain(user: str, oauth_client: str | None, fingerprint: str | None) -> int:
	"""Revoke this device's bearer tokens — and only this device's.

	Frappe's refresh rotation does not invalidate prior tokens and has no reuse
	detection, so a device can hold more than one live credential. Matching on
	fingerprint keeps revocation exact: scoping by (user, client) instead would
	revoke every handset that user owns on that app, which is precisely the
	per-device isolation AD-016-002 exists to provide.
	"""
	rows = frappe.get_all(
		"OAuth Bearer Token",
		filters={"user": user, "status": "Active", **({"client": oauth_client} if oauth_client else {})},
		fields=["name"],
	)
	revoked = 0
	for row in rows:
		if fingerprint and token_fingerprint(row["name"]) != fingerprint:
			continue
		frappe.db.set_value("OAuth Bearer Token", row["name"], "status", "Revoked")
		revoked += 1
	return revoked


def _blocked_version(app: str, app_version: str) -> str | None:
	settings = _settings()
	floor = (
		settings.ops_min_supported_version if app == "Ops" else settings.guest_min_supported_version
	)
	if floor and _version_tuple(app_version) < _version_tuple(floor):
		return floor
	return None


@frappe.whitelist()
def register_session(device):
	"""Device bookkeeping immediately after the OAuth exchange."""
	device = as_dict(device)
	app = device.get("app")
	if app not in APPS:
		frappe.throw(_("Unknown app: {0}").format(app))

	device_id = device.get("device_id")
	if not device_id:
		frappe.throw(_("device_id is required"))

	user = frappe.session.user
	token = current_bearer_token()
	fingerprint = token_fingerprint(token) if token else None

	# Version gate. It runs *after* authentication now, so a blocked build
	# already holds a token — showing a wall would leave that token usable by a
	# client that simply skips this call. The token has to die.
	floor = _blocked_version(app, device.get("app_version") or "0")
	if floor:
		_revoke_token_chain(user, None, fingerprint)
		frappe.db.commit()
		return {
			"ok": False,
			"data": {},
			"warnings": [],
			"blockers": [
				{
					"type": "version_blocked",
					"message": _("This build is no longer supported. Update to {0} or later.").format(floor),
					"minimum_version": floor,
				}
			],
			"next_actions": [],
		}

	# A shared handset handed between attendants must not keep the previous
	# user's session alive on it.
	for prior in frappe.get_all(
		"Mobile Device",
		filters={"device_id": device_id, "app": app, "is_active": 1},
		fields=["name", "user", "oauth_client", "oauth_token_fingerprint"],
	):
		if prior["user"] == user:
			continue
		_revoke_token_chain(prior["user"], prior["oauth_client"], prior["oauth_token_fingerprint"])
		frappe.db.set_value(
			"Mobile Device", prior["name"],
			{"is_active": 0, "revoked_at": now_datetime(), "revoke_reason": "Admin Revoke",
			 "fcm_token": None},
		)

	name = frappe.db.get_value(
		"Mobile Device", {"device_id": device_id, "app": app, "user": user}, "name"
	)
	doc = frappe.get_doc("Mobile Device", name) if name else frappe.new_doc("Mobile Device")
	doc.user = user
	doc.app = app
	doc.device_id = device_id
	doc.platform = device.get("platform") or "Android"
	doc.device_model = device.get("device_model")
	doc.os_version = device.get("os_version")
	doc.app_version = device.get("app_version")
	doc.runtime_version = device.get("runtime_version")
	doc.oauth_token_fingerprint = fingerprint
	doc.is_active = 1
	doc.revoked_at = None
	doc.revoke_reason = None
	doc.registered_at = doc.registered_at or now_datetime()
	doc.last_seen_at = now_datetime()
	doc.save(ignore_permissions=True)

	return envelope(_session_payload(doc))


def _session_payload(device_doc=None) -> dict:
	settings = _settings()
	user_doc = frappe.get_cached_doc("User", frappe.session.user)
	return {
		"user": {
			"name": user_doc.name,
			"full_name": user_doc.full_name,
			"email": user_doc.email,
		},
		# UI gating only. Server-side permission remains the enforcement truth.
		"roles": frappe.get_roles(frappe.session.user),
		"server_time": str(now_datetime()),
		"device": device_doc.name if device_doc else None,
		"settings": {
			"max_outbox_age_hours": settings.max_outbox_age_hours,
			"max_outbox_size": settings.max_outbox_size,
			"photo_max_dimension_px": settings.photo_max_dimension_px,
			"photo_jpeg_quality": settings.photo_jpeg_quality,
			"sync_poll_seconds": settings.sync_poll_seconds,
			"sync_page_size": settings.sync_page_size,
			"feature_flags": json.loads(settings.feature_flags) if settings.feature_flags else {},
		},
	}


@frappe.whitelist()
def get_bootstrap():
	"""Cold start and resume-after-background."""
	return envelope(_session_payload())


@frappe.whitelist()
def mobile_logout(device_id):
	"""Revoke this device's credentials, then mark it inactive.

	The client wipes its SQLite cache, secure store and pending photos. A
	non-empty outbox must warn before this is called — queued work is not
	silently discarded (AD-016-007).
	"""
	user = frappe.session.user
	name = frappe.db.get_value("Mobile Device", {"device_id": device_id, "user": user}, "name")
	if not name:
		frappe.throw(_("No registered device {0} for this user").format(device_id))

	doc = frappe.get_doc("Mobile Device", name)
	revoked = _revoke_token_chain(user, doc.oauth_client, doc.oauth_token_fingerprint)
	doc.is_active = 0
	doc.fcm_token = None
	doc.revoked_at = now_datetime()
	doc.revoke_reason = "User Logout"
	doc.save(ignore_permissions=True)

	return envelope({"device": doc.name, "tokens_revoked": revoked})
