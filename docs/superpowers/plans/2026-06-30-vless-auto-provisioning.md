# VLESS Auto-Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically create a unique VLESS client for each approved user on every eligible 3X-UI inbound, aggregate weighted usage across panels, expose quota metadata to Clash, and disable remote clients at quota or expiry.

**Architecture:** Keep the existing standard-library Python application and SQLite database. Split remote HTTP transport, provisioning orchestration, usage accounting/enforcement, and periodic scheduling into focused modules; keep `app.py` as the HTTP routing/composition layer and `subscription.py` as the Clash serializer. All remote mutations are idempotent and verified by reading the inbound back.

**Tech Stack:** Python 3.11+ standard library (`sqlite3`, `urllib`, `threading`, `uuid`, `unittest`), vanilla HTML/CSS/JavaScript, 3X-UI session-authenticated REST API, systemd.

**Design reference:** `docs/superpowers/specs/2026-06-30-vless-auto-provisioning-design.md`

---

## File Map

**Create:**

- `xui_manager/vless.py` - parse VLESS templates, derive client flow, replace only the UUID, and validate target compatibility.
- `xui_manager/provisioning.py` - calculate eligible targets and create/reconcile/enable/disable remote clients.
- `xui_manager/usage_sync.py` - synchronize target counters, maintain weighted ledgers, and enforce aggregate quota/expiry.
- `xui_manager/worker.py` - one daemon scheduler for periodic reconciliation and usage synchronization.
- `tests/test_managed_schema.py` - additive migration and managed-client/ledger repository tests.
- `tests/test_vless.py` - VLESS template and target validation tests.
- `tests/test_xui_api.py` - fake-HTTP tests for the 3X-UI adapter.
- `tests/test_provisioning.py` - provisioning idempotency, eligibility, partial failure, and retry tests.
- `tests/test_usage_sync.py` - delta accounting, multipliers, resets, stale panels, and enforcement tests.
- `tests/test_managed_subscription.py` - per-user UUID and metadata tests.
- `tests/test_managed_app.py` - admin route authorization, approval, retry, panel inspection, and redaction tests.
- `tests/test_worker.py` - scheduler start/stop and interval tests.

**Modify:**

- `xui_manager/db.py` - additive schema migration and repository methods only; no remote HTTP calls.
- `xui_manager/xui_api.py` - make this module a focused 3X-UI HTTP adapter and retain a compatibility wrapper for the old manual sync entry point until callers migrate.
- `xui_manager/billing.py` - return separate weighted upload/download totals and combine managed and legacy usage.
- `xui_manager/subscription.py` - emit managed VLESS entries with stored UUIDs and accurate upload/download headers.
- `xui_manager/app.py` - compose services, add admin endpoints/same-origin checks, and expose provisioning summaries.
- `static/index.html` - managed/static node controls, inbound picker, provisioning status, sync settings, and user availability summary.
- `static/app.js` - load inbound choices, render statuses, and wire retry/sync/reconcile actions with duplicate-click protection.
- `static/app.css` - restrained status, segmented mode, inline error, and responsive table styling.
- `tests/test_core.py` - preserve legacy behavior while switching summary accounting to the new database API.
- `tests/test_frontend.py` - assert the new controls, actions, and error handling are wired.
- `README.md` - managed-node setup, upgrade, testing, logs, and recovery tutorial.

---

### Task 1: Add Additive Managed-Client and Usage-Ledger Schema

**Files:**
- Create: `tests/test_managed_schema.py`
- Modify: `xui_manager/db.py:31-113`
- Modify: `xui_manager/db.py:417-527`

- [ ] **Step 1: Write migration and uniqueness tests**

Create tests that initialize an old-format database, call `init_schema()` twice, and assert that existing rows survive, existing nodes become `mode='static'`, and the new unique target constraint works.

