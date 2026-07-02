"""Idempotent menu image seeder — mirrors the villa render pattern.

Reads image files from `setup/seed_assets/menu_photos/{OUTLET}_{CODE}.jpg`
(or .png / .webp), uploads via Frappe's File API (dedup by content hash),
and sets Menu Item.image on the matching row.

Drop real food photography into the same folder with the same filename
convention and re-run — the seeder replaces the placeholder gradient
tile with the real photo.
"""

from __future__ import annotations

import hashlib
import mimetypes
from pathlib import Path

import frappe
from frappe import _

_HERE = Path(__file__).resolve().parent
SEED_DIR = _HERE.parent / "setup" / "seed_assets" / "menu_photos"

VALID_EXT = (".jpg", ".jpeg", ".png", ".webp")


def _upload_and_attach(path: Path, target_doctype: str, target_name: str) -> str:
	data = path.read_bytes()
	digest = hashlib.md5(data).hexdigest()

	# Same-hash + same target already attached → reuse.
	attached = frappe.db.get_value(
		"File",
		{
			"content_hash": digest,
			"attached_to_doctype": target_doctype,
			"attached_to_name": target_name,
		},
		["name", "file_url"],
		as_dict=True,
	)
	if attached:
		return attached["file_url"]

	# Same-hash already on disk anywhere → point new File row at it.
	any_row = frappe.db.get_value("File", {"content_hash": digest}, ["file_url"], as_dict=True)
	if any_row:
		doc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": path.name,
				"file_url": any_row["file_url"],
				"content_hash": digest,
				"attached_to_doctype": target_doctype,
				"attached_to_name": target_name,
				"is_private": 0,
			}
		)
		doc.flags.ignore_permissions = True
		doc.insert(ignore_permissions=True)
		return any_row["file_url"]

	from frappe.utils.file_manager import save_file

	file_doc = save_file(
		fname=path.name,
		content=data,
		dt=target_doctype,
		dn=target_name,
		folder="Home",
		is_private=0,
		df=None,
	)
	url = getattr(file_doc, "file_url", None) or (file_doc.get("file_url") if isinstance(file_doc, dict) else None)
	if not url:
		content_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
		frappe.throw(_("Could not determine file_url for uploaded {0} ({1})").format(path.name, content_type))
	return url


def _path_for(outlet_code: str, item_code_short: str) -> Path | None:
	for ext in VALID_EXT:
		p = SEED_DIR / f"{outlet_code}_{item_code_short}{ext}"
		if p.exists():
			return p
	return None


@frappe.whitelist()
def seed_menu_images(resort_property: str | None = None) -> dict:
	if not SEED_DIR.exists():
		return {"ok": False, "reason": f"Missing folder {SEED_DIR}"}

	filters = {"is_available": 1}
	if resort_property:
		outlets = frappe.get_all(
			"FnB Outlet", filters={"resort_property": resort_property}, pluck="name"
		)
		if not outlets:
			return {"ok": False, "reason": "No outlets on property"}
		filters["outlet"] = ["in", outlets]

	items = frappe.get_all(
		"Menu Item",
		filters=filters,
		fields=["name", "outlet", "item_code_short", "image"],
	)
	updated = []
	skipped = []
	missing = []
	for it in items:
		outlet_code = frappe.db.get_value("FnB Outlet", it["outlet"], "outlet_code")
		path = _path_for(outlet_code, it["item_code_short"])
		if not path:
			missing.append(f"{outlet_code}/{it['item_code_short']}")
			continue
		url = _upload_and_attach(path, "Menu Item", it["name"])
		if it["image"] == url:
			skipped.append(it["item_code_short"])
			continue
		frappe.db.set_value("Menu Item", it["name"], "image", url, update_modified=False)
		updated.append(it["item_code_short"])
	frappe.db.commit()
	return {"ok": True, "updated": updated, "skipped": skipped, "missing": missing}
