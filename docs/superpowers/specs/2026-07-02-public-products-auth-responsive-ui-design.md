# Public Products, Authentication, and Responsive UI Design

**Date:** 2026-07-02  
**Status:** Approved in conversation  
**Project:** `xui-manager-panel`

## Objective

Refresh the existing single-page application using the supplied “黑心云” cloud-blue visual direction while preserving the current Python, SQLite, and vanilla HTML/CSS/JavaScript architecture. Visitors must be able to browse live plans without signing in. Applying for a plan requires an account. Administrators must be able to permanently delete a disabled user only after all managed X-UI clients have been removed successfully.

This work also adds distinct desktop and mobile presentations, a fixed desktop sidebar, and lightweight elapsed-time feedback for slow requests.

## Scope

### Included

- Public product catalog backed by the existing enabled-plan API.
- Separate registration, login, and plan-application actions.
- Resume the selected application after authentication.
- Redesigned login and registration modal.
- User subscription workspace and administrator workspace.
- Desktop and mobile responsive compositions from one maintainable frontend.
- Fixed desktop sidebar and mobile navigation.
- Slow-request animation with elapsed seconds.
- Disabled-user deletion with X-UI client cleanup.
- Automated backend and frontend contract tests.
- Preservation of the current uncommitted subscription-title feature.

### Excluded

- Payment processing, orders, refunds, email verification, tickets, and traffic-pack accounting.
- A second frontend framework or build pipeline.
- Hard-coded prices or products from the static mockup. The live plan configuration is the source of truth.
- Separate desktop and mobile codebases.

## Visual Direction

**Visual thesis:** A restrained cloud-blue service storefront with strong whitespace, dark navy typography, a single electric-blue action color, and the supplied black-and-white cloud shield identity.

**Content plan:** Brand and service promise, live plans, concise usage reassurance, account or subscription context, and a final application action.

**Interaction thesis:** Buttons provide immediate tactile feedback; authentication appears in place without losing the selected plan; requests that exceed 600 milliseconds transition into a calm elapsed-time loader instead of appearing frozen.

The visual implementation should reference `cloud-blue-home-d-logo-v9.html` for brand, color, spacing, and product emphasis. It should not copy mock data, fixed prices, or mobile-device chrome from the design export.

## Information Architecture

The application remains a single HTML document with state-driven views:

1. **Public storefront** — always available and always shows enabled live plans.
2. **Authentication dialog** — login and registration tabs, opened from the header or a plan application.
3. **User workspace** — subscription status, quota, expiry, and subscription URL.
4. **Administrator workspace** — users, nodes, plans, panels, and settings.

The public storefront remains visible to signed-in users so product browsing does not disappear after login. Role-specific navigation exposes the user workspace or administrator workspace as appropriate.

## Responsive Layout

### Desktop, 921 pixels and wider

- A fixed left sidebar occupies the viewport height and does not move while the main content scrolls.
- The main content receives a left offset equal to the sidebar width.
- Public plans use a roomy multi-column layout where space permits.
- Administrator tables remain dense, with sticky context and horizontally safe overflow only as a fallback.
- Authentication uses a centered modal with a constrained width.

### Mobile, 920 pixels and narrower

- The sidebar is removed from document flow.
- A compact brand header and role-aware bottom navigation replace it.
- Plans render as a single column with full-width tap targets.
- Administrator user rows render as stacked cards rather than requiring horizontal table scrolling.
- Dialogs become near-full-screen sheets with safe-area padding.
- All controls meet a practical touch target of at least 44 pixels.

Desktop and mobile are two deliberate presentations produced from shared markup and behavior, not duplicated applications.

## Authentication and Application Flow

### Visitor browsing

`GET /api/plans` remains public. The product catalog renders plan name, quota, duration, and approval behavior from the response. Disabled plans are not returned or shown.

### Visitor applies for a plan

1. The visitor clicks “立即申请” on a live plan.
2. The frontend stores the selected `plan_id` in transient page state.
3. The authentication dialog opens on the login tab, with a clear option to register.
4. After successful login or registration, the frontend submits the stored plan application automatically.
5. The selected plan is cleared only after success or an explicit dialog cancellation.

### Registration

Registration creates credentials only and does not require a plan. A successful registration also establishes a session so the pending application can continue without making the user log in again.

### Logged-in application

The authenticated application endpoint accepts a `plan_id`, validates that the plan exists and is enabled, and assigns the plan to the current ordinary user. A plan requiring approval moves the user to `pending`. A plan not requiring approval activates and provisions the user through the existing provisioning service.

The endpoint rejects:

- unauthenticated callers;
- administrator accounts;
- disabled or missing plans;
- an application that would silently replace an active subscription;
- duplicate pending applications for the same plan.

Every rejection returns a clear Chinese error suitable for direct display.

## API Changes

### `POST /api/register`

Request:

```json
{
  "email": "user@example.com",
  "password": "secret123"
}
```

Response includes the newly created signed-in user. `plan_id` is no longer required.

