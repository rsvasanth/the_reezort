import frappe
from frappe import _
from frappe.model.document import Document


class GuestFeedback(Document):
    def validate(self):
        self._validate_nps_score()
        self._derive_sentiment()

    def _validate_nps_score(self):
        if self.nps_score is not None:
            if not (0 <= int(self.nps_score) <= 10):
                frappe.throw(_("NPS Score must be between 0 and 10."), frappe.ValidationError)

    def _derive_sentiment(self):
        if not self.sentiment and self.nps_score is not None:
            score = int(self.nps_score)
            if score >= 9:
                self.sentiment = "Positive"
            elif score >= 7:
                self.sentiment = "Neutral"
            else:
                self.sentiment = "Negative"
