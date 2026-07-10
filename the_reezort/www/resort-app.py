import frappe
from frappe.utils import get_system_timezone

no_cache = 1


def get_context():
	# The module-level `no_cache = 1` above only gates frappe.website.utils
	# .can_cache()'s READ path (whether an existing cache entry may be
	# served) via a site-wide/global check — it is never consulted for the
	# WRITE path. cache_html_decorator's write gate reads context.no_cache
	# off the dict THIS function returns, which was never set, so Frappe was
	# writing this page into the website_page cache regardless of the module
	# flag: one request's csrf_token got baked in and served to every
	# session until the next `bench clear-website-cache`. Set it explicitly.
	csrf_token = frappe.sessions.get_csrf_token()
	context = frappe._dict()
	context.no_cache = 1
	context.boot = get_boot()
	context.boot.csrf_token = csrf_token
	return context


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_context_for_dev():
	if not frappe.conf.developer_mode:
		frappe.throw("This method is only meant for developer mode")
	return get_boot()


def get_boot():
	return frappe._dict(
		{
			"frappe_version": frappe.__version__,
			"site_name": frappe.local.site,
			"read_only_mode": frappe.flags.read_only,
			"system_timezone": get_system_timezone(),
		}
	)
