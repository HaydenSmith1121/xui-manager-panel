from pathlib import Path
import unittest


class FrontendTests(unittest.TestCase):
    def test_async_form_errors_are_shown_to_user(self):
        app_js = Path(__file__).resolve().parents[1] / "static" / "app.js"
        text = app_js.read_text(encoding="utf-8")

        self.assertIn('window.addEventListener("unhandledrejection"', text)
        self.assertIn("showNotice(message)", text)
        self.assertIn("event.preventDefault()", text)


if __name__ == "__main__":
    unittest.main()
