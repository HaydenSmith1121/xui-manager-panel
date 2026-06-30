import json
import tempfile
import unittest
from pathlib import Path

from xui_manager.db import Database
from xui_manager.subscription import build_clash_subscription


VLESS = "vless://template@example.com:443?security=tls&sni=edge.example&type=ws&path=%2Fedge#Managed"
TROJAN = "trojan://pass@static.example.com:443?sni=static.example.com#Static"


class ManagedSubscriptionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Database(Path(self.tmp.name) / "app.db")
        self.db.init_schema()
        self.plan_id = self.db.create_plan("Premium", 100, 30, ["premium"], True)
        self.panel_id = self.db.create_panel("Panel", "https://panel.example.com", "admin", "secret")
        self.db.create_node("Managed", VLESS, 1, ["premium"], True, self.panel_id, 7, "managed")

    def active_user(self, email):
        user = self.db.register_user(email, "secret123", self.plan_id)
        return self.db.approve_user(user["id"])

    def provisioned_client(self, user):
        client = self.db.ensure_managed_client(user["id"], self.panel_id, 7, "vless", "", 1, user["expire_at"])
        self.db.update_managed_client_result(client["id"], state="provisioned", remote_enabled=True, error="")
        return self.db.get_managed_client(client["id"])

    def response_json(self, user):
        response = build_clash_subscription(self.db, user["token"])
        self.assertEqual(response.status, 200)
        return response, json.loads(response.body)

    def test_users_receive_distinct_uuids_without_changing_transport(self):
        first = self.active_user("one@example.com")
        second = self.active_user("two@example.com")
        first_client = self.provisioned_client(first)
        second_client = self.provisioned_client(second)

        first_response, first_body = self.response_json(first)
        second_response, second_body = self.response_json(second)

        self.assertIn(first_client["client_uuid"], first_response.body)
        self.assertNotIn(second_client["client_uuid"], first_response.body)
        self.assertIn(second_client["client_uuid"], second_response.body)
        self.assertNotEqual(first_body["proxies"][0]["uuid"], second_body["proxies"][0]["uuid"])
        self.assertEqual(first_body["proxies"][0]["servername"], "edge.example")
        self.assertEqual(first_body["proxies"][0]["network"], "ws")
        self.assertEqual(first_body["proxies"][0]["ws-opts"]["path"], "/edge")

    def test_pending_or_failed_managed_targets_are_omitted_but_static_nodes_remain(self):
        user = self.active_user("user@example.com")
        self.db.create_node("Static", TROJAN, 1, ["premium"])
        pending = self.db.ensure_managed_client(user["id"], self.panel_id, 7, "vless", "", 1, user["expire_at"])
        self.db.update_managed_client_result(pending["id"], state="failed", remote_enabled=False, error="failed")

        _, body = self.response_json(user)

        self.assertEqual([proxy["name"] for proxy in body["proxies"]], ["Static"])
        self.assertNotIn("template", json.dumps(body))

    def test_header_uses_separate_weighted_upload_and_download_totals(self):
        user = self.active_user("user@example.com")
        client = self.provisioned_client(user)
        self.db.advance_usage_ledger(client["id"], 10, 20, 3)

        response, _ = self.response_json(user)

        self.assertIn("upload=30; download=60;", response.headers["Subscription-Userinfo"])

    def test_exhausted_valid_token_returns_empty_200_with_metadata(self):
        tiny_plan = self.db.create_plan("Tiny", 0.000001, 30, ["premium"], True)
        user = self.db.register_user("user@example.com", "secret123", tiny_plan)
        user = self.db.approve_user(user["id"])
        client = self.provisioned_client(user)
        self.db.advance_usage_ledger(client["id"], 10 * 1024 * 1024, 0, 1)

        response, body = self.response_json(user)

        self.assertEqual(body["proxies"], [])
        self.assertIn("total=", response.headers["Subscription-Userinfo"])


if __name__ == "__main__":
    unittest.main()
