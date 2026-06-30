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
        self.assertIn('form.querySelector("button[type=submit]")', app_js)
        self.assertIn("position: fixed", app_css)
        self.assertIn("z-index: 100", app_css)

    def test_plan_and_panel_lists_offer_delete_actions(self):
        app_js = (Path(__file__).resolve().parents[1] / "static" / "app.js").read_text(encoding="utf-8")

        self.assertIn("data-delete-plan", app_js)
        self.assertIn("data-delete-panel", app_js)
        self.assertIn("/api/admin/plans/delete", app_js)
        self.assertIn("/api/admin/panels/delete", app_js)

    def test_node_list_offers_delete_action(self):
        app_js = (Path(__file__).resolve().parents[1] / "static" / "app.js").read_text(encoding="utf-8")

        self.assertIn("data-delete-node", app_js)
        self.assertIn("/api/admin/nodes/delete", app_js)
        self.assertIn("节点已删除", app_js)

    def test_plan_and_panel_forms_have_explicit_create_modes(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="newPlanBtn"', index_html)
        self.assertIn('id="newPanelBtn"', index_html)
        self.assertIn('id="planFormTitle"', index_html)
        self.assertIn('id="panelFormTitle"', index_html)
        self.assertIn("function resetPlanForm", app_js)
        self.assertIn("function resetPanelForm", app_js)
        self.assertIn('form.elements.id.value = ""', app_js)
        self.assertIn('title.textContent = `编辑${label}', app_js)

    def test_frontend_offers_logout_and_clears_local_session_state(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="logoutBtn"', index_html)
        self.assertIn('api("/api/logout"', app_js)
        self.assertIn("state.me = null", app_js)
        self.assertIn('$("#loginForm").reset()', app_js)
        self.assertIn('showNotice("已退出登录")', app_js)

    def test_frontend_exposes_managed_provisioning_actions(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")

        self.assertIn("data-retry-provision", app_js)
        self.assertIn("data-reconcile-user", app_js)
        self.assertIn("/api/admin/users/provision/retry", app_js)
        self.assertIn("/api/admin/users/reconcile", app_js)
        self.assertIn("provisioningSummary", app_js)

    def test_frontend_exposes_panel_testing_and_inbound_picker(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn("data-test-panel", app_js)
        self.assertIn("data-fetch-inbounds", app_js)
        self.assertIn("/api/admin/panels/test", app_js)
        self.assertIn("/api/admin/panels/inbounds", app_js)
        self.assertIn('id="inboundOptions"', index_html)

    def test_frontend_exposes_sync_settings_form(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="settingsForm"', index_html)
        self.assertIn('name="sync_interval_seconds"', index_html)
        self.assertIn("/api/admin/settings", app_js)
        self.assertIn("renderSettings", app_js)

    def test_panel_password_field_explains_blank_edit_behavior(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="panelPasswordHelp"', index_html)
        self.assertIn("留空保留已保存密码", index_html)
        self.assertIn("panelPasswordHelp", app_js)


if __name__ == "__main__":
    unittest.main()
