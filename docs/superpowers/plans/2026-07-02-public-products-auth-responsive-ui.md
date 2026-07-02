# Public Products, Authentication, and Responsive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a cloud-blue responsive storefront where visitors browse live plans, authenticated users apply, and administrators safely delete disabled users after X-UI cleanup.

**Architecture:** Keep the existing Python HTTP application, SQLite database, and dependency-free frontend. Separate credential creation from plan application at the service/API boundary, add conservative remote-client deletion, and reshape the single HTML document into public, user, and admin workspaces with shared responsive behavior.

**Tech Stack:** Python 3.11 standard library, SQLite, `unittest`, vanilla HTML/CSS/JavaScript, 3X-UI HTTP API.

---

## Working Constraints

- Execute in the current checkout because relevant uncommitted subscription-title work overlaps `app.py`, `subscription.py`, `index.html`, `app.js`, and tests. Preserve it exactly.
- Follow @superpowers:test-driven-development for every behavior change.
- Follow @frontend-skill for the visual hierarchy and motion system.
- Follow @superpowers:verification-before-completion before reporting success.
- The public source of truth is `GET /api/plans`; never hard-code mockup prices.
- Use the documented 3X-UI `POST /panel/api/inbounds/:id/delClient/:clientId` route and verify deletion by reading the inbound again.

## File Map

- `xui_manager/db.py` — credential-only registration, plan application, and transactional local-user deletion.
- `xui_manager/app.py` — session-establishing registration, authenticated application route, and admin deletion route.
- `xui_manager/provisioning.py` — orchestrate idempotent remote-client cleanup and redact failures.
- `xui_manager/xui_api.py` — delete one VLESS client and verify it is absent.
- `static/index.html` — storefront, authentication dialog, user workspace, admin workspace, mobile navigation, and loader markup.
- `static/app.css` — cloud-blue system, fixed desktop sidebar, mobile composition, dialogs, user cards, and reduced-motion rules.
- `static/app.js` — view state, application resume flow, loader reference counting, rendering, and actions.
- `tests/test_managed_app.py` — registration, application, deletion route, and redaction behavior.
- `tests/test_provisioning.py` — remote cleanup success, missing-client idempotency, and partial failure.
- `tests/test_xui_api.py` — exact deletion request and readback verification.
- `tests/test_frontend.py` — public/auth/mobile/loading contract checks while preserving existing feature checks.

### Task 1: Establish a Clean Behavioral Baseline

**Files:**
- Inspect: all currently modified files
- Test: `tests/`

- [ ] **Step 1: Record the current dirty scope**

Run: `git status --short` and `git diff --stat`

Expected: only the known subscription-title changes plus this plan document are present.

- [ ] **Step 2: Run the current complete suite**

Run: `python -m unittest discover tests -v`

Expected: all existing tests pass before feature implementation. If not, stop and diagnose the baseline failure before adding behavior.

### Task 2: Separate Registration from Plan Application

**Files:**
- Modify: `tests/test_managed_app.py`
- Modify: `xui_manager/db.py`
- Modify: `xui_manager/app.py`

- [ ] **Step 1: Write failing route tests**

Add tests equivalent to:

```python
def test_registration_without_plan_creates_signed_in_unsubscribed_user(self):
    response = self.app.handle_json(
        "POST", "/api/register", {"Host": "manager.example.com"},
        json.dumps({"email": "new@example.com", "password": "secret123"}),
    )
    payload = json.loads(response.body)
    self.assertEqual(response.status, 200)
    self.assertEqual(payload["user"]["status"], "unsubscribed")
    self.assertIsNone(payload["user"]["plan_id"])
    self.assertIn("Set-Cookie", response.headers)

def test_authenticated_user_can_apply_for_enabled_plan(self):
    # Register, reuse the returned session cookie, then POST plan_id.
    response = self.app.handle_json(
        "POST", "/api/applications", user_headers,
        json.dumps({"plan_id": self.plan_id}),
    )
    self.assertEqual(response.status, 200)
    self.assertEqual(json.loads(response.body)["user"]["status"], "pending")

def test_application_requires_login_and_rejects_active_replacement(self):
    self.assertEqual(self.app.handle_json("POST", "/api/applications", {}, "{}").status, 401)
    # Activate a user, submit another plan, expect 400 and unchanged plan_id.
```

