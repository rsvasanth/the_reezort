"""Whitelisted facade for the mobile clients.

Contract namespace is `the_reezort.mobile.api` (contracts/api.md). Implementation
lives in `the_reezort.mobile.services.*`; this module re-exports so the client
has one stable import path even if a service is split later.
"""

from the_reezort.mobile.services.auth import (  # noqa: F401
	get_bootstrap,
	mobile_logout,
	register_session,
)
from the_reezort.mobile.services.devices import (  # noqa: F401
	list_my_devices,
	register_device_token,
	revoke_device,
)
from the_reezort.mobile.services.sync import (  # noqa: F401
	attach_mobile_file,
	sync_pull,
	sync_push,
)