```python
def test_old_database_migrates_without_losing_static_nodes(self):
    db = build_old_database(self.db_path)
    db.init_schema()
    db.init_schema()
    node = db.list_nodes()[0]
    self.assertEqual(node["mode"], "static")
    self.assertEqual(node["name"], "Legacy US")

def test_managed_client_is_unique_per_user_panel_and_inbound(self):
    first = db.ensure_managed_client(user_id, panel_id, 1, "vless", "", 1.0, expiry)
    second = db.ensure_managed_client(user_id, panel_id, 1, "vless", "", 1.0, expiry)
    self.assertEqual(first["id"], second["id"])
    self.assertEqual(first["client_uuid"], second["client_uuid"])
```

- [ ] **Step 2: Run the schema tests and verify they fail**

Run: `python -m unittest tests.test_managed_schema -v`

Expected: FAIL because `nodes.mode`, `managed_clients`, `usage_ledgers`, and repository methods do not exist.

- [ ] **Step 3: Add the additive schema**

Extend `Database.init_schema()` and `_ensure_column()` with:

```sql
alter table nodes add column mode text not null default 'static';

create table if not exists managed_clients (
    id integer primary key autoincrement,
    user_id integer not null,
    panel_id integer not null,
    inbound_id integer not null,
    protocol text not null default 'vless',
    client_uuid text not null,
    remote_email text not null,
    flow text not null default '',
    rate real not null default 1,
    desired_expire_at integer not null default 0,
    desired_enabled integer not null default 1,
    state text not null default 'pending',
    remote_enabled integer not null default 0,
    last_error text not null default '',
    attempt_count integer not null default 0,
    last_attempt_at integer not null default 0,
    last_synced_at integer not null default 0,
    created_at integer not null,
    updated_at integer not null,
    unique(user_id, panel_id, inbound_id),
    foreign key(user_id) references users(id),
    foreign key(panel_id) references panels(id)
);

create table if not exists usage_ledgers (
    managed_client_id integer primary key,
    last_remote_up integer not null default 0,
    last_remote_down integer not null default 0,
    raw_up integer not null default 0,
    raw_down integer not null default 0,
    weighted_up integer not null default 0,
    weighted_down integer not null default 0,
    rate real not null default 1,
    updated_at integer not null default 0,
    foreign key(managed_client_id) references managed_clients(id) on delete cascade
);

create table if not exists app_settings (
    key text primary key,
    value text not null
);
```

Create indexes on managed client user/state and panel/inbound. Generate the UUID with `str(uuid.uuid4())` before insertion and the remote label with `xum-u{user_id}-p{panel_id}-i{inbound_id}`.

- [ ] **Step 4: Add focused repository methods**

Implement and test:

```python
ensure_managed_client(...)
get_managed_client(client_id)
get_managed_client_for_target(user_id, panel_id, inbound_id)
list_managed_clients(user_id=None, states=None)
update_managed_client_result(client_id, *, state, remote_enabled, error)
set_managed_client_desired(client_id, *, enabled, expire_at)
get_usage_ledger(managed_client_id)
advance_usage_ledger(managed_client_id, remote_up, remote_down, rate)
managed_usage_totals(user_id)
reset_managed_usage(user_id)
get_setting(key, default)
set_setting(key, value)
```

`advance_usage_ledger()` must use `delta = current - previous` when counters increase and `delta = current` when a remote counter resets. It adds `int(delta * rate)` to persistent weighted totals.

- [ ] **Step 5: Run schema and existing tests**

Run: `python -m unittest tests.test_managed_schema tests.test_core -v`

Expected: PASS; existing static node and manual usage tests remain green.

- [ ] **Step 6: Commit**

```bash
git add xui_manager/db.py tests/test_managed_schema.py
git commit -m "Add managed client and usage ledger schema"
```

---

### Task 2: Parse and Validate Managed VLESS Templates

**Files:**
- Create: `xui_manager/vless.py`
- Create: `tests/test_vless.py`
- Modify: `xui_manager/db.py:417-470`

- [ ] **Step 1: Write failing VLESS helper tests**

Cover TLS, Reality/Vision, WebSocket query preservation, IPv6 host syntax, malformed links, and target conflicts.

