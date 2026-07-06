"""Idempotent seeder for Signature Arch Villa renders.

Reads 4 image files from `the_reezort/setup/seed_assets/villa_renders/`:

    exterior.jpg   (or .png) — hero, the arched form the guest sees on arrival
    living.jpg               — indoor living / entrance perspective
    bedroom.jpg              — bedroom perspective (the primary sleep area)
    bathroom.jpg             — bath / wet area perspective

Uploads each to the File doctype (idempotent — file with the same content
hash is reused). Wires them to:

  · Room Type "Signature Arch Villa"  · image = exterior
  · Every Room (V1–V7) sharing that   · image = exterior
    room type
  · One Room Condition Capture per    · capture_stage = "Marketing"
    Room, tagged Marketing, holding    · 4 photos in the child table
    all 4 images

Run:
    bench --site app.thereezort.com execute the_reezort.setup.image_seed.seed_villa_renders

Add extra shots by dropping more files into the folder and running again —
the seeder picks them up as additional capture photos.
"""

from __future__ import annotations

import hashlib
import mimetypes
import os
from pathlib import Path

import frappe
from the_reezort.permissions import system_manager_only

CAPTURE_STAGE = "Marketing"
ROOM_TYPE_NAME_CANDIDATES = [
	"Signature Arch Villa",
	"SAV",  # code
]

_HERE = Path(__file__).resolve().parent
SEED_DIR = _HERE / "seed_assets" / "villa_renders"

# Ordered — controls both the hero pick and the gallery order.
CANONICAL_SHOTS = [
	("exterior", "Exterior · Signature Arch"),
	("living", "Interior · Living perspective"),
	("bedroom", "Interior · Bedroom perspective"),
	("bathroom", "Interior · Bathroom perspective"),
]

VALID_EXT = (".jpg", ".jpeg", ".png", ".webp")


# ---------- helpers ----------


def _shot_path(slug: str) -> Path | None:
	for ext in VALID_EXT:
		p = SEED_DIR / f"{slug}{ext}"
		if p.exists():
			return p
	return None


def _extra_paths() -> list[Path]:
	"""Any file in the folder not covered by CANONICAL_SHOTS becomes an extra
	capture photo (order = filename sort)."""
	if not SEED_DIR.exists():
		return []
	seen_slugs = {s for s, _ in CANONICAL_SHOTS}
	extras: list[Path] = []
	for p in sorted(SEED_DIR.iterdir()):
		if not p.is_file() or p.suffix.lower() not in VALID_EXT:
			continue
		if p.stem.lower() in seen_slugs:
			continue
		extras.append(p)
	return extras


def _resolve_room_type() -> str | None:
	for candidate in ROOM_TYPE_NAME_CANDIDATES:
		if frappe.db.exists("Room Type", candidate):
			return candidate
	# Fallback: any room type named like "…arch…"
	rows = frappe.db.sql(
		"SELECT name FROM `tabRoom Type` WHERE room_type_name LIKE %s LIMIT 1",
		("%Arch%",),
	)
	return rows[0][0] if rows else None


def _upload_file(path: Path, attached_to: dict | None = None) -> str:
	"""Insert (or reuse) a File row for `path`, return its file_url. If
	`attached_to` is given AND a File with the same content_hash isn't already
	attached to that record, attach it (one File row per (hash, target)).
	"""
	data = path.read_bytes()
	digest = hashlib.md5(data).hexdigest()

	filename = path.name
	content_type = mimetypes.guess_type(filename)[0] or "image/jpeg"

	# Fast path: a File with this hash already exists AND is already attached
	# to the same target (or we don't care about attachment).
	if attached_to:
		attached = frappe.db.get_value(
			"File",
			{
				"content_hash": digest,
				"attached_to_doctype": attached_to["doctype"],
				"attached_to_name": attached_to["name"],
			},
			["name", "file_url"],
			as_dict=True,
		)
		if attached:
			return attached["file_url"]

	# Any File with this hash — reuse the physical file, insert a new row with the
	# attachment metadata pointing at the target.
	any_row = frappe.db.get_value("File", {"content_hash": digest}, ["file_url"], as_dict=True)
	if any_row and attached_to:
		file_doc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": filename,
				"file_url": any_row["file_url"],
				"content_hash": digest,
				"attached_to_doctype": attached_to["doctype"],
				"attached_to_name": attached_to["name"],
				"is_private": 0,
			}
		)
		file_doc.flags.ignore_permissions = True
		file_doc.insert(ignore_permissions=True)
		return any_row["file_url"]
	if any_row:
		return any_row["file_url"]

	# Fresh upload via Frappe's helper (writes to disk + creates File row).
	from frappe.utils.file_manager import save_file

	file_doc = save_file(
		fname=filename,
		content=data,
		dt=(attached_to or {}).get("doctype"),
		dn=(attached_to or {}).get("name"),
		folder="Home",
		is_private=0,
		df=None,
	)
	url = getattr(file_doc, "file_url", None) or (file_doc.get("file_url") if isinstance(file_doc, dict) else None)
	if not url:
		frappe.throw(f"Could not determine file_url for uploaded {filename} ({content_type})")
	return url


