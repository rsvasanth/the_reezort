"""
Seed a default "Post-Stay Survey" Feedback Question Set so the Feedback
Dashboard has something to display on a fresh site.

Run via: bench execute the_reezort.crm.seed_feedback.run
Also called by bench migrate hooks if wired in hooks.py.
"""

import frappe

_DEFAULT_SET_NAME = "Post-Stay Survey"


def run():
    """Idempotent: creates the default question set if it does not exist."""
    if frappe.db.exists("Feedback Question Set", _DEFAULT_SET_NAME):
        return  # already seeded

    doc = frappe.get_doc(
        {
            "doctype": "Feedback Question Set",
            "question_set_name": _DEFAULT_SET_NAME,
            "context": "Post Stay",
            "is_active": 1,
            "questions": [
                {
                    "question_text": "How likely are you to recommend The Reezort to a friend or colleague?",
                    "response_type": "NPS",
                    "is_required": 1,
                    "sort_order": 1,
                },
                {
                    "question_text": "How would you rate your overall stay experience?",
                    "response_type": "Rating",
                    "is_required": 1,
                    "sort_order": 2,
                },
                {
                    "question_text": "What did you enjoy most during your stay?",
                    "response_type": "Text",
                    "is_required": 0,
                    "sort_order": 3,
                },
                {
                    "question_text": "What can we improve for your next visit?",
                    "response_type": "Text",
                    "is_required": 0,
                    "sort_order": 4,
                },
            ],
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
