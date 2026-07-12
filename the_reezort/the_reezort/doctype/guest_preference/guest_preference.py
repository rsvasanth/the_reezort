from frappe.model.document import Document


class GuestPreference(Document):
    def validate(self):
        if not self.sensitivity:
            self.sensitivity = "Normal"
        if self.is_active is None:
            self.is_active = 1