- [ ] **Step 2: Verify the new tests fail for the intended reasons**

Run: `python -m unittest tests.test_managed_app.ManagedAppTests.test_registration_without_plan_creates_signed_in_unsubscribed_user tests.test_managed_app.ManagedAppTests.test_authenticated_user_can_apply_for_enabled_plan -v`

Expected: failures because registration still requires `plan_id` and `/api/applications` does not exist.

- [ ] **Step 3: Add database operations**

Implement the following shape while retaining optional `plan_id` support for existing internal fixtures:

```python
def register_user(self, email: str, password: str, plan_id: int | None = None) -> dict[str, Any]:
    # Validate credentials. With no plan, insert status='unsubscribed', plan_id=NULL,
    # zero quota and expiry. With a plan, retain the existing fixture-compatible path.

def apply_plan(self, user_id: int, plan_id: int) -> dict[str, Any]:
    # Require an ordinary, unsubscribed user; require an enabled plan.
    # Atomically set plan_id and either pending/zero entitlement or
    # active/quota/expiry/approved_at based on require_approval.
```

- [ ] **Step 4: Add authenticated application and session registration routes**

Implement:

```python
if method == "POST" and path == "/api/register":
    user = self.db.register_user(payload["email"], payload["password"])
    session = self.db.create_session(user["id"])
    return self.json_response(
        {"user": self.user_summary(user, headers)},
        headers={"Set-Cookie": cookie_header(session)},
    )

if method == "POST" and path == "/api/applications":
    user = self.user_from_headers(headers)
    if not user:
        return self.json_response({"error": "请先登录后再申请套餐"}, 401)
    applied = self.db.apply_plan(user["id"], int(payload["plan_id"]))
    provisioning = self.provisioning.provision_user(applied["id"]) if applied["status"] == "active" else None
    # Return user and optional provisioning/errors.
```

- [ ] **Step 5: Run focused and regression tests**

Run: `python -m unittest tests.test_managed_app -v`

Expected: all managed app tests pass, including the previous direct-registration fixtures.

### Task 3: Add Verified X-UI Client Deletion

**Files:**
- Modify: `tests/test_xui_api.py`
- Modify: `xui_manager/xui_api.py`

- [ ] **Step 1: Write failing client deletion tests**

Add tests that assert:

```python
deleted = client.delete_vless_client(inbound_id=1, client_uuid=UUID, email=EMAIL)
self.assertTrue(deleted)
self.assertEqual(request_path(opener.requests[1][0]), f"panel/api/inbounds/1/delClient/{UUID}")
self.assertIsNone(client.find_client(readback_inbound, EMAIL))
```

Also test that an already-missing client returns success without issuing a mutation request.

- [ ] **Step 2: Verify RED**

Run: `python -m unittest tests.test_xui_api.XuiApiTests.test_delete_vless_client_posts_documented_route_and_verifies_absence -v`

Expected: error because `delete_vless_client` is missing.

- [ ] **Step 3: Implement minimal deletion**

```python
def delete_vless_client(self, *, inbound_id: int, client_uuid: str, email: str) -> bool:
    inbound = self.get_inbound(inbound_id)
    existing = self.find_client(inbound, email)
    if not existing:
        return True
    if existing.get("id") != client_uuid:
        raise XuiApiError("x-ui client deletion conflict")
    path = f"panel/api/inbounds/{int(inbound_id)}/delClient/{urllib.parse.quote(client_uuid, safe='')}"
    response = self._request(path, data=b"", headers={"Content-Type": "application/x-www-form-urlencoded"})
    self._parse_payload(response, "x-ui client deletion failed", allow_empty=True)
    if self.find_client(self.get_inbound(inbound_id), email):
        raise XuiApiError("x-ui client deletion could not be verified")
    return True
```

- [ ] **Step 4: Verify GREEN and X-UI regressions**

