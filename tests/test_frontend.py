from pathlib import Path
import unittest


class FrontendTests(unittest.TestCase):
    def test_async_form_errors_are_shown_to_user(self):
        app_js = Path(__file__).resolve().parents[1] / "static" / "app.js"
        text = app_js.read_text(encoding="utf-8")

        self.assertIn('window.addEventListener("unhandledrejection"', text)
        self.assertIn("showNotice(message)", text)
        self.assertIn("event.preventDefault()", text)

    def test_save_feedback_stays_visible_and_forms_lock_while_submitting(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        app_css = (root / "static" / "app.css").read_text(encoding="utf-8")

        self.assertIn("async function withSubmitState", app_js)
        self.assertIn('form.dataset.submitting === "true"', app_js)
        self.assertIn("button.disabled = true", app_js)
        self.assertIn("button.disabled = false", app_js)
        self.assertIn("position: fixed", app_css)
        self.assertIn("z-index: 100", app_css)

    def test_plan_and_panel_lists_offer_delete_actions(self):
        app_js = (Path(__file__).resolve().parents[1] / "static" / "app.js").read_text(encoding="utf-8")

        self.assertIn("data-delete-plan", app_js)
        self.assertIn("data-delete-panel", app_js)
        self.assertIn("/api/admin/plans/delete", app_js)
        self.assertIn("/api/admin/panels/delete", app_js)


if __name__ == "__main__":
    unittest.main()