### `POST /api/applications`

Requires an authenticated ordinary-user session.

Request:

```json
{
  "plan_id": 12
}
```

Response includes the updated user and, when auto-activation applies, the provisioning summary and sanitized failure details.

### `POST /api/admin/users/delete`

Requires an authenticated administrator and same-origin mutation checks.

Request:

```json
{
  "user_id": 42
}
```

The route rejects administrators and users whose status is not `disabled`.

## User Deletion Semantics

Deletion is intentionally conservative:

1. Load the target user and reject invalid or non-disabled targets.
2. Enumerate every managed-client record for the user.
3. Group cleanup work by panel and inbound.
4. Log in to each enabled configured panel and remove the exact client UUID associated with that managed-client record.
5. Treat an already-missing remote client as successfully cleaned up.
6. If any cleanup fails, keep the local user and all local records intact, keep the user disabled, and return sanitized panel/inbound failure details for retry.
7. Only after every remote cleanup succeeds, delete local records in one database transaction. Delete usage ledgers, managed clients, usage records, and sessions in dependency order, then delete the user. The current schema does not cascade every user relationship, so this cleanup must be explicit.

The X-UI client wrapper gains a narrowly scoped delete-client operation. Tests must verify the exact inbound and UUID are used and that panel secrets never appear in responses.

## Loading and Feedback

- A submitted button disables immediately, retains its width, and displays a small inline spinner.
- A request-wide loading indicator is delayed by 600 milliseconds to prevent flicker on fast requests.
- Once visible, it shows a lightweight animated mark, an action label, and elapsed whole seconds.
- The loader disappears in a short fade when the operation finishes, including failure paths.
- Concurrent requests use a reference count so one completed request cannot hide another active request.
- Destructive actions use confirmation dialogs with explicit object context.
- Notices distinguish success, validation failure, authentication expiry, and remote-panel failure.
- `prefers-reduced-motion: reduce` disables nonessential animation.

## Performance

- Keep the current dependency-free frontend and avoid a framework migration.
- Cache DOM references used repeatedly and render only the affected region after common actions.
- Do not re-fetch administrator data when a visitor browses products.
- Use parallel requests only for independent administrator resources.
- Avoid expensive blur effects on mobile and low-power devices.
- Use CSS transforms and opacity for motion to avoid layout thrashing.

## Error Handling

- Network and malformed-response errors produce a stable Chinese fallback message.
- A 401 response clears stale session UI, opens authentication when appropriate, and preserves a pending plan selection.
- Application errors keep the selected plan so the user can correct credentials or retry.
- X-UI cleanup failures show panel name and inbound ID but never address credentials, passwords, client UUIDs, or stored secrets.
- Local deletion never runs after partial remote cleanup failure.

## Accessibility

- Authentication is a real modal dialog with focus entry, focus return, Escape-to-close, and labelled tabs.
- Every icon-only control has an accessible label.
- Status is conveyed by text in addition to color.
- Keyboard focus styles remain visible.
- Form errors associate with their fields or appear in an announced summary.

## Testing Strategy

### Backend tests

- Registration succeeds without `plan_id` and establishes a session.
- Unauthenticated application is rejected.
- Authenticated application assigns the selected enabled plan.
- Approval-required and auto-active plans follow their respective paths.
- Active-plan replacement and duplicate pending application are rejected safely.
- Only disabled ordinary users may be deleted.
- Remote deletion uses the correct panel, inbound, and client UUID.
- Already-missing remote clients are idempotent success.
- Partial X-UI failure preserves all local records and redacts secrets.
- Full cleanup explicitly deletes the user and every dependent local record in one transaction.

### Frontend contract tests

- Public plan catalog and application controls exist independently of authentication markup.
- Login and registration no longer contain a plan selector.
- Authentication dialog, mobile navigation, desktop sidebar, user cards, loading timer, and reduced-motion rules exist.
- Disabled users receive a delete action; other user states do not.
- Existing plan, panel, node, settings, subscription-title, and provisioning controls remain available.

### Manual responsive verification

- Desktop at 1440×900 and 1024×768.
- Mobile at 390×844 and 360×800.
- Visitor, ordinary user, pending user, disabled user, and administrator states.
- Slow request simulation, network failure, X-UI partial cleanup failure, keyboard navigation, and reduced-motion mode.

## Acceptance Criteria

- A visitor can see every enabled live plan without signing in.
- Clicking apply while signed out leads through authentication and resumes the selected application.
- Registration and login are visually clear and no longer require choosing a plan.
- A signed-in user can apply for an enabled plan and see the resulting status.
- A disabled ordinary user can be deleted only after all X-UI clients are removed.
- A remote cleanup failure leaves the local account available for retry and exposes no secret.
- Desktop scrolling keeps the left navigation fixed.
- Mobile uses a purpose-built single-column composition and navigation, not a squeezed desktop table.
- Requests longer than 600 milliseconds show an animated elapsed-time indicator.
- Existing backend capabilities and the in-progress subscription-title changes continue to pass tests.
