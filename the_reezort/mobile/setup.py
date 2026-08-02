"""Seeding for the mobile module: the guest role and the two OAuth clients.

Idempotent, in the house style — safe to re-run on every site, every migrate.
"""

import frappe
from frappe import _

from the_reezort.utils import envelope

#: Granted only at check-in portal-user creation. Deliberately not `Customer`
#: (ERPNext hands that out through its own flows, so the gate would widen over
#: time without anyone editing 016) and not Frappe's `Guest` (that means
#: *unauthenticated visitor*, which is a different thing entirely).
GUEST_ROLE = "Reezort Guest"

#: Roles that may use the ops app. `Duty Manager` appears in spec 016 as a
#: persona but does not exist as a role on the bench; `Resort Manager` does and
#: is used in its place until that is reconciled.
OPS_ROLES = ("Housekeeping", "Maintenance", "Resort Manager")

OPS_CLIENT = "reezort-ops"
GUEST_CLIENT = "reezort-guest"

#: Expo Go rewrites the redirect to `exp://<host>:<port>/--/<path>` in dev; a
#: real build uses the custom scheme. Frappe rejects any redirect_uri it has not
#: been told about, so both shapes are registered.
OPS_REDIRECTS = ("reezort://auth/callback",)
GUEST_REDIRECTS = ("reezortguest://auth/callback",)


def _ensure_role(name: str, desk_access: int = 0) -> None:
	if frappe.db.exists("Role", name):
		return
	frappe.get_doc(
		{"doctype": "Role", "role_name": name, "desk_access": desk_access}
	).insert(ignore_permissions=True)


def _ensure_oauth_client(app_name: str, redirects: tuple, roles: tuple) -> str:
	existing = frappe.db.get_value("OAuth Client", {"app_name": app_name}, "name")
	doc = (
		frappe.get_doc("OAuth Client", existing)
		if existing
		else frappe.new_doc("OAuth Client")
	)
	doc.app_name = app_name
	doc.scopes = "all openid"
	# Frappe joins redirect_uris on a space (`get_url_delimiter`).
	doc.redirect_uris = " ".join(redirects)
	doc.default_redirect_uri = redirects[0]
	doc.grant_type = "Authorization Code"
	doc.response_type = "Code"
	doc.skip_authorization = 1

	# `allowed_roles` is FAIL-OPEN: an empty list admits every authenticated
	# user, so a guest client shipped without one lets staff in silently. Always
	# set it explicitly, and only to roles that actually exist.
	doc.set("allowed_roles", [])
	for role in roles:
		if frappe.db.exists("Role", role):
			doc.append("allowed_roles", {"role": role})
	if not doc.get("allowed_roles"):
		frappe.throw(
			_("Refusing to create OAuth Client {0} with no allowed_roles — it would admit everyone").format(
				app_name
			)
		)

	doc.save(ignore_permissions=True)
	return doc.client_id or doc.name


def grant_guest_portal_role(user: str) -> None:
	"""Give a portal user the guest-app role.

	Called from the 003 check-in portal-user creation path. This is the *only*
	place the role is granted — that is what keeps the guest app's `/authorize`
	gate meaningfully closed.
	"""
	_ensure_role(GUEST_ROLE)
	if frappe.db.exists("Has Role", {"parent": user, "role": GUEST_ROLE}):
		return
	user_doc = frappe.get_doc("User", user)
	user_doc.append("roles", {"role": GUEST_ROLE})
	user_doc.save(ignore_permissions=True)


@frappe.whitelist()
def add_dev_redirect_uri(app_name: str, redirect_uri: str):
	"""Append a development redirect URI to a seeded client.

	`seed_mobile` writes only the canonical custom-scheme redirects, so re-running
	it drops anything added by hand — including the `exp://<host>:8081/--/…` form
	Expo Go rewrites to in development. Rather than let the seed quietly break the
	dev login, dev URIs are added deliberately through here.

	Refuses on production: an `exp://` or `http://` redirect on a live site is an
	open door to whoever controls that host.
	"""
	frappe.only_for("System Manager")
	if not frappe.conf.get("developer_mode"):
		frappe.throw(_("Development redirect URIs may only be added in developer mode"))

	name = frappe.db.get_value("OAuth Client", {"app_name": app_name}, "name")
	if not name:
		frappe.throw(_("No OAuth Client {0} — run seed_mobile first").format(app_name))

	doc = frappe.get_doc("OAuth Client", name)
	uris = [u for u in (doc.redirect_uris or "").split(" ") if u]
	if redirect_uri not in uris:
		uris.append(redirect_uri)
		doc.redirect_uris = " ".join(uris)
		doc.save(ignore_permissions=True)
		frappe.db.commit()
	return envelope({"client": name, "redirect_uris": uris})


@frappe.whitelist()
def seed_mobile():
	"""Idempotent seed. Run on a fresh site before the apps can authenticate."""
	frappe.only_for("System Manager")

	_ensure_role(GUEST_ROLE)
	ops = _ensure_oauth_client(OPS_CLIENT, OPS_REDIRECTS, OPS_ROLES)
	guest = _ensure_oauth_client(GUEST_CLIENT, GUEST_REDIRECTS, (GUEST_ROLE,))

	if not frappe.db.exists("Mobile Settings", "Mobile Settings"):
		frappe.get_doc({"doctype": "Mobile Settings"}).insert(ignore_permissions=True)

	frappe.db.commit()
	return envelope(
		{
			"guest_role": GUEST_ROLE,
			"ops_client_id": ops,
			"guest_client_id": guest,
			"ops_roles": [r for r in OPS_ROLES if frappe.db.exists("Role", r)],
		}
	)
