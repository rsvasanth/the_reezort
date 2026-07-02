"""Attach ingredient tile images to ERPNext Items — mirrors menu image_seed.

Reads `setup/seed_assets/ingredient_photos/{ITEM_CODE}.jpg` and sets
Item.image on the matching row. Content-hash dedupe on the File table so a
re-run doesn't create duplicate File records. Real photography drops into
the same folder with the same filename convention and re-run swaps it in.
"""

from __future__ import annotations

import hashlib
import mimetypes
from pathlib import Path

import frappe
from frappe import _


_HERE = Path(__file__).resolve().parent
SEED_DIR = _HERE.parent / "setup" / "seed_assets" / "ingredient_photos"
VALID_EXT = (".jpg", ".jpeg", ".png", ".webp")


def _upload_and_attach(path: Path, target_doctype: str, target_name: str) -> str:
	data = path.read_bytes()
	digest = hashlib.md5(data).hexdigest()

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


def _path_for(item_code: str) -> Path | None:
	for ext in VALID_EXT:
		p = SEED_DIR / f"{item_code}{ext}"
		if p.exists():
			return p
	return None


@frappe.whitelist()
def seed_ingredient_images() -> dict:
	if not SEED_DIR.exists():
		return {"ok": False, "reason": f"Missing folder {SEED_DIR}"}

	items = frappe.get_all(
		"Item",
		filters={"item_code": ["like", "RAW-%"]},
		fields=["name", "item_code", "image"],
	)
	updated: list[str] = []
	skipped: list[str] = []
	missing: list[str] = []
	for row in items:
		path = _path_for(row["item_code"])
		if not path:
			missing.append(row["item_code"])
			continue
		url = _upload_and_attach(path, "Item", row["name"])
		if row["image"] == url:
			skipped.append(row["item_code"])
			continue
		frappe.db.set_value("Item", row["name"], "image", url, update_modified=False)
		updated.append(row["item_code"])
	frappe.db.commit()
	return {"ok": True, "updated": updated, "skipped": skipped, "missing": missing}
