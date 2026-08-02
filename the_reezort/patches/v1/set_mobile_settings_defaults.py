"""Backfill Mobile Settings defaults on sites where the singleton already exists.

A `default` in the doctype JSON applies only when a document is created. Adding a
`reqd` field to an existing Single therefore leaves that row without a value, and
every subsequent save fails with a MandatoryError — including saves made by
unrelated code that merely touches the settings.
"""

import frappe

DEFAULTS = {
	"ops_min_supported_version": "0.1.0",
	"guest_min_supported_version": "0.1.0",
	"max_outbox_age_hours": 72,
	"max_outbox_size": 500,
	"sync_page_size": 200,
	"sync_poll_seconds": 60,
	"photo_max_dimension_px": 1600,
	"photo_jpeg_quality": 75,
	"sync_log_retention_days": 90,
	"version_block_grace_minutes": 120,
}


def execute():
	if not frappe.db.exists("DocType", "Mobile Settings"):
		return
	for field, value in DEFAULTS.items():
		if not frappe.db.get_single_value("Mobile Settings", field):
			frappe.db.set_single_value("Mobile Settings", field, value)
	frappe.db.commit()
