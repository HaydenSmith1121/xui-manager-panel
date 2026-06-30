# VLESS Auto-Provisioning and Aggregate Quota Design

Date: 2026-06-30
Status: Approved in conversation

## Summary

Extend X-UI Manager so an administrator can approve a user's selected plan and automatically create a distinct VLESS client for that user on every eligible 3X-UI inbound. The application will generate the user's aggregate subscription with those distinct UUIDs, collect traffic from all provisioned clients, apply configured multipliers, expose dynamic quota metadata to Clash, and disable every remote client when the aggregate quota is exhausted or the plan expires.

Provisioning is best-effort across servers. A failed panel or inbound does not roll back successful clients; the administrator sees the failure and can retry it safely.

## Goals

- Create one distinct VLESS client per user and eligible `(panel, inbound)` target after administrator approval.
- Include only nodes allowed by the user's selected plan.
- Generate VLESS subscription entries with each user's stored UUID while retaining the node's server, port, transport, TLS, Reality, SNI, fingerprint, and other connection parameters.
- Aggregate upload and download traffic across all panels, applying the configured multiplier once per provisioning target.
- Display dynamic used traffic, total quota, and expiry in Clash through `Subscription-Userinfo`.
- Disable all provisioned clients when the aggregate quota is exhausted or the account expires.
- Make provisioning, synchronization, and disabling idempotent and retryable.
- Preserve existing databases and legacy static nodes during upgrade.

## Non-Goals

- Automatic provisioning for VMess, Trojan, Shadowsocks, or other protocols in this release.
- Payment processing or automatic payment confirmation.
- Hard real-time quota enforcement. Enforcement follows the configured synchronization interval, so a small amount of overage is possible.
- Editing 3X-UI databases directly over SSH.
- Sharing one UUID between users.

## Chosen Approach

Use the official 3X-UI HTTP API. Each panel adapter authenticates with the username and password already stored in the application, reads the selected inbound, creates or updates a VLESS client, retrieves per-client traffic, and enables or disables that client. API-token authentication can be added later and is not part of this release.

The alternatives were rejected:

- Aggregating panel subscription URLs cannot provide reliable per-user credentials or aggregate enforcement.
- Direct database modification is tightly coupled to 3X-UI internals and risks corrupting panel state.

3X-UI exposes interactive Swagger documentation and an OpenAPI specification at `<panel-base>/panel/api/openapi.json`. The implementation will use the documented inbound endpoints, including `list`, `get`, `addClient`, `updateClient`, and client traffic lookup. Because installed panel versions can differ, the adapter must validate results by reading the inbound after a mutation rather than trusting only the mutation response.

## Domain Model

### Provisioning Target

A provisioning target is the unique tuple `(panel_id, inbound_id)`. Multiple subscription nodes may point to the same target when they are alternate names or connection presentations for one inbound. The application creates only one remote client for a user on that target and reuses its UUID in every node linked to that target.

3X-UI reports client traffic at inbound granularity. It cannot identify which of several local node records sharing one inbound carried the traffic. Therefore:

- All enabled nodes on the same provisioning target must have the same multiplier.
- All enabled nodes on the same provisioning target must require the same VLESS client `flow` value.
- The admin form rejects conflicting multipliers on one target.
- Conflicting multipliers or client flow values require separate 3X-UI inbounds.

### Managed Client Record

Add a managed-client table with at least:

- local ID
- user ID
- panel ID
- inbound ID
- protocol (`vless` in this release)
- generated VLESS UUID, persisted before the first remote request
- deterministic remote client label `xum-u<user_id>-p<panel_id>-i<inbound_id>`
- VLESS client flow derived from the validated node template, such as `xtls-rprx-vision` or empty
- multiplier snapshot
- desired expiry timestamp
- remote enabled state
- provisioning state: `pending`, `provisioned`, `failed`, `disabled`
- last error, attempt count, last attempt time
- last synchronized upload, download, and timestamp
- created and updated timestamps

Enforce a unique constraint on `(user_id, panel_id, inbound_id)`. The remote label is deterministic and does not expose the user's login email. UUIDs and panel credentials must never appear in logs or ordinary admin API responses.

### Usage Ledger

Traffic accounting needs target-level cursors rather than the existing node-level `usage_records`, because multiple nodes can share one provisioning target. Add a target usage ledger containing:

- managed-client ID
- latest remote upload and download counters
- accumulated raw upload and download deltas
- accumulated weighted upload and download totals
- current multiplier and the raw-counter baseline at which it became effective
- last successful synchronization timestamp

Each synchronization adds only the positive delta since the previous remote counter. It multiplies that delta by the multiplier active for that interval and adds it to the persistent weighted total. This preserves previously billed traffic when a multiplier changes or a remote counter resets.

