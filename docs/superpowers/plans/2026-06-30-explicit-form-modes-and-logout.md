# Explicit Form Modes And Logout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make plan and panel creation distinct from editing, and let signed-in users securely log out.

**Architecture:** Keep the existing standard-library Python API and vanilla JavaScript UI. Add one database session deletion method and one public logout route, then manage form mode through small frontend reset/edit helpers that control the hidden ID and visible labels.

**Tech Stack:** Python 3, SQLite, `unittest`, vanilla JavaScript, HTML, CSS

---

### Task 1: Logout API

**Files:**
- Modify: `tests/test_core.py`
- Modify: `xui_manager/db.py`
- Modify: `xui_manager/app.py`

- [x] Add a failing API test that logs in, calls `POST /api/logout`, verifies an expired session cookie, and verifies `/api/me` no longer returns a user.
- [x] Run `python -m unittest tests.test_core.AppTests.test_logout_invalidates_current_session -v` and confirm it fails because the route does not exist.
- [x] Add `Database.delete_session`, parse the current session token, and implement `POST /api/logout`.
- [x] Re-run the focused test and confirm it passes.

### Task 2: Explicit Create And Edit Modes

**Files:**
- Modify: `tests/test_frontend.py`
- Modify: `static/index.html`
- Modify: `static/app.js`
- Modify: `static/app.css`

- [x] Add failing frontend contract tests for New buttons, mode labels, form reset helpers, and the Logout button.
- [x] Run `python -m unittest tests.test_frontend -v` and confirm the new tests fail because the controls are absent.
- [x] Add plan and panel New actions, visible mode labels, and explicit reset/edit helpers.
- [x] Ensure every successful save resets the corresponding form into create mode.
- [x] Add Logout UI behavior that calls the API and clears admin data from the page.
- [x] Re-run frontend tests and confirm they pass.

### Task 3: Verification And Publish

**Files:**
- Modify: `README.md`

- [x] Document creation/edit behavior and logout.
- [ ] Run `python -m unittest discover tests -v`.
- [ ] Run `python -m compileall -q xui_manager tools`.
- [ ] Run `node --check static/app.js`.
- [ ] Review `git diff --check` and `git status --short`.
- [ ] Commit the changes and push `main` to GitHub.