Run: `python -m unittest tests.test_xui_api -v`

Expected: all X-UI tests pass.

### Task 4: Delete Disabled Users Conservatively

**Files:**
- Modify: `tests/test_provisioning.py`
- Modify: `tests/test_managed_app.py`
- Modify: `xui_manager/provisioning.py`
- Modify: `xui_manager/db.py`
- Modify: `xui_manager/app.py`

- [ ] **Step 1: Write failing service and route tests**

Cover these behaviors separately:

```python
def test_delete_user_removes_remote_clients_then_local_records(self): ...
def test_delete_user_preserves_local_records_when_any_panel_fails(self): ...
def test_delete_user_treats_missing_remote_client_as_success(self): ...
def test_delete_route_rejects_active_user_and_admin(self): ...
def test_delete_failure_redacts_panel_password_and_uuid(self): ...
```

Extend `FakePanelClient` with `delete_vless_client` and call tracking.

- [ ] **Step 2: Verify RED**

Run: `python -m unittest tests.test_provisioning tests.test_managed_app -v`

Expected: only the new deletion tests fail because cleanup methods and route are absent.

- [ ] **Step 3: Implement remote cleanup orchestration**

Add a `delete_user_clients(user_id)` method that:

```python
user = self.db.get_user(user_id)
if not user or user["role"] == "admin" or user["status"] != "disabled":
    raise ValueError("only disabled users can be deleted")
for managed in self.db.list_managed_clients(user_id=user_id):
    panel = panels.get(managed["panel_id"])
    # Require configured panel, login, delete the exact UUID, collect sanitized errors.
if errors:
    return {"deleted": False, "errors": errors}
self.db.delete_user(user_id)
return {"deleted": True, "errors": []}
```

Do not expose `remote_email`, UUID, username, password, cookies, or token values in errors.

- [ ] **Step 4: Implement transactional local deletion**

```python
def delete_user(self, user_id: int) -> None:
    with self.session() as conn:
        conn.execute("begin immediate")
        # Reject missing/admin/non-disabled user inside the transaction.
        conn.execute("delete from usage_ledgers where managed_client_id in (select id from managed_clients where user_id=?)", (user_id,))
        conn.execute("delete from managed_clients where user_id=?", (user_id,))
        conn.execute("delete from usage_records where user_id=?", (user_id,))
        conn.execute("delete from sessions where user_id=?", (user_id,))
        conn.execute("delete from users where id=?", (user_id,))
```

- [ ] **Step 5: Add admin route**

`POST /api/admin/users/delete` calls the cleanup service and returns 200 on full success or 502 with sanitized `errors` when any panel fails.

- [ ] **Step 6: Run focused tests**

Run: `python -m unittest tests.test_provisioning tests.test_managed_app tests.test_xui_api -v`

Expected: all pass.

### Task 5: Build the Public Storefront and Authentication Dialog

**Files:**
- Modify: `tests/test_frontend.py`
- Modify: `static/index.html`
- Modify: `static/app.js`

- [ ] **Step 1: Write failing frontend contract tests**

Assert stable semantic hooks rather than decorative text:

```python
self.assertIn('id="storefrontView"', index_html)
self.assertIn('id="planCatalog"', index_html)
self.assertIn('id="authDialog"', index_html)
self.assertNotIn('id="registerPlan"', index_html)
self.assertIn('data-auth-tab="login"', index_html)
self.assertIn('data-apply-plan', app_js)
self.assertIn('/api/applications', app_js)
self.assertIn('pendingPlanId', app_js)
```

- [ ] **Step 2: Verify RED**

Run: `python -m unittest tests.test_frontend -v`

Expected: new storefront/auth assertions fail while existing controls still pass.

- [ ] **Step 3: Restructure semantic markup**

Create:

- a branded fixed desktop sidebar;
- public storefront hero and empty `#planCatalog` region;
- an account/subscription workspace;
- the existing admin views with stable form IDs;
- a native `<dialog id="authDialog">` with login/register tabs;
- `#mobileNav` and `#slowLoader` regions.

