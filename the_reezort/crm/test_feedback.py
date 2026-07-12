"""
Unit tests for the_reezort.crm.feedback
"""

import unittest
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase


class TestSentimentDerivation(FrappeTestCase):
    """Pure logic — no DB interaction."""

    def _derive(self, score):
        from the_reezort.crm.feedback import _derive_sentiment
        return _derive_sentiment(score)

    def test_promoter_is_positive(self):
        self.assertEqual(self._derive(9), "Positive")
        self.assertEqual(self._derive(10), "Positive")

    def test_passive_is_neutral(self):
        self.assertEqual(self._derive(7), "Neutral")
        self.assertEqual(self._derive(8), "Neutral")

    def test_detractor_is_negative(self):
        self.assertEqual(self._derive(0), "Negative")
        self.assertEqual(self._derive(5), "Negative")
        self.assertEqual(self._derive(6), "Negative")


class TestFollowUpThreshold(FrappeTestCase):
    """Verify threshold lookup with and without CRM Settings."""

    def test_default_threshold_when_doctype_absent(self):
        from the_reezort.crm.feedback import _DEFAULT_FOLLOW_UP_SCORE, _get_follow_up_threshold

        with patch("frappe.db.exists", return_value=False):
            result = _get_follow_up_threshold()
        self.assertEqual(result, _DEFAULT_FOLLOW_UP_SCORE)

    def test_configured_threshold_returned(self):
        from the_reezort.crm.feedback import _get_follow_up_threshold

        def mock_exists(doctype, name=None):
            return True

        with patch("frappe.db.exists", side_effect=mock_exists), \
             patch("frappe.db.get_value", return_value=7):
            result = _get_follow_up_threshold()
        self.assertEqual(result, 7)


class TestSubmitFeedback(FrappeTestCase):
    """Integration-style tests using FrappeTestCase DB fixtures."""

    def _make_feedback_doc(self, **kwargs):
        """Helper to create a Guest Feedback doc directly (bypasses endpoint auth)."""
        from frappe.utils import now_datetime
        defaults = {
            "doctype": "Guest Feedback",
            "context": "Post Stay",
            "nps_score": 8,
            "submitted_at": now_datetime(),
            "status": "New",
        }
        defaults.update(kwargs)
        doc = frappe.get_doc(defaults)
        doc.insert(ignore_permissions=True)
        return doc

    def test_submit_creates_record_with_correct_sentiment(self):
        doc = self._make_feedback_doc(nps_score=9)
        self.assertEqual(doc.sentiment, "Positive")

    def test_passive_score_sets_neutral_sentiment(self):
        doc = self._make_feedback_doc(nps_score=7)
        self.assertEqual(doc.sentiment, "Neutral")

    def test_detractor_score_sets_negative_sentiment(self):
        doc = self._make_feedback_doc(nps_score=4)
        self.assertEqual(doc.sentiment, "Negative")

    def test_nps_score_out_of_range_raises(self):
        with self.assertRaises(frappe.ValidationError):
            self._make_feedback_doc(nps_score=11)

    def test_low_nps_triggers_follow_up_in_endpoint(self):
        """submit_feedback endpoint sets Follow Up Required for low NPS."""
        from the_reezort.crm.feedback import submit_feedback

        # Patch permission check and complaint creation to isolate logic
        with patch("the_reezort.crm.feedback._require_permission"), \
             patch("the_reezort.crm.feedback._get_follow_up_threshold", return_value=6), \
             patch("the_reezort.crm.feedback._try_create_complaint", return_value=None):
            result = submit_feedback(
                payload={
                    "nps_score": 4,
                    "context": "Post Stay",
                    "comments": "Disappointed with room service.",
                }
            )

        self.assertTrue(result["data"]["follow_up_required"])
        self.assertEqual(result["data"]["status"], "Follow Up Required")

    def test_high_nps_does_not_trigger_follow_up(self):
        """NPS above threshold keeps status New."""
        from the_reezort.crm.feedback import submit_feedback

        with patch("the_reezort.crm.feedback._require_permission"), \
             patch("the_reezort.crm.feedback._get_follow_up_threshold", return_value=6), \
             patch("the_reezort.crm.feedback._try_create_complaint", return_value=None):
            result = submit_feedback(
                payload={
                    "nps_score": 9,
                    "context": "Post Stay",
                    "comments": "Great stay!",
                }
            )

        self.assertFalse(result["data"]["follow_up_required"])
        self.assertEqual(result["data"]["status"], "New")

    def test_negative_sentiment_triggers_follow_up_without_nps(self):
        """Explicit Negative sentiment triggers follow-up even without nps_score."""
        from the_reezort.crm.feedback import submit_feedback

        with patch("the_reezort.crm.feedback._require_permission"), \
             patch("the_reezort.crm.feedback._get_follow_up_threshold", return_value=6), \
             patch("the_reezort.crm.feedback._try_create_complaint", return_value=None):
            result = submit_feedback(
                payload={
                    "sentiment": "Negative",
                    "comments": "Bad experience.",
                }
            )

        self.assertTrue(result["data"]["follow_up_required"])

    def test_missing_all_fields_raises(self):
        from the_reezort.crm.feedback import submit_feedback

        with patch("the_reezort.crm.feedback._require_permission"), \
             self.assertRaises(frappe.MandatoryError):
            submit_feedback(payload={})

    def tearDown(self):
        frappe.db.rollback()


class TestSeedFeedback(FrappeTestCase):
    """Verify the seeder is idempotent."""

    def test_seed_creates_default_question_set(self):
        from the_reezort.crm.seed_feedback import _DEFAULT_SET_NAME, run

        # Ensure clean state
        if frappe.db.exists("Feedback Question Set", _DEFAULT_SET_NAME):
            frappe.delete_doc("Feedback Question Set", _DEFAULT_SET_NAME, ignore_permissions=True)

        run()
        self.assertTrue(frappe.db.exists("Feedback Question Set", _DEFAULT_SET_NAME))

    def test_seed_is_idempotent(self):
        from the_reezort.crm.seed_feedback import _DEFAULT_SET_NAME, run

        run()
        run()  # second call must not raise
        count = frappe.db.count("Feedback Question Set", {"name": _DEFAULT_SET_NAME})
        self.assertEqual(count, 1)

    def tearDown(self):
        frappe.db.rollback()


if __name__ == "__main__":
    unittest.main()