```python
def test_replace_uuid_preserves_every_other_uri_component(self):
    template = "vless://old@example.com:443?security=reality&flow=xtls-rprx-vision&sni=edge.example#US"
    rewritten = replace_vless_uuid(template, "22222222-2222-2222-2222-222222222222")
    self.assertIn("vless://22222222-2222-2222-2222-222222222222@example.com:443", rewritten)
    self.assertIn("security=reality", rewritten)
    self.assertIn("flow=xtls-rprx-vision", rewritten)
    self.assertTrue(rewritten.endswith("#US"))

def test_target_rejects_conflicting_rates(self):
    with self.assertRaisesRegex(ValueError, "same multiplier"):
        validate_target_nodes([node(rate=1), node(rate=3)])
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m unittest tests.test_vless -v`

Expected: FAIL because `xui_manager.vless` does not exist.

- [ ] **Step 3: Implement small structured helpers**

Implement:

```python
@dataclass(frozen=True)
class VlessTemplate:
    link: str
    flow: str
    host: str
    port: int

def parse_vless_template(source: str) -> VlessTemplate: ...
def replace_vless_uuid(source: str, client_uuid: str) -> str: ...
def validate_target_nodes(nodes: Sequence[Mapping[str, Any]]) -> tuple[float, str]: ...
def eligible_managed_nodes(nodes, allowed_tags) -> list[dict[str, Any]]: ...
def group_managed_targets(nodes) -> dict[tuple[int, int], list[dict[str, Any]]]: ...
```

Use `urllib.parse.urlsplit/urlunsplit`; never use string replacement for the UUID. Require `mode='managed'`, a panel ID, positive inbound ID, VLESS scheme, positive multiplier, and identical rate/flow within a target.

- [ ] **Step 4: Validate managed nodes at database create/update boundaries**

Add `mode` to `create_node()`/`update_node()`. Static mode remains backward compatible. Managed mode must reject missing panel/inbound and non-VLESS sources. Before save, compare enabled sibling nodes on the same target and reject conflicting rate or flow.

- [ ] **Step 5: Run tests**

Run: `python -m unittest tests.test_vless tests.test_managed_schema tests.test_core -v`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add xui_manager/vless.py xui_manager/db.py tests/test_vless.py
git commit -m "Validate managed VLESS node templates"
```

---

### Task 3: Expand the 3X-UI HTTP Adapter

**Files:**
- Create: `tests/test_xui_api.py`
- Modify: `xui_manager/xui_api.py:15-51`

- [ ] **Step 1: Write fake-opener adapter tests**

Inject an opener into `XuiClient` so tests make no network calls. Cover successful login/list/get, add client, update client, empty mutation responses, JSON failure messages, timeouts, and secret redaction.

```python
def test_add_vless_client_posts_form_and_verifies_by_readback(self):
    client = XuiClient(BASE, "admin", "secret", opener=fake_opener(responses))
    client.login()
    created = client.add_vless_client(
        inbound_id=1,
        client_uuid=UUID,
        email="xum-u2-p1-i1",
        flow="xtls-rprx-vision",
        expire_at=1_800_000_000,
    )
    self.assertEqual(created["id"], UUID)
    self.assertNotIn("secret", repr(client))
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m unittest tests.test_xui_api -v`

Expected: FAIL because mutation and lookup methods are missing.

- [ ] **Step 3: Implement response parsing and API methods**

Add:

```python
def get_inbound(self, inbound_id: int) -> dict[str, Any]: ...
def find_client(self, inbound: Mapping[str, Any], email: str) -> dict[str, Any] | None: ...
def add_vless_client(self, *, inbound_id, client_uuid, email, flow, expire_at) -> dict[str, Any]: ...
def update_vless_client(self, *, inbound_id, client_uuid, email, flow, expire_at, enabled) -> dict[str, Any]: ...
def client_traffic(self, email: str) -> dict[str, int]: ...
```

POST `id=<inbound_id>` and `settings={"clients":[...]}` as `application/x-www-form-urlencoded` to the documented `panel/api/inbounds/addClient` and `updateClient/<client_uuid>` endpoints. Client fields are:

```python
{
    "id": client_uuid,
    "email": email,
    "flow": flow,
    "limitIp": 0,
    "totalGB": 0,
    "expiryTime": expire_at * 1000 if expire_at else 0,
    "enable": enabled,
    "tgId": "",
    "subId": "",
    "reset": 0,
}
```

Treat empty mutation bodies as indeterminate, then call `get_inbound()` and verify the stored client. Convert HTTP/URL/JSON errors to `XuiApiError` messages that do not include passwords, cookies, UUIDs, or raw response bodies.

- [ ] **Step 4: Keep read-only legacy helpers compatible**

Retain `list_inbounds()`, `find_inbound()`, and a temporary `sync_usage_from_xui()` wrapper so Tasks 1-3 do not break the current admin button before Task 5 replaces synchronization.

- [ ] **Step 5: Run adapter and existing tests**

Run: `python -m unittest tests.test_xui_api tests.test_core -v`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add xui_manager/xui_api.py tests/test_xui_api.py
git commit -m "Add verified 3X-UI client mutations"
```

