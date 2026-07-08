from pathlib import Path
import unittest


class FrontendTests(unittest.TestCase):
    def test_page_declares_favicon_asset(self):
        root = Path(__file__).resolve().parents[1]
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")
        favicon = root / "static" / "favicon.svg"

        self.assertIn('<link rel="icon" type="image/svg+xml" href="/favicon.svg">', index_html)
        self.assertTrue(favicon.exists())
        self.assertIn("<svg", favicon.read_text(encoding="utf-8"))

    def test_mobile_login_dialog_has_non_dialog_browser_fallback(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        app_css = (root / "static" / "app.css").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="mobileAccountBtn" type="button" class="avatar-button"', index_html)
        self.assertNotIn('id="mobileAccountBtn" type="button" class="avatar-button" data-open-auth', index_html)
        self.assertIn("function openModalDialog", app_js)
        self.assertIn('typeof dialog.showModal === "function"', app_js)
        self.assertIn('dialog.setAttribute("open", "")', app_js)
        self.assertIn('dialog.classList.add("dialog-fallback-open")', app_js)
        self.assertIn(".dialog-fallback-open", app_css)

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
        self.assertIn('DEFAULT_STORE_PLANS', app_js)
        self.assertIn('入门套餐', app_js)
        self.assertIn('日常套餐', app_js)
        self.assertIn('畅享套餐', app_js)
        self.assertNotIn('暂无可购买套餐，请联系管理员。', app_js)
        self.assertIn('id="plansSubtitle"', index_html)
        self.assertIn('购买套餐', app_js)
        self.assertIn('三款套餐均可购买，余额充足后可直接开通。', app_js)

    def test_home_and_storefront_are_separate_views(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="homeView"', index_html)
        self.assertIn('id="storefrontView"', index_html)

        desktop_nav_start = index_html.index('<nav class="nav">')
        desktop_nav = index_html[desktop_nav_start:index_html.index('</nav>', desktop_nav_start)]
        self.assertNotIn('data-view="home"><span>首页</span>', desktop_nav)
        self.assertIn('data-view="storefront"><span>套餐中心</span>', desktop_nav)
        self.assertIn('class="brand brand-button" type="button" data-view="home"', index_html)

        mobile_nav_start = index_html.index('id="mobileNav"')
        mobile_nav = index_html[mobile_nav_start:index_html.index('</nav>', mobile_nav_start)]
        self.assertNotIn('data-view="home"><span>首页</span>', mobile_nav)
        self.assertIn('data-view="storefront"><span>套餐中心</span>', mobile_nav)

        self.assertIn('view: "home"', app_js)
        self.assertIn('view = "home"', app_js)
        self.assertIn('setView("storefront")', app_js)

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
        self.assertIn("Authenticated storefront: only show purchasable plans", app_css)
        self.assertIn("body.is-authed #guestHero", app_css)
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
        self.assertNotIn('<div class="session">', index_html)
        profile_start = index_html.index('id="profileView"')
        profile_block = index_html[profile_start:index_html.index('id="adminView"', profile_start)]
        self.assertIn('id="logoutBtn"', profile_block)
        self.assertIn('api("/api/logout"', app_js)
        self.assertIn("state.me = null", app_js)
        self.assertIn('$("#loginForm").reset()', app_js)
        self.assertIn('setView("home")', app_js)
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
        self.assertIn('Clash Verge / Mihomo（支持 VLESS；旧版 Clash 可能不兼容）', index_html)
        self.assertIn('data-sub-format="clash"', index_html)
        self.assertIn('data-sub-format="base64"', index_html)
        self.assertIn('data-sub-format="singbox"', index_html)
        self.assertIn('/api/recharge', app_js)
        self.assertIn('/api/purchases', app_js)
        self.assertIn("subscription_urls", app_js)
        self.assertNotIn("state.me.email ||", app_js)

    def test_subscription_one_click_import_controls_exist(self):
        root = Path(__file__).resolve().parents[1]
        app_js = (root / "static" / "app.js").read_text(encoding="utf-8")
        app_css = (root / "static" / "app.css").read_text(encoding="utf-8")
        index_html = (root / "static" / "index.html").read_text(encoding="utf-8")

        for client in (
            "clash-verge",
            "mihomo",
            "clash",
            "shadowrocket",
            "singbox",
            "v2rayng",
            "hiddify",
        ):
            self.assertIn(f'data-import-client="{client}"', index_html)

        self.assertIn("function subscriptionUrlForFormat", app_js)
        self.assertIn("function importUrlForClient", app_js)
        self.assertIn("function renderImportButtons", app_js)
        self.assertIn("async function launchImport", app_js)
        self.assertIn("encodeURIComponent", app_js)
        self.assertIn("clash://install-config?url=", app_js)
        self.assertIn("shadowrocket://", app_js)
        self.assertIn("data-import-client", app_js)
        self.assertIn("window.location.href", app_js)
        self.assertIn(".client-import-grid", app_css)
        self.assertIn(".client-import-button", app_css)

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
            'id="profileGiftCardForm"',
            'id="profileGiftCardBalance"',
            'id="profilePasswordForm"',
            'id="profileSubscriptionUrl"',
            'class="profile-list"',
            "礼品卡兑换",
            "复制订阅链接",
        ):
            self.assertIn(marker, index_html)
        profile_start = index_html.index('id="profileView"')
        profile_block = index_html[profile_start:index_html.index('id="adminView"', profile_start)]
        self.assertNotIn('id="checkinPanel"', profile_block)
        self.assertNotIn('自动续费', profile_block)
        self.assertIn("renderProfile", app_js)
        self.assertIn("data-copy-profile-sub", app_js)
        self.assertIn("/api/me/password", app_js)
        self.assertIn("礼品卡兑换成功，余额已到账", app_js)
        self.assertIn("profileEntryLabel", app_js)
        self.assertNotIn('$("#sessionEmail")', app_js)
        self.assertIn(".profile-entry", app_css)
        self.assertIn(".profile-list", app_css)
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

        self.assertIn('id="rechargeCardsView"', index_html)
        self.assertIn('id="rechargeCardForm"', index_html)
        self.assertIn('id="rechargeCardList"', index_html)
        recharge_start = index_html.index('id="rechargeCardsView"')
        recharge_block = index_html[recharge_start:index_html.index('id="nodesView"', recharge_start)]
        admin_start = index_html.index('id="adminView"')
        admin_block = index_html[admin_start:index_html.index('id="rechargeCardsView"', admin_start)]
        self.assertIn('id="rechargeCardForm"', recharge_block)
        self.assertNotIn('id="rechargeCardForm"', admin_block)
        self.assertIn('/api/admin/recharge-cards', app_js)
        self.assertIn('/api/admin/recharge-cards/reveal', app_js)
        self.assertIn("data-reveal-card", app_js)
        self.assertIn("data-copy-card", app_js)
        self.assertIn("generatedCardCodes", app_js)


if __name__ == "__main__":
    unittest.main()
