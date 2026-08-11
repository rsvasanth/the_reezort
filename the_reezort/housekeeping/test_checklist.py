from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from the_reezort.approvals.api import ApprovalRequired
from the_reezort.housekeeping.api import assign_task, complete_task, create_task, start_task


def insert_doc(doctype, **values):
	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True, ignore_links=True)
	return doc


class TestHousekeepingChecklist(FrappeTestCase):
	def setUp(self):
		super().setUp()
		# Same cleanup convention as approvals/test_api.py — keep housekeeping's
		# gate tests independent of whatever another test/run left behind.
		for name in frappe.get_all("Approval Policy", {"action": "housekeeping_exception"}, pluck="name"):
			frappe.delete_doc("Approval Policy", name, force=True, ignore_permissions=True)

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def _policy(self, **overrides):
		"""Seed an active Approval Policy for the housekeeping_exception action —
		mirrors approvals/test_api.py's own `_policy` helper. Without a policy,
		require_approval treats the action as ungated (see
		test_no_active_policy_means_exception_path_stays_a_no_op); tests that
		assert blocking need one, same as the framework requires in real use."""
		values = {
			"doctype": "Approval Policy",
			"policy_name": "Housekeeping exception",
			"action": "housekeeping_exception",
			"approver_role": "System Manager",
			"threshold_amount": 0,
			"is_active": 1,
		}
		values.update(overrides)
		return frappe.get_doc(values).insert(ignore_permissions=True)

	def make_inventory_setup(self, suffix):
		property_doc = insert_doc(
			"Resort Property",
			property_name=f"HK Checklist Resort {suffix}",
			property_code=f"HKCL-{suffix}",
			company=f"HK Checklist Company {suffix}",
			timezone="Asia/Kolkata",
		)
		building = insert_doc(
			"Resort Building",
			resort_property=property_doc.name,
			building_name=f"HK Checklist Wing {suffix}",
			building_code="MAIN",
		)
		floor = insert_doc(
			"Resort Floor",
			resort_property=property_doc.name,
			building=building.name,
			floor_label="Ground",
			floor_code="G",
		)
		room_type = insert_doc(
			"Room Type",
			resort_property=property_doc.name,
			room_type_name=f"HK Checklist Deluxe {suffix}",
			room_type_code="DLX",
			standard_adults=2,
			standard_children=0,
			max_occupancy=3,
		)
		room = insert_doc(
			"Room",
			resort_property=property_doc.name,
			building=building.name,
			floor=floor.name,
			room_type=room_type.name,
			room_number=f"HKCL-{suffix}",
			occupancy_status="Vacant",
			housekeeping_status="Dirty",
			maintenance_status="Available",
			sellable_status="Sellable",
		)
		return property_doc, room_type, room

	def make_template(self, suffix, room_type, requires_photo=False):
		template = frappe.get_doc(
			{
				"doctype": "Housekeeping Checklist Template",
				"template_name": f"Departure Checklist {suffix}",
				"task_type": "Departure Cleaning",
				"room_type": room_type.name,
				"inspection_required": 1,
				"estimated_minutes": 20,
				"checklist_items": [
					{
						"section": "Bathroom",
						"item_label": "Bathroom cleaned",
						"mandatory": 1,
						"requires_photo": 1 if requires_photo else 0,
						"pass_fail": 1,
						"sort_order": 1,
					},
					{
						"section": "Bedroom",
						"item_label": "Bed made",
						"mandatory": 0,
						"requires_photo": 0,
						"pass_fail": 1,
						"sort_order": 2,
					},
				],
			}
		)
		template.insert(ignore_permissions=True)
		return template

	def make_started_task(self, suffix, template=None):
		_property_doc, room_type, room = self.make_inventory_setup(suffix)
		template = template or self.make_template(suffix, room_type)
		task = create_task(
			{
				"room": room.name,
				"task_type": "Departure Cleaning",
				"priority": "Normal",
				"checklist_template": template.name,
				"idempotency_key": f"hk-checklist-task-{suffix}",
			}
		)["data"]["task"]
		assign_task(task["name"], assigned_user="Administrator")
		start_task(task["name"])
		return task, template

	def checklist_payload(self, template, photo=None):
		item = template.checklist_items[0]
		payload = {
			"template": template.name,
			"items": [
				{
					"section": item.section,
					"item_label": item.item_label,
					"result": "Pass",
					"notes": "done",
				}
			],
		}
		if photo:
			payload["items"][0]["photo"] = photo
		return payload

	def test_template_and_result_create(self):
		_property_doc, room_type, _room = self.make_inventory_setup("CREATE")
		template = self.make_template("CREATE", room_type)
		result = frappe.get_doc(
			{
				"doctype": "Housekeeping Checklist Result",
				"housekeeping_task": self.make_started_task("CREATE2")[0]["name"],
				"template": template.name,
				"result_status": "Completed",
				"completed_by": "Administrator",
				"completed_at": frappe.utils.now(),
				"result_items": [{"section": "Bathroom", "item_label": "Bathroom cleaned", "result": "Pass"}],
			}
		)
		result.insert(ignore_permissions=True)

		self.assertTrue(template.name)
		self.assertTrue(result.name)
		self.assertEqual(result.result_items[0].item_label, "Bathroom cleaned")

	def test_mandatory_item_missing_is_blocked(self):
		self._policy()
		task, template = self.make_started_task("MANDATORY")

		with self.assertRaises(ApprovalRequired):
			complete_task(task["name"], checklist={"template": template.name, "items": []})
		# A Pending Approval Request was raised for the gate — not a silent pass.
		self.assertTrue(
			frappe.db.exists(
				"Approval Request",
				{"action": "housekeeping_exception", "source_name": task["name"], "state": "Pending"},
			)
		)

	def test_requires_photo_without_photo_is_blocked(self):
		self._policy()
		_property_doc, room_type, _room = self.make_inventory_setup("NOPHOTO")
		template = self.make_template("NOPHOTO", room_type, requires_photo=True)
		task = self.make_started_task("NOPHOTO-TASK", template=template)[0]

		with self.assertRaises(ApprovalRequired):
			complete_task(task["name"], checklist=self.checklist_payload(template))

	def test_requires_photo_with_photo_passes(self):
		_property_doc, room_type, _room = self.make_inventory_setup("PHOTO")
		template = self.make_template("PHOTO", room_type, requires_photo=True)
		task = self.make_started_task("PHOTO-TASK", template=template)[0]

		result = complete_task(
			task["name"],
			checklist=self.checklist_payload(template, photo="/files/bathroom.jpg"),
			notes="completed with photo",
		)["data"]

		self.assertTrue(result["checklist_result"])
		checklist_result = frappe.get_doc("Housekeeping Checklist Result", result["checklist_result"])
		self.assertEqual(checklist_result.result_status, "Completed")
		self.assertEqual(checklist_result.result_items[0].photo, "/files/bathroom.jpg")

	def test_garbage_exception_approval_no_longer_bypasses_requirements(self):
		"""Regression test: an arbitrary, unverified string used to satisfy the
		old `bool(exception_approval or ...)` check and skip both the mandatory-
		item and photo checks entirely. It must no longer do that — the value is
		now resolved through the real Approval Request framework, so a string
		that doesn't name a real, approved request has to fail loudly instead of
		silently letting the room be marked clean with zero cleaning evidence."""
		_property_doc, room_type, _room = self.make_inventory_setup("EXCEPTION")
		template = self.make_template("EXCEPTION", room_type, requires_photo=True)
		task = self.make_started_task("EXCEPTION-TASK", template=template)[0]

		with self.assertRaises(frappe.ValidationError):
			complete_task(
				task["name"],
				checklist={"template": template.name, "items": []},
				exception_approval="HK-EXCEPTION-APPROVAL",
			)
		# The task must not have been marked Completed off the back of the
		# bogus exception string.
		self.assertNotEqual(frappe.db.get_value("Housekeeping Task", task["name"], "task_status"), "Completed")

	def test_exception_approval_calls_the_real_approval_gate(self):
		"""When mandatory items/photos are missing, the checklist validator must
		actually invoke require_approval (the real, audited gate) rather than
		just checking truthiness of the caller-supplied value."""
		_property_doc, room_type, _room = self.make_inventory_setup("GATECALL")
		template = self.make_template("GATECALL", room_type, requires_photo=True)
		task = self.make_started_task("GATECALL-TASK", template=template)[0]

		# A real Approval Request — the exception_approval Link field must
		# point at something that actually exists once the fix lands.
		fake_request = frappe.get_doc(
			{
				"doctype": "Approval Request",
				"action": "housekeeping_exception",
				"state": "Approved",
				"requester": frappe.session.user,
				"requested_at": frappe.utils.now(),
				"source_doctype": "Housekeeping Task",
				"source_name": task["name"],
			}
		).insert(ignore_permissions=True)

		with patch("the_reezort.approvals.api.require_approval") as mock_require_approval:
			mock_require_approval.return_value = (True, fake_request.name)
			result = complete_task(
				task["name"],
				checklist={"template": template.name, "items": []},
				exception_approval="whatever-the-client-sent",
			)["data"]

		mock_require_approval.assert_called_once()
		_args, kwargs = mock_require_approval.call_args
		self.assertEqual(kwargs["action"], "housekeeping_exception")
		self.assertEqual(kwargs["source_doctype"], "Housekeeping Task")
		self.assertEqual(kwargs["source_name"], task["name"])
		self.assertEqual(kwargs["approval_request"], "whatever-the-client-sent")
		self.assertIn("Bathroom cleaned", kwargs["payload"]["missing_mandatory"])

		self.assertTrue(result["checklist_result"])
		checklist_result = frappe.get_doc("Housekeeping Checklist Result", result["checklist_result"])
		self.assertEqual(checklist_result.result_status, "Exception Approved")
		# The Link field now stores what require_approval returned, not the
		# raw client-supplied string.
		self.assertEqual(
			frappe.db.get_value("Housekeeping Task", task["name"], "exception_approval"), fake_request.name,
		)

	def test_no_active_policy_means_exception_path_stays_a_no_op(self):
		"""Documented require_approval semantics: with no `exception_approval`
		supplied and no active Approval Policy for `housekeeping_exception`,
		_resolve_policy returns None and require_approval short-circuits to
		(True, None) — a no-op — matching current real-world behavior while
		nothing is configured yet. This is NOT the old bug reappearing: no
		caller-supplied string is being trusted here, the call genuinely goes
		through require_approval's policy resolution, and once a policy for
		`housekeeping_exception` is configured this becomes a real, enforced
		gate (see test_exception_approval_calls_the_real_approval_gate and
		test_garbage_exception_approval_no_longer_bypasses_requirements for the
		guarded paths)."""
		_property_doc, room_type, _room = self.make_inventory_setup("NOPOLICY")
		template = self.make_template("NOPOLICY", room_type, requires_photo=True)
		task = self.make_started_task("NOPOLICY-TASK", template=template)[0]
		self.assertFalse(frappe.db.exists("Approval Policy", {"action": "housekeeping_exception", "is_active": 1}))

		result = complete_task(
			task["name"],
			checklist={"template": template.name, "items": []},
		)["data"]

		self.assertTrue(result["checklist_result"])
		checklist_result = frappe.get_doc("Housekeeping Checklist Result", result["checklist_result"])
		self.assertEqual(checklist_result.result_status, "Exception Approved")

	def test_completion_persists_result_items_and_photos(self):
		_property_doc, room_type, _room = self.make_inventory_setup("PERSIST")
		template = self.make_template("PERSIST", room_type, requires_photo=True)
		task = self.make_started_task("PERSIST-TASK", template=template)[0]

		result = complete_task(
			task["name"],
			checklist=self.checklist_payload(template, photo="/files/persist.jpg"),
			notes="persist result",
		)["data"]

		checklist_result = frappe.get_doc("Housekeeping Checklist Result", result["checklist_result"])
		self.assertEqual(checklist_result.housekeeping_task, task["name"])
		self.assertEqual(checklist_result.template, template.name)
		self.assertEqual(checklist_result.notes, "persist result")
		self.assertEqual(checklist_result.result_items[0].photo, "/files/persist.jpg")