---

### Task 4: Implement Idempotent User Provisioning

**Files:**
- Create: `xui_manager/provisioning.py`
- Create: `tests/test_provisioning.py`
- Modify: `xui_manager/db.py`

- [ ] **Step 1: Write provisioning service tests**

Use fake panels/clients. Test plan-tag filtering, target deduplication, successful multi-panel provisioning, one-panel failure, retry, repeated approval, existing same UUID, conflicting remote UUID, and disabled panels.

```python
def test_partial_failure_keeps_success_and_retry_is_idempotent(self):
    first = service.provision_user(user_id)
    self.assertEqual(first, {"provisioned": 1, "failed": 1, "pending": 0})
    clients["bad-panel"].recover()
    second = service.retry_user(user_id)
    self.assertEqual(second["provisioned"], 2)
    self.assertEqual(sum(c.add_calls for c in clients.values()), 2)
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m unittest tests.test_provisioning -v`

Expected: FAIL because the provisioning service does not exist.

- [ ] **Step 3: Implement target preparation**

Create `ProvisioningService(db, client_factory=XuiClient)` with:

```python
def provision_user(self, user_id: int) -> dict[str, Any]: ...
def retry_user(self, user_id: int) -> dict[str, Any]: ...
def set_user_enabled(self, user_id: int, enabled: bool) -> dict[str, Any]: ...
def reconcile_user(self, user_id: int, apply: bool = False) -> dict[str, Any]: ...
def status_for_user(self, user_id: int) -> dict[str, Any]: ...
```

`provision_user()` loads the user/plan, filters eligible managed nodes, groups by target, validates rate/flow, and calls `ensure_managed_client()` before any network request.

- [ ] **Step 4: Implement per-target idempotency and partial results**

For each target:

1. Login and confirm the inbound exists and protocol is `vless`.
2. Find `remote_email` in inbound settings.
3. If absent, add the stored UUID.
4. If present with the same UUID, reconcile expiry/enabled state.
5. If present with another UUID, store a sanitized conflict and do not mutate it.
6. Read back and mark `provisioned` only after verification.

Catch errors per target, update attempt/error fields, and continue. Never place the UUID or password in stored errors.

- [ ] **Step 5: Run provisioning tests**

Run: `python -m unittest tests.test_provisioning tests.test_xui_api tests.test_vless -v`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add xui_manager/provisioning.py xui_manager/db.py tests/test_provisioning.py
git commit -m "Provision unique VLESS clients per user"
```

---

### Task 5: Synchronize Weighted Usage and Enforce Limits

**Files:**
- Create: `xui_manager/usage_sync.py`
- Create: `tests/test_usage_sync.py`
- Modify: `xui_manager/billing.py`
- Modify: `xui_manager/xui_api.py:53-106`
- Modify: `xui_manager/db.py`

- [ ] **Step 1: Write delta-ledger and enforcement tests**

```python
def test_multiplier_applies_only_to_new_remote_delta(self):
    service.sync_all()  # remote up=1 GiB at rate 3
    db.set_managed_client_rate(client_id, 1)
    remote.set_traffic(up=2 * GB)
    service.sync_all()
    totals = db.managed_usage_totals(user_id)
    self.assertEqual(totals["upload"], 4 * GB)

