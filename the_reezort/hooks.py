app_name = "the_reezort"
app_title = "THE REEZORT"
app_publisher = "Alphaworkz"
app_description = "Five-star resort operations layer for ERPNext"
app_email = "support@alphaworkz.com"
app_license = "mit"

# Apps
# ------------------

required_apps = ["erpnext", "hrms"]

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "the_reezort",
# 		"logo": "/assets/the_reezort/logo.png",
# 		"title": "THE REEZORT",
# 		"route": "/the_reezort",
# 		"has_permission": "the_reezort.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/the_reezort/css/the_reezort.css"
# app_include_js = "/assets/the_reezort/js/the_reezort.js"

# include js, css files in header of web template
# web_include_css = "/assets/the_reezort/css/the_reezort.css"
# web_include_js = "/assets/the_reezort/js/the_reezort.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "the_reezort/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "the_reezort/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "the_reezort.utils.jinja_methods",
# 	"filters": "the_reezort.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "the_reezort.install.before_install"
# after_install = "the_reezort.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "the_reezort.uninstall.before_uninstall"
# after_uninstall = "the_reezort.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "the_reezort.utils.before_app_install"
# after_app_install = "the_reezort.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "the_reezort.utils.before_app_uninstall"
# after_app_uninstall = "the_reezort.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "the_reezort.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# Mobile push triggers (016). Wired as observers rather than as calls planted
# inside 005/009/015 service code: no existing service changes, and a push can
# never fail the business transaction that triggered it.
doc_events = {
	"Housekeeping Task": {
		"on_update": "the_reezort.mobile.notifications.on_housekeeping_task_update",
	},
	"Maintenance Ticket": {
		"on_update": "the_reezort.mobile.notifications.on_maintenance_ticket_update",
	},
	"Approval Request": {
		"on_update": "the_reezort.mobile.notifications.on_approval_request_update",
	},
}

# Scheduled Tasks
# ---------------

scheduler_events = {
	"hourly": [
		"the_reezort.servicedesk.api.escalate_overdue_tickets",
		"the_reezort.maintenance.api.escalate_overdue_tickets",
		"the_reezort.guest_services.api.escalate_overdue_guest_requests",
		"the_reezort.integrations.ota.api.retry_dead_letter",
		"the_reezort.staff.notification_scheduler.send_task_followups",
		"the_reezort.reservation.api.expire_stale_holds",
	],
	"daily": [
		"the_reezort.staff.notification_scheduler.send_approval_followups",
		"the_reezort.staff.notification_scheduler.send_leave_advance_followups",
		"the_reezort.analytics.revenue.snapshot_yesterday",
		"the_reezort.maintenance.preventive.run_daily_preventive_generation",
		"the_reezort.mobile.services.sync.purge_sync_logs",
		"the_reezort.mobile.services.push.purge_push_events",
		# Frappe never cleans OAuth tokens up: one row per authorization AND per
		# refresh, with rotation leaving the old ones Active. A full floor of
		# handsets generates tens of thousands of rows a month.
		"the_reezort.mobile.services.push.purge_oauth_tokens",
		# A handset blocked by the version gate and then left in a drawer would
		# otherwise keep a live credential: Frappe refresh tokens never expire.
		"the_reezort.mobile.services.auth.revoke_expired_version_blocks",
	],
}

# Testing
# -------

# before_tests = "the_reezort.install.before_tests"

# Overriding Methods
# ------------------------------
#
# Frappe ships no rate limit on the OAuth2 endpoints, which are allow_guest by
# definition and therefore the obvious place to farm authorization codes. The
# overrides are thin decorators that delegate straight through to core.
override_whitelisted_methods = {
	"frappe.integrations.oauth2.authorize": "the_reezort.mobile.oauth_guard.authorize",
	"frappe.integrations.oauth2.get_token": "the_reezort.mobile.oauth_guard.get_token",
}
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "the_reezort.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["the_reezort.utils.before_request"]
# after_request = ["the_reezort.utils.after_request"]

# Job Events
# ----------
# before_job = ["the_reezort.utils.before_job"]
# after_job = ["the_reezort.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"the_reezort.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

website_route_rules = [
	{"from_route": "/resort-app/<path:app_path>", "to_route": "resort-app"},
]
