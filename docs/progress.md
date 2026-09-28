# ClientFlow progress

Status of each milestone and how it was verified. Design details are in
[architecture.md](architecture.md).

| Milestone                                                          | Status   | Commit                  |
| ------------------------------------------------------------------ | -------- | ----------------------- |
| Foundation (Next.js, Prisma, env, errors, health check, tests, CI) | Complete | `283aff2`               |
| Tenant isolation (scoped client, composite keys, import boundary)  | Complete | `283aff2`               |
| Authentication, organizations, RBAC, security headers              | Complete | `0a3aad0`               |
| Client management                                                  | Complete | `0a3aad0`               |
| Project management                                                 | Complete | `9760cdc`               |
| Task management / Kanban                                           | Complete | _pending (next commit)_ |
| Invoices                                                           | Next     |                         |
| Member management (invitations, role changes)                      | Planned  |                         |
| Audit logs, reporting, dashboard                                   | Planned  |                         |

## Task management / Kanban (completed 2026-09-28)

**Scope:** tasks belong to one project in the same organization (composite
FK). The optional assignee must be a member of that project (composite FK to
`ProjectMember`), and a trigger unassigns tasks when someone leaves the
project. Create, view, edit, delete, assign/unassign, priority, due date,
description and status. Kanban board on the project page with drag-and-drop
(`@dnd-kit/core`), a "Move to" control, per-column quick-add, filters (search,
assignee, priority), and optimistic moves that roll back when the server
rejects them. Moves are atomic compare-and-set (409 on a stale move). Task
history lives in `ProjectActivity`.

**Verification:**

- **Unit tests:** 184/184, including board, cards, form, toolbar, rollback and
  drop handling.
- **Integration tests:** 261/261 against real PostgreSQL, covering:
  - CRUD, assignment, invalid statuses and assignees;
  - cross-organization and IDOR attempts, unauthenticated requests, and the
    role matrix;
  - a row-lock race test for atomic moves;
  - a query-count test (the board takes 5 SQL statements regardless of size).
- **Live production build, pages:** board, task page and filters render
  correctly; foreign tasks and projects return 404; Member controls match the
  permission model; the CSP nonce is on every script.
- **Live production build, Server Actions over HTTP (35/35):**
  - create, update, move, stale-move 409, invalid status;
  - assignment validation, including a user from another organization;
  - cross-organization 404s, Member forbidden on delete;
  - forged and signed-out sessions rejected by the action itself;
  - delete keeps history.
- **Real browser (Chromium via Playwright, OS-level pointer events):**
  - drag TODO → IN_PROGRESS → REVIEW → DONE, each persisted and still correct
    after a refresh;
  - drops on the same column or outside a column do nothing;
  - a stale drag (the card was moved elsewhere meanwhile) is rejected with an
    error, the card rolls back, and the database is unchanged;
  - the "Move to" control works and persists after a refresh;
  - no console or CSP errors.

**Known follow-ups:**

- **Member scope:** MEMBERs can create, edit and move tasks in any project of
  their organization (not delete), matching the organization-wide
  `project:read`. Limiting them to their own projects needs an RBAC decision.
- **Board limits:** no manual reordering within a column (sorted by priority,
  then due date), and at most 500 cards per board (with a notice to filter).
- **Browser tests:** browser checks are ad-hoc scripts, not part of CI. Adding
  Playwright E2E tests is a planned testing milestone.
- **Tablets and phones:** drag-and-drop was exercised with a desktop mouse
  only. On touch devices the "Move to" control is the reliable path.
