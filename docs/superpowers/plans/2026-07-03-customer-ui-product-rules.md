# Customer Dashboard, Product Rules, and Beginner UX Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Fix the customer-facing dashboard, forgot-password flow, check-in placement, recharge-card generation, tutorial management, product taxonomy, and beginner-friendly copy/UI requested by the customer.

**Architecture:** Keep the current single Python HTTP app and static frontend architecture. Add small database/API extensions for product metadata and custom tutorials, then simplify the customer UI around three clear surfaces: public store, user dashboard, and profile settings list. Product purchase semantics live in Database.purchase_plan so frontend and admin behavior remain consistent.

**Tech Stack:** Python unittest, SQLite, http.server-style app routing, static HTML/CSS/JavaScript.

---

## Purchase rules to implement

1. **套餐（时长 + 流量）**: Opens or replaces the user's main subscription. If the user already has a subscription, buying a new套餐 replaces it immediately and the old remaining traffic/time is abandoned. Usage is reset for the new cycle.
2. **流量包（不限时长）**: Adds traffic to the current active subscription. It does not change expiry, current plan, or used traffic. Requires an active subscription.
3. **时长包（不限流量变化）**: Extends the current active subscription expiry by the purchased number of days. It does not change traffic quota, current plan, or used traffic. Requires an active subscription.
4. **流量重置包**: Resets the current cycle usage back to zero. It does not change expiry, traffic quota, or current plan. Requires an active subscription.
5. **Admin product metadata**: Every product supports type, category, customer description, and purchase notice. Notices are shown before purchase so beginner customers understand what will happen.

---

### Task 1: Record requirements in failing tests

**Files:**
- Modify: tests/test_balance_commerce.py
- Modify: tests/test_ui_functionality_plan.py
- Modify: tests/test_frontend.py

- [x] **Step 1: Add database/product-rule tests**
  - Assert plans includes product_type, category, description, and purchase_notice.
  - Assert tutorials table exists.
  - Assert subscription replacement abandons old remaining usage/time and resets usage.
  - Assert traffic/time/reset packs apply without replacing the base subscription.

- [x] **Step 2: Add API tests**
  - Assert recharge cards can be generated without RECHARGE_CARD_SECRET, while reveal remains unavailable for non-encrypted cards.
  - Assert admin can create/update/delete tutorials and public users can list enabled tutorials.
  - Assert admin plan API persists product metadata.

- [x] **Step 3: Add static UI contract tests**
  - Assert home is not in desktop/mobile sidebar nav and remains reachable from the brand.
  - Assert “我的订阅” becomes “仪表盘”.
  - Assert check-in panel lives inside dashboard, not profile.
  - Assert profile uses a list-style settings layout and no auto-renew/check-in block.
  - Assert storefront removed the public top/footer CTA clutter and product cards show metadata/rules.
  - Assert copy-subscription duplication is reduced.
  - Assert ticket page no longer exposes “查看教程”.
  - Assert admin tutorial editor and product metadata fields exist.

- [x] **Step 4: Run targeted tests and verify they fail for missing features**
  - Run: python -m unittest tests.test_balance_commerce tests.test_ui_functionality_plan tests.test_frontend -v
  - Expected: FAIL because product/tutor schema, UI markers, and recharge-card behavior are not yet implemented.

### Task 2: Extend data model and backend APIs

**Files:**
- Modify: xui_manager/db.py
- Modify: xui_manager/app.py

- [x] **Step 1: Add plan metadata schema**
  - Add migration columns for product_type, category, description, and purchase_notice.
  - Update plan create/update/list decode paths while preserving old call signatures.

- [x] **Step 2: Implement purchase rules**
  - Centralize supported product types.
  - Apply replacement/add-on/reset behavior atomically inside purchase_plan.
  - Reject add-on/reset products for inactive users with a customer-readable error.

- [x] **Step 3: Add tutorial schema and methods**
  - Store platform, title, content, optional image_url, enabled, and sort_order.
  - Provide list/save/delete helpers.

- [x] **Step 4: Add JSON routes**
  - Public GET /api/tutorials.
  - Admin GET /api/admin/tutorials, POST /api/admin/tutorials, POST /api/admin/tutorials/delete.
  - Admin plan route accepts metadata fields.
  - Recharge card generation no longer fails when RECHARGE_CARD_SECRET is empty; it still returns generated codes once and marks cards as non-revealable.

- [x] **Step 5: Run targeted backend tests**
  - Run: python -m unittest tests.test_balance_commerce tests.test_ui_functionality_plan -v
  - Expected: PASS for backend cases; frontend contract may still fail until Task 3.

### Task 3: Rework customer-facing frontend

**Files:**
- Modify: static/index.html
- Modify: static/app.js
- Modify: static/app.css

- [x] **Step 1: Navigation and auth**
  - Remove home from left and mobile nav.
  - Keep brand/logo as the home entry.
  - Rename user “我的订阅” nav item to “仪表盘”.
  - Place forgot-password text under the login button and link it to a dedicated help panel.

- [x] **Step 2: Dashboard and subscription links**
  - Move daily check-in into dashboard.
  - Simplify subscription copying to one primary copy action plus one import area.
  - Keep advanced format links available but visually secondary.

- [x] **Step 3: Storefront and checkout**
  - Remove public top/footer CTA clutter so only products are shown.
  - Show product type/category/description/purchase notice.
  - Make unauthenticated “购买/订阅” open login/register with clear beginner copy.
  - Remove all “续费” language from customer actions.

- [x] **Step 4: Profile and support**
  - Convert profile to list/detail rows for account, notification, gift card, password, and subscription details.
  - Remove auto-renew and check-in from profile.
  - Remove ticket “查看教程” shortcut.

- [x] **Step 5: Custom tutorials**
  - Render public tutorials by platform category.
  - Add admin editor under settings, including image URL/data URL support and a file-to-data-URL helper for uploaded images.

- [x] **Step 6: Run frontend contract tests**
  - Run: python -m unittest tests.test_frontend tests.test_ui_functionality_plan -v
  - Expected: PASS.

### Task 4: Full verification and delivery

**Files:**
- All modified files.

- [x] **Step 1: Run full test suite**
  - Run: python -m unittest discover tests -v
  - Expected: PASS.

- [x] **Step 2: Review diff and status**
  - Run: git status --short --branch
  - Run: git diff --check
  - Expected: clean whitespace and only planned files changed.

- [x] **Step 3: Commit feature branch**
  - Stage planned files.
  - Commit: feat: refine customer dashboard and product rules.

- [x] **Step 4: Merge, retest, push**
  - Checkout main.
  - Fast-forward/pull latest from origin/main if possible.
  - Merge codex/customer-ui-product-rules into main.
  - Run full tests again on main.
  - Push main to origin.

- [x] **Step 5: Report evidence**
  - Include commit hash, merge/push status, and exact test command output summary.
