import json
import tempfile
import unittest
from pathlib import Path

from xui_manager.app import create_app
from xui_manager.billing import bytes_from_gb, calculate_billable_usage
from xui_manager.db import Database
from xui_manager.subscription import build_clash_subscription


class BillingTests(unittest.TestCase):
    def test_calculates_billable_usage_with_node_rates(self):
        usage = calculate_billable_usage(
            [
                {"upload": bytes_from_gb(1), "download": bytes_from_gb(2), "rate": 1},
                {"upload": bytes_from_gb(1), "download": 0, "rate": 3},
                {"upload": 0, "download": bytes_from_gb(2), "rate": 0.5},
            ]
        )

        self.assertEqual(usage, bytes_from_gb(7))


class DatabaseTests(unittest.TestCase):
    def test_user_registers_pending_and_admin_approves(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Database(Path(tmp) / "app.db")
            db.init_schema()
            plan_id = db.create_plan(
                name="Standard 500G",
                quota_gb=500,
                duration_days=30,
                allowed_tags=["standard"],
                require_approval=True,
            )

            user = db.register_user("user@example.com", "secret123", plan_id)
            self.assertEqual(user["status"], "pending")
            self.assertTrue(user["token"])

            approved = db.approve_user(user["id"])
            self.assertEqual(approved["status"], "active")
            self.assertGreater(approved["expire_at"], 0)
            self.assertEqual(approved["quota_bytes"], bytes_from_gb(500))


class SubscriptionTests(unittest.TestCase):
    def test_subscription_uses_plan_quota_and_weighted_usage(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Database(Path(tmp) / "app.db")
            db.init_schema()
            plan_id = db.create_plan(
                name="Pro 1000G",
                quota_gb=1000,
                duration_days=30,
                allowed_tags=["standard", "premium"],
                require_approval=True,
            )
            user = db.register_user("user@example.com", "secret123", plan_id)
            db.approve_user(user["id"])
            node_id = db.create_node(
                name="Japan Premium",
                source_url="vless://11111111-1111-1111-1111-111111111111@example.com:443?security=tls&type=tcp&sni=example.com#JP",
                rate=3,
                tags=["premium"],
                enabled=True,
            )
            db.record_usage(user["id"], node_id, upload=bytes_from_gb(1), download=0)

            response = build_clash_subscription(db, user["token"])

        self.assertEqual(response.status, 200)
        self.assertIn("Subscription-Userinfo", response.headers)
        self.assertIn("download=3221225472", response.headers["Subscription-Userinfo"])
        self.assertIn("total=1073741824000", response.headers["Subscription-Userinfo"])
        self.assertIn("Japan Premium", response.body)


class AppTests(unittest.TestCase):
    def test_register_endpoint_creates_pending_user(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = create_app(Path(tmp) / "app.db")
            app.db.create_plan("Trial 100G", 100, 30, ["standard"], True)

            response = app.handle_json(
                "POST",
                "/api/register",
                {},
                json.dumps({"email": "new@example.com", "password": "secret123", "plan_id": 1}),
            )

        self.assertEqual(response.status, 200)
        payload = json.loads(response.body)
        self.assertEqual(payload["user"]["status"], "pending")
        self.assertTrue(payload["user"]["token"])


if __name__ == "__main__":
    unittest.main()
