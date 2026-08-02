"""Rate-limited wrappers around Frappe's OAuth2 endpoints.

`/authorize` and `/token` are `allow_guest=True` and unauthenticated by
definition, which makes them the obvious place to grind credentials or farm
authorization codes. Frappe ships no limit on either.

Wired through `override_whitelisted_methods` in hooks.py so the core functions
stay untouched — the override is a thin decorator that delegates straight
through. Limits reuse the per-IP shape already proven on the public booking
channel (`reservation/guest_booking.py`).
"""

import frappe
from frappe.integrations import oauth2
from frappe.rate_limiter import rate_limit

#: Generous enough for a floor of staff re-authenticating after a shift change,
#: tight enough that code-farming is not free. Per IP, which on resort Wi-Fi
#: means per-NAT — hence minutes rather than seconds.
AUTHORIZE_LIMIT = 30
AUTHORIZE_WINDOW = 300

#: Token exchange follows a code the client already holds, so legitimate volume
#: is lower. Refresh traffic also lands here — roughly one per device per hour.
TOKEN_LIMIT = 60
TOKEN_WINDOW = 300


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=AUTHORIZE_LIMIT, seconds=AUTHORIZE_WINDOW)
def authorize(**kwargs):
	return oauth2.authorize(**kwargs)


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=TOKEN_LIMIT, seconds=TOKEN_WINDOW)
def get_token(*args, **kwargs):
	return oauth2.get_token(*args, **kwargs)