def _target_rooms(room_type: str) -> list[str]:
	return frappe.get_all(
		"Room",
		filters={"room_type": room_type, "is_active": 1},
		pluck="name",
		order_by="room_number asc",
	)


def _set_image(doctype: str, name: str, image: str) -> None:
	"""Idempotent: only write if the value actually changed."""
	current = frappe.db.get_value(doctype, name, "image")
	if current == image:
		return
	frappe.db.set_value(doctype, name, "image", image, update_modified=False)


def _attach_gallery_to_room(room: str, source_paths: list[tuple[Path, str]]) -> list[str]:
	"""Attach each source image to the Room as a File attachment. Idempotent
	via content_hash + attached_to_(doctype,name). Returns the resulting
	file_url list in the order given."""
	urls = []
	for path, _caption in source_paths:
		url = _upload_file(path, attached_to={"doctype": "Room", "name": room})
		urls.append(url)
	return urls


# ---------- entrypoint ----------


@frappe.whitelist()
@system_manager_only
def seed_villa_renders() -> dict:
	if not SEED_DIR.exists() or not any(SEED_DIR.iterdir()):
		return {
			"ok": False,
			"reason": f"No files in {SEED_DIR}. Drop exterior/living/bedroom/bathroom renders (jpg/png/webp) and re-run.",
			"seed_dir": str(SEED_DIR),
		}

	room_type = _resolve_room_type()
	if not room_type:
		frappe.throw("Signature Arch Villa room type not found on this site.")

	# Ordered source-file list: canonical shots (if present) first, extras next.
	# Each item is (Path, caption) — the seeder uploads them as File
	# attachments on each Room and picks the first as hero for Room + Room Type.
	sources: list[tuple[Path, str]] = []
	seen_stems: set[str] = set()
	for slug, caption in CANONICAL_SHOTS:
		path = _shot_path(slug)
		if not path:
			continue
		sources.append((path, caption))
		seen_stems.add(path.stem.lower())
	for p in _extra_paths():
		if p.stem.lower() in seen_stems:
			continue
		sources.append((p, p.stem.replace("_", " ").replace("-", " ").title()))

	if not sources:
		return {
			"ok": False,
			"reason": "Found files but none matched supported extensions (.jpg/.jpeg/.png/.webp).",
			"seed_dir": str(SEED_DIR),
		}

	rooms = _target_rooms(room_type)
	if not rooms:
		return {"ok": False, "reason": f"No active rooms under room type {room_type}."}

	# Upload hero once against the room type so the Room Type card shows it.
	hero_url = _upload_file(sources[0][0], attached_to={"doctype": "Room Type", "name": room_type})
	_set_image("Room Type", room_type, hero_url)

	# Attach the full gallery to each room, and set Room.image = hero.
	rooms_seeded: list[dict] = []
	for room in rooms:
		urls = _attach_gallery_to_room(room, sources)
		if urls:
			_set_image("Room", room, urls[0])
		rooms_seeded.append({"room": room, "urls": urls})

	frappe.db.commit()

	return {
		"ok": True,
		"room_type": room_type,
		"hero_url": hero_url,
		"rooms_updated": [r["room"] for r in rooms_seeded],
		"gallery_count": len(sources),
		"per_room_urls": {r["room"]: r["urls"] for r in rooms_seeded},
		"seed_dir": str(SEED_DIR),
	}