def test_counter_reset_preserves_history_and_counts_new_bytes(self):
    remote.set_traffic(down=10 * GB)
    service.sync_all()
    remote.set_traffic(down=2 * GB)
    service.sync_all()
    self.assertEqual(db.managed_usage_totals(user_id)["download"], 12 * GB)
```

Also test unreachable panel staleness, separate upload/download totals, expiry, quota exhaustion, partial disable failure, and no duplicate counting for two nodes sharing a target.

- [ ] **Step 2: Run and verify failure**

Run: `python -m unittest tests.test_usage_sync -v`

Expected: FAIL because `UsageSyncService` does not exist.

- [ ] **Step 3: Implement managed accounting**

Create `UsageSyncService(db, provisioning, client_factory=XuiClient, now=time.time)`:

```python
def sync_all(self) -> dict[str, Any]: ...
def sync_user(self, user_id: int) -> dict[str, Any]: ...
def enforce_user(self, user_id: int) -> dict[str, Any]: ...
```

Group managed clients by panel, login once per panel, list inbounds once, find each `remote_email` in `clientStats`, and call `advance_usage_ledger()`. Preserve last values and return a stale/error item when a panel fails.

- [ ] **Step 4: Implement one canonical usage summary**

Replace direct `calculate_billable_usage(db.usage_for_user(...))` callers with:

```python
def usage_totals(db, user_id):
    managed = db.managed_usage_totals(user_id)
    legacy = calculate_legacy_static_usage(db.usage_for_user(user_id))
    return {
        "upload": managed["upload"] + legacy["upload"],
        "download": managed["download"] + legacy["download"],
    }
```

Exclude legacy `usage_records` attached to managed nodes to prevent double billing.

- [ ] **Step 5: Implement enforcement**

After each sync, disable managed clients when user status is not active, expiry is reached, or weighted upload + download is at least quota. Subscription eligibility changes immediately from local state. Remote update failures remain visible and retryable.

- [ ] **Step 6: Run focused and regression tests**

Run: `python -m unittest tests.test_usage_sync tests.test_provisioning tests.test_core -v`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add xui_manager/usage_sync.py xui_manager/billing.py xui_manager/xui_api.py xui_manager/db.py tests/test_usage_sync.py tests/test_core.py
git commit -m "Aggregate weighted client usage and enforce limits"
```

---

### Task 6: Generate Per-User Managed Clash Subscriptions

**Files:**
- Create: `tests/test_managed_subscription.py`
- Modify: `xui_manager/subscription.py:25-149`
- Modify: `xui_manager/billing.py`

- [ ] **Step 1: Write managed subscription tests**

Test two users receiving different UUIDs from the same template, pending/failed targets being omitted, static nodes remaining unchanged, accurate upload/download headers, and empty HTTP 200 YAML for inactive/exhausted/expired valid tokens.

```python
def test_users_receive_distinct_uuids_without_changing_transport(self):
    first = build_clash_subscription(db, user_one["token"])
    second = build_clash_subscription(db, user_two["token"])
    self.assertIn(client_one["client_uuid"], first.body)
    self.assertNotIn(client_two["client_uuid"], first.body)
    self.assertIn('"servername": "edge.example"', first.body)
    self.assertNotEqual(first.body, second.body)

def test_exhausted_valid_token_returns_empty_200_with_metadata(self):
    response = build_clash_subscription(db, user["token"])
    self.assertEqual(response.status, 200)
    self.assertEqual(json.loads(response.body)["proxies"], [])
    self.assertIn("total=", response.headers["Subscription-Userinfo"])
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m unittest tests.test_managed_subscription -v`

Expected: FAIL because subscription generation still uses the template UUID.

- [ ] **Step 3: Add credential-aware proxy conversion**

Change `node_to_proxy()` to accept an optional `client_uuid`. Managed nodes load a `provisioned` and locally enabled managed client for the user/target, call `replace_vless_uuid()`, then parse the rewritten link. Static nodes keep current behavior.

- [ ] **Step 4: Emit separate weighted header counters**

Use canonical totals:

```python
"Subscription-Userinfo": (
    f"upload={totals['upload']}; download={totals['download']}; "
    f"total={quota}; expire={expire_at}"
)
```

