import frappe
from frappe.utils import get_system_timezone

no_cache = 1


def get_context():
	# This file used to be named resort-app.py (hyphen, matching the route
	# and the .html template). frappe.website.page_renderers.template_page
	# .TemplatePage.set_pymodule() looks for a controller by replacing
	# hyphens with underscores (resort_app.py) before checking os.path
	# .exists() — that lookup failed against the hyphenated filename, so
	# self.pymodule_name stayed None and get_context() was NEVER CALLED:
	# no_cache (module-level or returned here) never reached
	# cache_html_decorator's write gate, so every request wrote this page's
	# HTML into the website_page cache, freezing in one request's
	# csrf_token and serving it to every other session until the next
	# `bench clear-website-cache`. Renaming to resort_app.py makes Frappe
	# resolve the controller and actually call this function; setting
	# context.no_cache = 1 explicitly (belt-and-suspenders with the
	# module-level flag, which set_pymodule_properties() now also picks up
	# correctly) is what the write gate reads.
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