Preserve every existing admin form field and the uncommitted `subscription_title` field.

- [ ] **Step 4: Implement public rendering and auth resume flow**

State additions:

```javascript
pendingPlanId: null,
loadingCount: 0,
loadingStartedAt: 0,
```

Behavior:

```javascript
function requestApplication(planId) {
  state.pendingPlanId = Number(planId);
  if (!state.me) return openAuth("login");
  return submitApplication();
}

async function submitApplication() {
  const planId = state.pendingPlanId;
  const data = await api("/api/applications", {
    method: "POST",
    body: JSON.stringify({ plan_id: planId }),
  });
  state.pendingPlanId = null;
  state.me = data.user;
  renderAuth();
  setView("account");
}
```

Successful login/registration closes the dialog and calls `submitApplication()` when `pendingPlanId` exists.

- [ ] **Step 5: Verify frontend contracts**

Run: `python -m unittest tests.test_frontend -v`

Expected: all frontend tests pass.

### Task 6: Add Responsive Cloud-Blue Styling and Slow-Request Feedback

**Files:**
- Modify: `tests/test_frontend.py`
- Modify: `static/app.css`
- Modify: `static/app.js`

- [ ] **Step 1: Write failing style and loader contracts**

Assert presence of `.storefront`, `.plan-catalog`, fixed `.sidebar`, `.mobile-nav`, `.user-card-list`, `@media (max-width: 920px)`, `prefers-reduced-motion`, `slowLoader`, a 600 ms delay, and elapsed-second updates.

- [ ] **Step 2: Verify RED**

Run: `python -m unittest tests.test_frontend -v`

Expected: new style/loader assertions fail.

- [ ] **Step 3: Implement the visual system**

- Use navy text, white/cloud-blue surfaces, and one electric-blue accent.
- Keep the desktop sidebar `position: fixed; inset: 0 auto 0 0;` and offset `.main-shell` by its width.
- At 920 pixels, hide the sidebar, show bottom navigation, stack plans, and render admin users as cards.
- Avoid heavy mobile blur; animate only transforms and opacity.
- Use explicit focus-visible states and 44-pixel mobile targets.

- [ ] **Step 4: Implement reference-counted loading**

Wrap `api()` so each request increments a counter, schedules the global loader after 600 ms, updates elapsed seconds, and decrements in `finally`. Keep immediate inline submit feedback. Ensure overlapping requests cannot hide each other.

- [ ] **Step 5: Add disabled-user delete UI**

Only render “永久删除” when `user.role !== "admin" && user.status === "disabled"`. Require confirmation containing the user email, call `/api/admin/users/delete`, refresh admin data, and surface sanitized failures.

- [ ] **Step 6: Verify frontend and backend suites**

Run: `python -m unittest tests.test_frontend tests.test_managed_app -v`

Expected: all pass.

### Task 7: Integrated Verification and Visual QA

**Files:**
- Verify: all modified files

- [ ] **Step 1: Run formatting and whitespace checks**

Run: `git diff --check`

Expected: exit 0 with no output.

- [ ] **Step 2: Run the complete automated suite**

Run: `python -m unittest discover tests -v`

Expected: exit 0 and zero failures/errors.

- [ ] **Step 3: Start a disposable local server**

Run with a temporary data directory and non-production port, seed at least two live plans, and avoid the existing persistent `data-dev*` directories.

- [ ] **Step 4: Verify desktop behavior**

At 1440×900 and 1024×768 confirm public products, application/auth resume, fixed sidebar while scrolling, user workspace, admin controls, delete visibility, and loader behavior under delayed requests.

- [ ] **Step 5: Verify mobile behavior**

At 390×844 and 360×800 confirm single-column products, full-screen auth sheet, bottom navigation, admin user cards, touch targets, no horizontal page overflow, and reduced-motion behavior.

- [ ] **Step 6: Review the final diff against the specification**

Confirm every acceptance criterion in `docs/superpowers/specs/2026-07-02-public-products-auth-responsive-ui-design.md`, verify subscription-title changes remain intact, and report any limitation instead of masking it.