Keep `Profile-Title`, `Profile-Update-Interval`, and `Cache-Control`. Invalid token remains 404; valid but unavailable account remains 200 with empty proxies.

- [ ] **Step 5: Run subscription regression tests**

Run: `python -m unittest tests.test_managed_subscription tests.test_core -v`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add xui_manager/subscription.py xui_manager/billing.py tests/test_managed_subscription.py tests/test_core.py
git commit -m "Generate subscriptions with per-user VLESS UUIDs"
```

---

### Task 7: Wire Approval, Retry, Panel Inspection, and Secure Admin APIs

**Files:**
- Create: `tests/test_managed_app.py`
- Modify: `xui_manager/app.py:18-158`
- Modify: `xui_manager/db.py`

- [ ] **Step 1: Write failing route tests**

Cover approval returning provisioning summary, retry, sync-now, remote disable/re-enable, renewal with optional usage reset, immediate provisioning for no-approval plans, panel test/inbound listing, credential redaction, blank password preservation on panel edit, admin authorization, and same-origin enforcement.

```python
def test_approve_returns_partial_provisioning_summary(self):
    response = app.handle_json("POST", "/api/admin/users/approve", admin_headers(), body)
    payload = json.loads(response.body)
    self.assertEqual(payload["provisioning"]["provisioned"], 1)
    self.assertEqual(payload["provisioning"]["failed"], 1)

def test_panel_list_never_returns_password(self):
    response = app.handle_json("GET", "/api/admin/panels", admin_headers(), "")
    panel = json.loads(response.body)["panels"][0]
    self.assertNotIn("password", panel)
    self.assertTrue(panel["has_password"])

def test_renewal_keeps_usage_unless_reset_is_explicit(self):
    before = app.db.managed_usage_totals(user_id)
    post_admin("/api/admin/users/approve", {"user_id": user_id, "renew": True, "reset_usage": False})
    self.assertEqual(app.db.managed_usage_totals(user_id), before)
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m unittest tests.test_managed_app -v`

Expected: FAIL because services/routes/redaction are not connected.

- [ ] **Step 3: Compose services in `XuiManagerApp`**

Allow dependency injection for tests:

```python
class XuiManagerApp:
    def __init__(self, db_path, static_dir=None, client_factory=XuiClient, now=time.time):
        ...
        self.provisioning = ProvisioningService(self.db, client_factory, now=now)
        self.usage_sync = UsageSyncService(self.db, self.provisioning, client_factory, now=now)
