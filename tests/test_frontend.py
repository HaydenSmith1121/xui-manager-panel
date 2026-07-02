from pathlib import Path
import unittest


class FrontendTests(unittest.TestCase):
    def test_public_storefront_and_authentication_are_separate(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="storefrontView"', index_html)
        self.assertIn('id="planCatalog"', index_html)
        self.assertIn('id="authDialog"', index_html)
        self.assertIn('data-auth-tab="login"', index_html)
        self.assertIn('data-auth-tab="register"', index_html)
        self.assertNotIn('id="registerPlan"', index_html)
        self.assertIn("pendingPlanId", app_js)
        self.assertIn("data-apply-plan", app_js)
        self.assertIn('/api/purchases', app_js)
        self.assertIn("submitPurchase", app_js)

    def test_frontend_has_deliberate_desktop_mobile_and_slow_loading_states(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        app_css = (root / "static" / "app.css").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="mobileNav"', index_html)
        self.assertIn('id="slowLoader"', index_html)
        self.assertIn('id="userCardList"', index_html)
        self.assertIn(".storefront", app_css)
        self.assertIn(".plan-catalog", app_css)
        self.assertIn(".mobile-nav", app_css)
        self.assertIn(".user-card-list", app_css)
        self.assertIn("position: fixed", app_css)
        self.assertIn("@media (max-width: 920px)", app_css)
        self.assertIn("prefers-reduced-motion: reduce", app_css)
        self.assertIn("loadingCount", app_js)
        self.assertIn("600", app_js)
        self.assertIn("elapsed", app_js)

    def test_disabled_user_delete_action_calls_admin_endpoint(self):
        app_js = (Path(__file__).resolve().parents[1] / "static" / "app.js").read_text(encoding="utf-8")

        self.assertIn("data-delete-user", app_js)
        self.assertIn('/api/admin/users/delete', app_js)
        self.assertIn('user.status === "disabled"', app_js)

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

    def test_subscription_copy_falls_back_without_clipboard_api(self):
        app_js = (Path(__file__).resolve().parents[1] / "static" / "app.js").read_text(encoding="utf-8")

        self.assertIn("async function copyTextFromInput", app_js)
        self.assertIn("navigator.clipboard", app_js)
        self.assertIn("document.execCommand", app_js)
        self.assertIn("input.select()", app_js)

    def test_frontend_exposes_managed_provisioning_actions(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")

        self.assertIn("data-retry-provision", app_js)
        self.assertIn("data-reconcile-user", app_js)
        self.assertIn("/api/admin/users/provision/retry", app_js)
        self.assertIn("/api/admin/users/reconcile", app_js)
        self.assertIn("provisioningSummary", app_js)
        self.assertIn("provisioningErrorSummary", app_js)
        self.assertIn("provisioning_errors", app_js)

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
        self.assertIn('name="subscription_title"', index_html)
        self.assertIn("/api/admin/settings", app_js)
        self.assertIn("renderSettings", app_js)

    def test_panel_password_field_explains_blank_edit_behavior(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="panelPasswordHelp"', index_html)
        self.assertIn("留空保留已保存密码", index_html)
        self.assertIn("panelPasswordHelp", app_js)

    def test_plan_and_panel_create_actions_open_list_level_dialogs(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="planDialog"', index_html)
        self.assertIn('id="panelDialog"', index_html)
        self.assertIn('id="newPlanBtn"', index_html)
        self.assertIn('id="newPanelBtn"', index_html)
        self.assertIn('name="price_yuan"', index_html)
        self.assertIn('$("#planDialog").showModal()', app_js)
        self.assertIn('$("#panelDialog").showModal()', app_js)

    def test_balance_purchase_recharge_and_multi_client_subscription_controls_exist(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="balanceText"', index_html)
        self.assertIn('id="rechargeForm"', index_html)
        self.assertIn('data-sub-format="clash"', index_html)
        self.assertIn('data-sub-format="base64"', index_html)
        self.assertIn('data-sub-format="singbox"', index_html)
        self.assertIn('/api/recharge', app_js)
        self.assertIn('/api/purchases', app_js)
        self.assertIn("subscription_urls", app_js)
        self.assertNotIn("state.me.email ||", app_js)

    def test_personal_center_avatar_profile_and_settings_exist(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        app_css = (root / "static" / "app.css").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        for marker in (
            'id="profileEntryBtn"',
            'id="profileView"',
            'id="profileAvatarInput"',
            'id="expireReminderToggle"',
            'id="trafficReminderToggle"',
            'id="autoRenewToggle"',
            'id="profileGiftCardForm"',
            'id="profileGiftCardBalance"',
            'id="profilePasswordForm"',
            'id="profileSubscriptionUrl"',
            "礼品卡兑换",
            "复制订阅链接",
        ):
            self.assertIn(marker, index_html)
        self.assertIn("renderProfile", app_js)
        self.assertIn("data-copy-profile-sub", app_js)
        self.assertIn("/api/me/password", app_js)
        self.assertIn("礼品卡兑换成功，余额已到账", app_js)
        self.assertIn('$("#sessionEmail").textContent = loggedIn ? state.me.email : "游客"', app_js)
        self.assertIn(".profile-entry", app_css)
        self.assertIn(".profile-sections", app_css)
        self.assertIn(".gift-card-panel", app_css)

    def test_user_list_has_search_filters_collapse_notes_and_balance_tools(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        for marker in ('id="userSearch"', 'id="userStatusFilter"', 'id="userRoleFilter"', 'id="priorityFilter"', 'id="toggleUserListBtn"'):
            self.assertIn(marker, index_html)
        self.assertIn("data-user-note-form", app_js)
        self.assertIn("data-user-balance-form", app_js)
        self.assertIn('/api/admin/users/note', app_js)
        self.assertIn('/api/admin/users/balance', app_js)
        self.assertIn("filteredUsers", app_js)

    def test_admin_recharge_card_generator_is_available(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="rechargeCardForm"', index_html)
        self.assertIn('id="rechargeCardList"', index_html)
        self.assertIn('/api/admin/recharge-cards', app_js)
        self.assertIn("generatedCardCodes", app_js)


if __name__ == "__main__":
    unittest.main()