### Node Mode

Nodes gain an explicit mode:

- `managed`: VLESS node bound to a panel and inbound; subscription credentials come from a managed-client record.
- `static`: legacy behavior; the complete share link is used as configured.

Existing nodes migrate to `static` to avoid breaking current subscriptions. The admin UI clearly identifies them, and new auto-provisioned service should use `managed` nodes.

## Eligibility Rules

When a user is approved, eligible managed nodes must satisfy all of these conditions:

- node is enabled
- panel is enabled
- node protocol is VLESS
- node is bound to an explicit panel and inbound ID
- the user's plan is enabled
- node tags intersect the plan's allowed tags, or the plan allows all tags

Eligible nodes are deduplicated by provisioning target before remote API calls.

## Approval and Provisioning Flow

1. The administrator approves the user and confirms quota and expiry.
2. The database transaction activates the account and creates missing `pending` managed-client records for eligible targets.
3. The provisioning service processes each target independently.
4. It logs into 3X-UI, reads and validates the inbound protocol, and checks for the deterministic remote label.
5. If the matching label and stored UUID already exist remotely, the service verifies and reconciles expiry/enabled state without creating a duplicate. If the label exists with another UUID, provisioning stops with a visible conflict and never overwrites or silently adopts that client.
6. Otherwise, it creates a VLESS client with a generated UUID, the target's validated client flow, unlimited panel-local traffic, the application expiry timestamp, and enabled state.
7. The service reads the inbound again and verifies the client, UUID, expiry, and enabled state.
8. It stores `provisioned` or a sanitized `failed` result.
9. The admin response summarizes successful, failed, and pending targets.

Approval is not rolled back when one target fails. Repeating approval or clicking retry is safe because the local unique constraint and deterministic remote label make the operation idempotent.

Only targets allowed by the selected plan are provisioned. Editing a plan or node does not silently change already-approved users. The admin UI provides an explicit reconcile action that previews newly eligible and newly ineligible targets before applying those changes.

## Subscription Generation

For each eligible managed node:

1. Load the user's provisioned managed-client for the node's target.
2. Parse the administrator's VLESS share link as structured URI data.
3. Replace only the URI user information with the managed client's UUID.
4. Preserve host, port, query parameters, and fragment-derived display name.
5. Convert the resulting link to the existing Clash proxy representation.

Failed or pending managed targets are omitted from the subscription until provisioned. Static nodes continue using their configured credentials for backward compatibility.

An inactive, expired, or quota-exhausted user receives no usable proxy configuration. For a valid subscription token, the endpoint returns HTTP 200 with valid empty Clash YAML and the normal subscription metadata headers so Clash can continue displaying quota and expiry instead of reporting a fetch error. An invalid token receives HTTP 404 without account details.

The subscription response contains:

```text
Subscription-Userinfo: upload=<weighted-upload>; download=<weighted-download>; total=<plan-bytes>; expire=<unix-seconds>
```

This lets compatible Clash clients display used traffic, total traffic, remaining traffic, and expiry.

## Traffic Accounting

The synchronization worker runs every five minutes by default; the interval is configurable in the admin settings.

For each provisioned target, the worker reads the remote client's cumulative upload and download counters. It stores the latest raw counters and computes weighted totals:

```text
weighted_upload   = remote_upload   * target_multiplier
weighted_download = remote_download * target_multiplier
user_used         = sum(weighted_upload + weighted_download)
```

The usage ledger applies the multiplier only to new counter deltas. Historical weighted totals are never recalculated when an administrator changes a multiplier. A deliberate reset or renewal operation establishes a new accounting baseline only when the administrator explicitly requests it.

Counter decreases are treated as a remote reset, not negative usage. The application records a new baseline and preserves already-accounted historical usage. Unreachable panels retain their last known values and surface a stale-data warning.

## Enforcement

Remote VLESS clients receive `totalGB = 0` (unlimited) because assigning the full plan quota independently on every panel would multiply the user's allowance. Aggregate enforcement belongs to this application.

After every synchronization and at startup reconciliation, the service evaluates:

- account active state
- plan expiry
- aggregate weighted usage against quota
- administrator manual-disable state

If any disabling condition applies, it calls the 3X-UI update-client endpoint for every provisioned target and verifies that each remote client is disabled. Partial failures are recorded and retried. Subscription generation stops returning usable managed nodes immediately, even while a remote disable retry is pending.

Renewal or administrator re-enable updates expiry and enabled state on all eligible targets, resets accounting only when explicitly requested, and retries partial failures.

## Admin Experience

### Panels

- Create and edit panel connection settings.
- Test authentication without exposing credentials.
- Load and display inbound IDs, remarks, ports, and protocols from the panel.
- Show last successful connection and sanitized error state.

