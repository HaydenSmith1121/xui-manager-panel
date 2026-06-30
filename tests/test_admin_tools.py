from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from tools.reset_admin import reset_admin
from xui_manager.db import Database


class AdminToolTests(unittest.TestCase):
    def test_reset_admin_creates_and_updates_admin_login(self):
        with TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "app.db"
            db = Database(db_path)
            db.init_schema()

            reset_admin(db_path, "admin@admin.com", "first-pass")
            self.assertIsNotNone(db.authenticate("admin@admin.com", "first-pass"))

            reset_admin(db_path, "admin@admin.com", "second-pass")
            self.assertIsNone(db.authenticate("admin@admin.com", "first-pass"))
            user = db.authenticate("admin@admin.com", "second-pass")
            self.assertEqual(user["role"], "admin")
            self.assertEqual(user["status"], "active")


if __name__ == "__main__":
    unittest.main()
