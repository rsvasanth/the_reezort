"""Device registration and revocation.

Revocation is an authentication-layer control, not a client-honoured flag: after
`revoke_device` runs the handset holds no working credential whether or not the
app cooperates. That is the whole reason AD-016-002 chose OAuth over the
per-user key/secret pair — see `auth-spike-findings.md`.
"""

import frappe
from frappe import _
from frappe.utils import now_datetime

from the_reezort.mobile.services.auth import _revoke_token_chain, assert_not_version_blocked
from the_reezort.utils import envelope

REVOKE_REASONS = (
	"User Logout",
	"Admin Revoke",
	"Token Invalid",
	"Version Blocked",
	"Inactivity",
	"Device Lost",
)


@frappe.whitelist()
def register_device_token(device_id, fcm_token):
	"""Called after login and on every FCM token rotation."""
	assert_not_version_blocked()
	name = frappe.db.get_value(
		"Mobile Device", {"device_id": device_id, "user": frappe.session.user, "is_active": 1}, "name"
	)
	if not name:
		frappe.throw(_("No active device {0} for this user").format(device_id))

	frappe.db.set_value(
		"Mobile Device", name, {"fcm_token": fcm_token, "last_seen_at": now_datetime()}
	)
	return envelope({"device": name})


@frappe.whitelist()
def revoke_device(device_id, reason="Admin Revoke"):
	"""Admin-facing; also called internally when FCM reports a token unregistered.

	A user may revoke their own device; revoking anyone else's needs System
	Manager. Departed staff, lost handsets and sold phones are routine on BYOD,
	so this has to work without the device's consent.
	"""
	if reason not in REVOKE_REASONS:
		frappe.throw(_("Unsupported revoke reason: {0}").format(reason))

	rows = frappe.get_all(
		"Mobile Device",
		filters={"device_id": device_id, "is_active": 1},
		fields=["name", "user", "oauth_client", "oauth_token_fingerprint"],
	)
	if not rows:
		return envelope({"devices_revoked": 0, "tokens_revoked": 0})

	is_admin = "System Manager" in frappe.get_roles(frappe.session.user)
	revoked_tokens = 0
	for row in rows:
		if row["user"] != frappe.session.user and not is_admin:
			frappe.throw(_("Not permitted to revoke another user's device"), frappe.PermissionError)
		revoked_tokens += _revoke_token_chain(
			row["user"], row["oauth_client"], row["oauth_token_fingerprint"]
		)
		frappe.db.set_value(
			"Mobile Device", row["name"],
			{"is_active": 0, "fcm_token": None, "revoked_at": now_datetime(), "revoke_reason": reason},
		)

	return envelope({"devices_revoked": len(rows), "tokens_revoked": revoked_tokens})


@frappe.whitelist()
def list_my_devices():
	"""So a staff member can see — and kill — a handset they no longer have."""
	return envelope(
		{
			"devices": frappe.get_all(
				"Mobile Device",
				filters={"user": frappe.session.user},
				fields=["name", "device_id", "app", "device_model", "os_version", "app_version",
				        "is_active", "registered_at", "last_seen_at", "revoke_reason"],
				order_by="last_seen_at desc",
			)
		}
	)