```

Approval must call `db.approve_user()` once, then `provisioning.provision_user()`. Repeated approval of an already active user must not extend expiry unless the request explicitly sets `renew=true`. Renewal preserves usage unless `reset_usage=true` is also confirmed. After `/api/register`, an account made active by a plan with `require_approval=false` must immediately run the same provisioning service and return its summary.

- [ ] **Step 4: Add focused admin routes**

Add:

```text
POST /api/admin/users/approve
POST /api/admin/users/provision/retry
POST /api/admin/users/reconcile
POST /api/admin/users/status
POST /api/admin/sync-usage
POST /api/admin/panels/test
POST /api/admin/panels/inbounds
GET  /api/admin/settings
POST /api/admin/settings
```

`POST /api/admin/users/approve` accepts `renew` and `reset_usage` booleans. A first approval ignores `reset_usage`; renewal resets ledgers only when both flags are true.

Return per-target public status without UUIDs. Panel inspection returns only ID, remark, port, protocol, and enabled state.

- [ ] **Step 5: Add redaction and same-origin protection**

Create `public_panel()` and `public_managed_client()` serializers. On panel update, an empty password retains the existing stored password. For mutating `/api/admin/*` requests require JSON content type and compare `Origin` or `Referer` host with forwarded/current host; reject mismatch with 403.

- [ ] **Step 6: Run route and regression tests**

Run: `python -m unittest tests.test_managed_app tests.test_core tests.test_admin_tools -v`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add xui_manager/app.py xui_manager/db.py tests/test_managed_app.py
git commit -m "Expose managed provisioning admin APIs"
```

---

### Task 8: Add the Periodic Sync and Reconciliation Worker

**Files:**
- Create: `xui_manager/worker.py`
- Create: `tests/test_worker.py`
- Modify: `xui_manager/app.py:250-265`

- [ ] **Step 1: Write scheduler tests using an injected event/clock**

```python
def test_worker_runs_immediately_then_uses_configured_interval(self):
    worker = PeriodicSyncWorker(service, interval_provider=lambda: 300, stop_event=stop)
    worker.run_once()
    self.assertEqual(service.sync_calls, 1)

def test_invalid_interval_is_clamped(self):
    self.assertEqual(normalize_interval("1"), 60)
    self.assertEqual(normalize_interval("999999"), 86400)
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m unittest tests.test_worker -v`

Expected: FAIL because the worker module does not exist.

- [ ] **Step 3: Implement the daemon worker**

`PeriodicSyncWorker` owns a `threading.Event` and daemon thread. It calls `usage_sync.sync_all()`, logs one sanitized summary, waits for `sync_interval_seconds` (default 300, range 60-86400), and repeats. Unexpected errors are caught at the cycle boundary so the thread survives.

- [ ] **Step 4: Start exactly one worker from `run()`**

Do not start it in `XuiManagerApp.__init__()` because tests and imported apps must remain deterministic. Start immediately before `serve_forever()`, stop in `finally`, and join with a short timeout.

- [ ] **Step 5: Run worker tests and compile**

Run: `python -m unittest tests.test_worker -v`

Run: `python -m compileall -q xui_manager tests tools`

Expected: PASS and exit 0.

- [ ] **Step 6: Commit**

```bash
git add xui_manager/worker.py xui_manager/app.py tests/test_worker.py
git commit -m "Run periodic X-UI synchronization worker"
```

---

### Task 9: Build the Managed-Node and Provisioning Status UI

**Files:**
- Modify: `static/index.html:54-159`
- Modify: `static/app.js:1-381`
- Modify: `static/app.css`
- Modify: `tests/test_frontend.py`

- [ ] **Step 1: Extend frontend contract tests first**

Assert that the DOM and JavaScript include node mode controls, inbound loading, provisioning status, retry, reconcile preview/apply, last sync/stale state, sync interval, and duplicate-action protection.

```python
def test_managed_node_controls_and_retry_are_wired(self):
    html = INDEX.read_text(encoding="utf-8")
    js = APP_JS.read_text(encoding="utf-8")
    self.assertIn('name="mode"', html)
    self.assertIn('id="nodeInbound"', html)
    self.assertIn("data-retry-provisioning", js)
    self.assertIn("withActionState", js)
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m unittest tests.test_frontend -v`

Expected: FAIL because the controls/actions do not exist.

- [ ] **Step 3: Add managed node controls**

Use a compact segmented mode control for `Static`/`Managed`. In managed mode require panel and loaded VLESS inbound; show inbound ID, remark, port, and protocol in the select. Keep the share-link template, tags, multiplier, and enabled controls. Hide irrelevant panel/inbound controls for static mode.

- [ ] **Step 4: Add panel inspection and user status actions**

Add `Test`/`Load inbounds` commands on panel rows. Add per-user provisioning counts and an expandable target list with `Retry failed`, `Sync now`, `Disable`, `Enable`, `Renew`, and `Reconcile` commands. Renewal asks separately whether to preserve or reset usage. Reconcile first displays a preview and requires confirmation before applying.

- [ ] **Step 5: Add user availability and settings**

Show last sync time/stale warning on the user account view. Add admin synchronization interval input with min/max validation. Do not expose panel errors to normal users.

- [ ] **Step 6: Prevent duplicate actions and preserve visible errors**

Generalize the existing submit-state helper:

```javascript
async function withActionState(button, action) {
  if (button.disabled) return;
  button.disabled = true;
  try { await action(); }
  catch (error) { showNotice(error.message, "error"); }
  finally { button.disabled = false; }
}
```

Keep stable button dimensions while loading. Use restrained inline status badges; no nested cards.

- [ ] **Step 7: Run syntax and frontend tests**

Run: `node --check static/app.js`

Run: `python -m unittest tests.test_frontend -v`

Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add static/index.html static/app.js static/app.css tests/test_frontend.py
git commit -m "Add managed client controls and status UI"
```

---

### Task 10: Update Operations Documentation and Verify End to End

**Files:**
- Modify: `README.md`
- Modify: `deploy/install.sh` only if verification proves a service setting is required
- Test: all files under `tests/`

- [ ] **Step 1: Update README before final verification**

Document:

- back up `/opt/xui-manager-panel-data/app.db` before upgrade
- update with `git pull --ff-only` and restart systemd
- add/test each panel and load its VLESS inbound ID
- create managed nodes and explain the same-target multiplier/flow rule
- approve a user and interpret provisioned/failed/pending statuses
- retry failures and run manual synchronization
- import the user subscription into Clash and inspect quota/expiry
- verify unique clients in each 3X-UI panel
- configure the sync interval
- inspect `journalctl` without exposing secrets
- recover from panel auth, TLS, inbound mismatch, UUID conflict, and stale-usage errors
- explain up-to-five-minute overage and why each remote client has unlimited local quota

- [ ] **Step 2: Run the complete automated suite**

Run: `python -m unittest discover tests -v`

Expected: all tests PASS.

- [ ] **Step 3: Run static verification**

Run: `python -m compileall -q xui_manager tests tools`

Run: `node --check static/app.js`

Run: `git diff --check`

Expected: all commands exit 0 with no warnings.

- [ ] **Step 4: Run a local HTTP smoke test**

PowerShell:

```powershell
$env:XUI_MANAGER_DATA="$PWD\data-smoke"
$env:LISTEN_HOST="127.0.0.1"
$env:LISTEN_PORT="8765"
$env:ADMIN_EMAIL="admin@example.com"
$env:ADMIN_PASSWORD="local-test-only"
python -m xui_manager.app
```

In another terminal:

```powershell
curl.exe -i http://127.0.0.1:8765/api/plans
curl.exe -I http://127.0.0.1:8765/
```

Expected: API returns HTTP 200 JSON and root returns HTTP 200 HTML.

- [ ] **Step 5: Verify the UI in a real browser**

At desktop `1440x900` and mobile `390x844`, verify login, panel form, managed node mode, inbound select, user status table, retry controls, and account quota display. Confirm no overlapping text, clipped buttons, layout shifts, or console errors. Capture screenshots for the implementation record.

- [ ] **Step 6: Perform a controlled live-panel compatibility test**

Use one administrator-designated test inbound and test user only. Verify:

1. panel login/list succeeds
2. approval creates one unique client
3. repeated approval creates no duplicate
4. subscription contains the stored UUID and connects
5. traffic sync updates upload/download
6. manual disable changes remote enabled state
7. cleanup deletes the test client manually in 3X-UI only after recording results

Do not run this step against production inbounds without explicit approval and a database backup.

- [ ] **Step 7: Commit documentation and final fixes**

```bash
git add README.md deploy/install.sh xui_manager static tests
git commit -m "Document and verify VLESS auto-provisioning"
```

- [ ] **Step 8: Review final history and push**

Run: `git status --short --branch`

Run: `git log --oneline --decorate -12`

Expected: clean feature branch with focused commits.

Push the feature branch and open a reviewable pull request or merge after review; do not deploy to the server until the full test suite and controlled compatibility test pass.

---

## Completion Checklist

- [ ] Old SQLite databases migrate twice without data loss.
- [ ] Managed nodes require explicit panel/inbound and VLESS template validation.
- [ ] Approval creates distinct UUIDs and is idempotent.
- [ ] Partial failures remain usable and retryable.
- [ ] Weighted delta accounting survives multiplier changes and remote resets.
- [ ] Quota/expiry immediately hide managed nodes and remotely disable clients.
- [ ] Clash receives separate upload/download, total, and expiry metadata.
- [ ] Admin APIs and UI never expose passwords or UUIDs.
- [ ] Periodic synchronization starts once and survives cycle failures.
- [ ] Frontend works at desktop and mobile sizes without duplicate actions.
- [ ] README contains upgrade, setup, testing, logs, and recovery instructions.
- [ ] Full automated, syntax, smoke, browser, and controlled live-panel checks pass.
