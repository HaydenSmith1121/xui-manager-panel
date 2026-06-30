# Explicit Form Modes And Logout Design

## Problem

The plan and panel forms contain a hidden `id`. Clicking Edit fills that ID, so a later save updates the selected record. Because the UI does not show whether the form is creating or editing, entering different values can look like creating a second item while it actually replaces the first one.

The application also creates server-side sessions but offers no way to revoke the current session or clear its cookie.

## Design

- Give the plan and panel forms an explicit create/edit mode.
- Add a New action beside each form title. New clears the form ID and restores defaults.
- Edit changes the title and submit label to make the current mode visible.
- After a successful create or update, reset the form to create mode.
- Add a Logout button to the signed-in sidebar session area.
- Add `POST /api/logout`, delete the current session from SQLite, and expire the session cookie.
- After logout, clear client state, return to the account view, and show the login/register forms.

## Verification

- Database and API tests prove logout invalidates the session and expires the cookie.
- Frontend contract tests prove the New controls, explicit mode helpers, and Logout control are wired.
- Existing tests continue to pass.
