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
| Task management / Kanban                                           | Complete | `ae13b04`               |
| Invoices                                                           | Complete | _pending (next commit)_ |
| Member management (invitations, role changes)                      | Planned  |                         |
| Audit logs, reporting, dashboard                                   | Planned  |                         |

## Invoices (completed 2026-09-28)

**Scope:** draft invoices for a client of the organization, with line items
editable only while the invoice is a draft. Issue (sequential per-organization
number), mark paid, cancel. OVERDUE is derived from the due date. Totals,
discount and tax are computed on the server in integer cents (BigInt, half-up
rounding). PDF download and print view. List with search, status, client and
sort filters; details page; the client page shows the client's invoices.
Database CHECK constraints and triggers enforce total consistency, valid
transitions and immutability of issued invoices. Design:
[architecture.md §6d](architecture.md#6d-invoice-management).

**Verification:**

- **Unit tests:** 222/222, including 13 money-arithmetic tests (rounding,
  exactness beyond 2^53, parsing, formatting) and the invoice components:
  line-item editor, actions, form, table, toolbar, and nav permissions.
- **Integration tests:** 296/296 against real PostgreSQL, 35 of them for
  invoices:
  - creation and client-supplied totals being ignored;
  - line-item, tax and discount recalculation;
  - valid and invalid transitions, and the derived overdue status;
  - editing restrictions in the service and in the database triggers, and the
    CHECK constraints;
  - atomic rollback, concurrent item additions, a held-row-lock race, and
    unique numbering under concurrent issuing;
  - client ownership, the role matrix, cross-organization isolation, and
    unauthenticated requests;
  - the PDF (including non-Latin text), and organization deletion through the
    triggers.
- **Real browser (Chromium via Playwright, production build), 24/24:**
  - create a draft through the form; add, edit and remove line items, with
    displayed totals matching the database to the cent;
  - invalid input rejected with a message;
  - issue (INV-0001, editing locked), download the PDF, and the print layout;
  - mark paid; an empty draft refused on issue, then cancelled;
  - list filters, and the client page listing the client's invoices;
  - a foreign invoice (page and PDF) returns 404;
  - MEMBER: no nav item, access denied, and 403 on the PDF;
  - no console or CSP errors.

**Bugs found and fixed during verification:**

- **Cancelling a draft failed:** the migration's `Invoice_issued_fields_check`
  wrongly required issuing fields on every non-draft status. Fixed before
  commit; covered by the DRAFT → CANCELLED test.
- **Stale error on issued invoices:** the line-item editor kept an old
  validation error after the invoice was issued, and it appeared in the print
  view. Its temporary state now resets when the invoice becomes read-only, and
  errors are hidden when printing. Regression test added.

**Known follow-ups:**

- Partial payments, refunds or credit notes, emailing invoices, and an invoice
  activity history.
- A default currency and tax rate per organization; currencies without 2
  decimals (e.g. JPY) are not supported yet.
- PDF fonts are limited to WinAnsi; non-Latin text shows as "?". Embedding a
  Unicode font would fix it.

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
