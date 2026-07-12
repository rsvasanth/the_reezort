import frappe
from frappe.model.document import Document


class FeedbackQuestionSet(Document):
    def validate(self):
        self._sort_questions()

    def _sort_questions(self):
        for idx, q in enumerate(self.questions or [], start=1):
            if not q.sort_order:
                q.sort_order = idx
