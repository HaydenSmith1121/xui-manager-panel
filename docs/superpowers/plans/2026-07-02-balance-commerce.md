# Balance Commerce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace approval-based plan applications with balance purchases and add recharge cards, admin balance tools, user notes/filters, modal settings forms, and multi-client subscriptions.

**Architecture:** Extend the SQLite model with cent-based balances, immutable balance ledgers, and hashed one-time recharge cards. Keep the existing dependency-free Python HTTP application and vanilla HTML/CSS/JS client, adding focused database methods and format-specific subscription builders behind explicit API routes.

**Tech Stack:** Python 3 standard library, SQLite, `unittest`, vanilla JavaScript, HTML `dialog`, CSS.

---

### Task 1: Balance and recharge schema

**Files:**
- Modify: `xui_manager/db.py`
- Test: `tests/test_balance_commerce.py`

- [ ] Write failing migration tests for plan prices, user balances/notes, ledger rows, and recharge cards.
- [ ] Run `python -m unittest tests.test_balance_commerce -v` and confirm missing schema failures.
- [ ] Add idempotent columns, tables, indexes, and decoding helpers.
- [ ] Re-run the focused tests and commit.

### Task 2: Transactional commerce methods

**Files:**
- Modify: `xui_manager/db.py`
- Test: `tests/test_balance_commerce.py`

- [ ] Write failing tests for atomic purchase, insufficient balance, one-time card redemption, admin adjustment, note updates, and transaction history.
- [ ] Confirm every new test fails for missing behavior.
- [ ] Implement `purchase_plan`, `create_recharge_cards`, `redeem_recharge_card`, `adjust_user_balance`, `update_user_note`, and list methods with `begin immediate`.
- [ ] Verify focused tests pass and refactor duplicate ledger writes.

### Task 3: Commerce APIs

**Files:**
- Modify: `xui_manager/app.py`
- Test: `tests/test_managed_app.py`

- [ ] Write failing route tests for purchase/recharge/history and admin card/balance/note operations.
- [ ] Confirm route tests fail with 404 or missing fields.
- [ ] Add authenticated and admin routes, expose only safe summaries, and run provisioning after successful purchases.
- [ ] Verify all managed app tests pass.

### Task 4: Multi-format subscriptions

**Files:**
- Modify: `xui_manager/subscription.py`
- Modify: `xui_manager/app.py`
- Test: `tests/test_managed_subscription.py`

- [ ] Write failing tests for Base64 share-link and sing-box responses plus format-specific URLs.
- [ ] Confirm missing builders/routes fail.
- [ ] Extract common eligible-node collection, add Base64 and sing-box builders, and route each format.
- [ ] Verify subscription tests pass for active, inactive, exhausted, and expired users.

### Task 5: Modal settings and balance UI

**Files:**
- Modify: `static/index.html`
- Modify: `static/app.js`
- Modify: `static/app.css`
- Test: `tests/test_frontend.py`

- [ ] Write failing source-level frontend tests for list-level add buttons, dialogs, hidden storefront identity, prices, recharge form, and multi-format subscription controls.
- [ ] Confirm tests fail against the current markup/scripts.
- [ ] Move plan/panel forms into dialogs, render prices and purchase actions, and add account balance/recharge/subscription sections.
- [ ] Bind dialog open/close, purchase, recharge, and copy actions using existing loading state.
- [ ] Verify frontend tests and JavaScript syntax.

### Task 6: Searchable collapsible user operations

**Files:**
- Modify: `static/index.html`
- Modify: `static/app.js`
- Modify: `static/app.css`
- Test: `tests/test_frontend.py`

- [ ] Write failing tests for search, status/type/priority filters, collapsible details, notes, and balance adjustment controls.
- [ ] Confirm failures.
- [ ] Implement shared desktop/mobile filtering and detail rendering with safe escaped values.
- [ ] Add admin note and balance form handlers, responsive styles, and accessible expanded states.
- [ ] Verify frontend tests and syntax.

### Task 7: Full verification and integration

**Files:**
- Modify: `README.md`

- [ ] Document prices, balance purchase, recharge cards, admin operations, and subscription endpoints.
- [ ] Run `python -m unittest discover tests -q` and confirm zero failures.
- [ ] Run `node --check static/app.js` and `git diff --check`.
- [ ] Review schema migration and API payloads for backward compatibility and secret leakage.
- [ ] Commit the feature branch, merge it into `main` without conflicts, re-run the full suite, and push `main`.