### Nodes

- Choose `managed` or `static` mode.
- For managed mode, choose a panel and VLESS inbound from a loaded list.
- Configure display name, tags, multiplier, share-link template, and enabled state.
- Validate that the link is VLESS and that its connection parameters match the selected inbound closely enough to avoid obvious mistakes.
- Block conflicting multipliers or VLESS client flow values for nodes sharing one provisioning target.

### Users and Approval

- Show plan, quota, expiry, weighted usage, remaining usage, and subscription link.
- Show provisioning totals and per-target state.
- Provide actions for approve, retry failed, synchronize now, disable, re-enable, and renew.
- Disable repeated action buttons while a request is in progress and show success or failure feedback.

### User Portal

- Show subscription link and copy action.
- Show used, remaining, total, expiry, and last synchronization time.
- Show a simple availability summary without revealing panel credentials or internal errors.

## Error Handling and Recovery

- Network, authentication, TLS, validation, and remote API errors are isolated per target.
- Stored and displayed errors are sanitized; passwords, session cookies, API tokens, and UUIDs are redacted.
- Retries use bounded timeouts and do not duplicate clients.
- Empty or malformed mutation responses trigger verification by reading the inbound.
- A background reconciliation pass repairs `pending`, `failed`, or state-mismatched records.
- Deleting a user or managed node requires explicit confirmation. Remote client deletion is a separate deliberate operation; normal plan expiry disables clients rather than deleting them.

## Security

- Continue hashing application user passwords.
- Keep panel credentials server-side and exclude them from list APIs.
- Authenticate to 3X-UI with the existing server-side panel credentials; API-token support is deferred.
- Support TLS certificate verification per panel, with insecure mode visibly marked.
- Protect all provisioning and synchronization endpoints with administrator authorization. Mutating APIs require `Content-Type: application/json` and a same-origin `Origin` or `Referer` check in addition to the existing `HttpOnly; SameSite=Lax` session cookie.
- Never place real credentials, panel URLs with secrets, or generated client UUIDs in source control.

## Database Migration

The migration is additive and runs through the existing database initialization path:

- create managed-client, target usage ledger, and synchronization-state tables
- add node mode and any required target metadata with backward-compatible defaults
- create uniqueness and lookup indexes
- preserve all existing users, plans, panels, nodes, usage records, sessions, and subscription tokens

Migration must be repeatable. Starting the upgraded application against an already-migrated database must not modify or duplicate data.

## Testing Strategy

### Unit Tests

- eligible-node filtering and target deduplication
- deterministic remote labels and UUID handling
- VLESS URI credential replacement without changing transport parameters
- multiplier/client-flow validation and weighted accounting
- remote counter reset handling
- quota and expiry decisions
- secret redaction

### API Adapter Tests

Use fake HTTP responses for session login, list/get inbound, add client, update client, traffic lookup, empty mutation response, malformed response, timeout, TLS failure, and authentication failure. Verify post-mutation readback behavior.

### Service Tests

- successful multi-panel provisioning
- one-panel failure with other targets retained
- retry after partial failure
- repeated approval without duplicate clients
- deterministic-label conflict with a different remote UUID
- quota exhaustion disabling every target
- partial disable failure and reconciliation
- renewal and re-enable behavior

### Integration and Migration Tests

- upgrade a copy of the old SQLite schema without data loss
- generate a Clash subscription containing only the correct per-user UUIDs
- verify `Subscription-Userinfo` upload, download, total, and expiry values
- verify static legacy nodes keep their previous behavior
- verify user and admin pages expose status but not secrets

## Deployment and Operations

The existing single-service deployment remains valid. The process starts a lightweight periodic synchronization/reconciliation worker alongside the HTTP application, guarded so only one worker runs per deployed instance. For future multi-instance deployments, this worker should move to a separately elected or scheduled process.

Operational logs include user ID, panel ID, inbound ID, action, status, duration, and sanitized error category. They exclude credentials and UUIDs. Admin settings expose the synchronization interval and a manual run action.

## Acceptance Criteria

- Approving one user against three eligible VLESS targets creates three distinct remote clients and one local record per target.
- A second user receives different UUIDs on every target.
- Nodes sharing a target reuse the same user UUID and cannot configure conflicting multipliers.
- One unavailable panel does not undo successful provisioning, and retry completes the missing target without duplicates.
- Clash displays weighted usage, total quota, and expiry from the subscription response.
- Aggregate weighted usage reaching quota disables all reachable clients and immediately removes managed nodes from the subscription.
- Expiry performs the same disable behavior.
- Existing installations migrate without losing current data or breaking static subscriptions.
- Automated tests cover provisioning, retry, subscription rewriting, accounting, enforcement, authorization, and migration.
