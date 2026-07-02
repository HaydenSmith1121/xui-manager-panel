import tempfile
import unittest
from pathlib import Path

from xui_manager.db import Database


class BalanceCommerceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Database(Path(self.tmp.name) / "commerce.db")
        self.db.init_schema()
        self.admin = self.db.seed_admin("admin@example.com", "password123")
        self.user = self.db.register_user("buyer@example.com", "password123")

    def test_schema_migration_adds_balance_price_notes_and_recharge_tables(self):
        conn = self.db.connect()
        try:
            plan_columns = {row["name"] for row in conn.execute("pragma table_info(plans)")}
            user_columns = {row["name"] for row in conn.execute("pragma table_info(users)")}
            tables = {row["name"] for row in conn.execute("select name from sqlite_master where type='table'")}
        finally:
            conn.close()

        self.assertIn("price_cents", plan_columns)
        self.assertTrue({"balance_cents", "admin_note", "is_priority"}.issubset(user_columns))
        self.assertTrue({"recharge_cards", "balance_transactions"}.issubset(tables))

    def test_purchase_plan_deducts_balance_activates_plan_and_resets_usage(self):
        plan_id = self.db.create_plan("Pro", 100, 30, [], False, price_cents=1299)
        node_id = self.db.create_node("Static", "vless://id@example.com:443#node", 1, [], True)
        self.db.record_usage(self.user["id"], node_id, 100, 200)
        self.db.adjust_user_balance(self.user["id"], 2000, "initial credit", self.admin["id"])

        purchased = self.db.purchase_plan(self.user["id"], plan_id)

        self.assertEqual(purchased["balance_cents"], 701)
        self.assertEqual(purchased["status"], "active")
        self.assertEqual(purchased["plan_id"], plan_id)
        self.assertEqual(self.db.usage_for_user(self.user["id"]), [])
        transactions = self.db.list_balance_transactions(self.user["id"])
        self.assertEqual(transactions[0]["kind"], "purchase")
        self.assertEqual(transactions[0]["amount_cents"], -1299)
        self.assertEqual(transactions[0]["balance_after_cents"], 701)

    def test_purchase_with_insufficient_balance_is_atomic(self):
        plan_id = self.db.create_plan("Premium", 300, 30, [], False, price_cents=5000)

        with self.assertRaisesRegex(ValueError, "余额不足"):
            self.db.purchase_plan(self.user["id"], plan_id)

        unchanged = self.db.get_user(self.user["id"])
        self.assertEqual(unchanged["balance_cents"], 0)
        self.assertEqual(unchanged["status"], "unsubscribed")
        self.assertEqual(self.db.list_balance_transactions(self.user["id"]), [])

    def test_recharge_card_can_only_be_redeemed_once(self):
        cards = self.db.create_recharge_cards(2500, 1, self.admin["id"])

        redeemed = self.db.redeem_recharge_card(self.user["id"], cards[0]["code"])

        self.assertEqual(redeemed["balance_cents"], 2500)
        with self.assertRaisesRegex(ValueError, "无效或已使用"):
            self.db.redeem_recharge_card(self.user["id"], cards[0]["code"])
        listed = self.db.list_recharge_cards()
        self.assertEqual(listed[0]["status"], "used")
        self.assertNotIn("code_hash", listed[0])
        self.assertNotIn(cards[0]["code"], str(listed[0]))

    def test_admin_adjustment_rejects_negative_result_and_note_marks_priority_user(self):
        credited = self.db.adjust_user_balance(self.user["id"], 800, "service credit", self.admin["id"])
        noted = self.db.update_user_note(self.user["id"], "长期客户", True)

        self.assertEqual(credited["balance_cents"], 800)
        self.assertEqual(noted["admin_note"], "长期客户")
        self.assertTrue(noted["is_priority"])
        with self.assertRaisesRegex(ValueError, "余额不能为负数"):
            self.db.adjust_user_balance(self.user["id"], -801, "invalid", self.admin["id"])
        self.assertEqual(self.db.get_user(self.user["id"])["balance_cents"], 800)


if __name__ == "__main__":
    unittest.main()
