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
| Invoices                                                           | Complete | `09634fa`               |
| Dashboard                                                          | Complete | `a6aa284`               |
| Audit logging                                                      | Complete | `393f667`               |
| Security audit and fixes                                           | Complete | `393f667`               |
| UI polish, testing pass, performance audit and fixes               | Complete | `393f667`               |
| Production readiness (application part; see operations.md)         | Complete | `393f667`               |
| Final verification and documentation                               | Complete | _pending (next commit)_ |
| Member management (invitations, role changes)                      | Planned  |                         |

## Final release verification (2026-09-28)

**Clean state:** build output deleted; the development, test and benchmark
databases were dropped and recreated.

| Check                                           | Result                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Migrations on an empty database                 | 10/10 applied, `migrate status` up to date, drift check clean, schema valid           |
| `npm run check` (typecheck, lint, format, unit) | 347/347                                                                               |
| Integration tests (real PostgreSQL)             | 405/405, on a freshly created test database and again on a warm one                   |
| Production build                                | Passed. The server validates its configuration at startup; liveness and readiness 200 |

**Real browser, production build, 181/181 checks:**

| Script              | Checks | Covers                                                                                                         |
| ------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| End-to-end journeys | 21     | Sign-up, organization, client, project, task and assignment, Kanban, dashboard, audit log, MEMBER restrictions |
| Kanban              | 26     |                                                                                                                |
| Invoices            | 24     | Create, issue, pay, cancel, PDF                                                                                |
| Dashboard           | 28     |                                                                                                                |
| Audit log           | 26     |                                                                                                                |
| Capped audit log    | 6      |                                                                                                                |
| Security            | 33     | Cross-organization access, forged IDs, unauthorized access, rate limits, XSS                                   |
| Keyboard            | 14     |                                                                                                                |
| Database outage     | 3      | Error page with reference, fast failure                                                                        |

Also:

- **Mobile and accessibility survey:** 68 screen/width combinations, with
  no overflow and no axe violations.
- **During the outage:** liveness 200, readiness 503; it recovered
  afterwards.
- All temporary services were stopped afterwards.

**Bug found during final verification (test only):** three plan checks in
`tests/integration/performance.test.ts` depended on table statistics, and
failed on a freshly created test database. The check now runs `ANALYZE` and
prefers plain index scans without explicit sorts, so it tests whether an
index can serve the query and its order. Verified on fresh and warm
databases.

## Production-readiness pass (completed 2026-09-28)

**Application fixes:**

- **Startup:** `src/instrumentation.ts` validates the database, auth and email
  configuration before the server accepts requests. An invalid configuration
  logs the reason and exits with code 1. Next.js otherwise keeps a broken
  server running that answers every request with 500; this was found and
  fixed during verification.
- **Server errors:** every error from rendering, routes, actions or the proxy
  is logged as one JSON line (`msg: "Request failed"`) with the digest users
  see. Query strings are dropped, because they can contain reset tokens.
- **Database connections:** each process has a bounded pool
  (`DATABASE_POOL_MAX`), a connect timeout (`DATABASE_CONNECT_TIMEOUT_MS`;
  node-postgres otherwise waits forever) and a statement timeout
  (`DATABASE_STATEMENT_TIMEOUT_MS`).
- **Email:** SMTP connection, greeting and socket timeouts (the defaults were
  2 minutes and 10 minutes).
- **Rate-limit counters** are stored in PostgreSQL (`RateLimit`, migration
  `rate_limit_storage`), so they are shared by all instances and survive
  restarts.
- **Health:** `/api/health/live` for liveness (no database); `/api/health`
  stays the readiness check.
- **Runbook:** [operations.md](operations.md) covers infrastructure,
  configuration, roles, migrations (expand/contract, index locks), backups
  and restore tests, deploy and rollback, and monitoring.

**Verification:**

- Unit tests 347/347 and integration tests 405/405, including new tests for:
  - startup validation and exit;
  - error logging without query strings;
  - pool and SMTP settings, and the liveness probe;
  - a statement cancelled by the timeout, and an unreachable database
    failing within the connect timeout;
  - rate-limit counters shared by a second server instance.
- **Fresh database:** all 10 migrations applied cleanly and the drift check
  reports no difference. `db/runtime-role.sql` gives `AuditLog` INSERT and
  SELECT only, row access elsewhere, and nothing on `_prisma_migrations`.
- **Production build, invalid configuration:** exits with code 1 and one
  JSON error line; no process is left running.
- **Production build as the least-privilege role on the fresh database:**
  - configuration validated at startup;
  - liveness and readiness 200;
  - a real sign-up and verification work, with rate-limit rows written.
- **Database stopped:** liveness 200, readiness 503 at once, and signed-in
  pages fail in about 12 ms with a structured "Request failed" log. The app
  recovers when the database returns.
- **SMTP stopped:** sign-up still responds (76 ms), and "Email delivery
  failed" is logged.

**Still required outside the repository:** see
[operations.md](operations.md): TLS and HTTPS, the proxy and client-IP
settings, the runtime database role, backups with PITR and restore tests,
log collection and alerts, error tracking, and secret management.

## Performance pass (completed 2026-09-28)

**Method:** the real service functions were measured with Prisma query
logging against a synthetic organization in a scratch database:

- 200 members, 20k clients, 5k projects, 200k tasks;
- 50k invoices, 480k activity rows, 1M audit events;
- a second organization at 20% of that size.

The slowest statements were checked with `EXPLAIN (ANALYZE, BUFFERS)`, before
and after each change.

**Changes (no business behavior changed):**

- **Audit log:**
  - the count is capped at 10,000 and ordered to follow the filter indexes;
  - pages are read from the new `(organizationId, createdAt, id)` index
    without sorting.

  Beyond 10,000 matching events the page shows "10,000+" and the newest
  10,000, and suggests narrowing the date range; below that, nothing
  changes.

- **Dashboard:** open-task counts for the 5 active projects are counted for
  those projects only (previously all of the organization's tasks were
  aggregated). Active projects come from a new
  `(organizationId, status, dueDate)` index. Invoice totals have a covering
  `(organizationId, status, currency, totalCents)` index.
- **Lists:** each list's total is derived from the status counts it already
  computes, so the separate `COUNT` is gone: clients 3 → 2 statements,
  projects 4 → 3, invoices 5 → 4.
- **Invoice search:** client name and company are matched through one
  relation filter (one join instead of two).
- **Indexes:**
  - invoice sorts by amount and due date:
    `(organizationId, totalCents DESC, id)` and
    `(organizationId, dueDate, id)`;
  - client search: `pg_trgm` GIN index on name, company and email.
- **Client page:** the 5-invoice widget uses one plain query (was the full
  list: 5 statements with 3 unused aggregates).
- **Task history:** checks the task's existence with an ID-only lookup
  (7 → 3 statements).

**Measured (database time, large organization):**

| Operation                  | Before  | After  |
| -------------------------- | ------- | ------ |
| Audit log, first page      | 49.7 ms | 0.8 ms |
| Audit log, deepest page    | 191 ms  | 1.5 ms |
| Dashboard                  | 56 ms   | 26 ms  |
| Invoice search             | 61 ms   | 6.8 ms |
| Client search              | 27 ms   | 0.7 ms |
| Invoice sort by amount     | 13 ms   | 2.4 ms |
| Invoice sort by due date   | 12 ms   | 2.8 ms |
| Client page invoice widget | 0.9 ms  | 0.1 ms |

**Verification:**

- `tests/integration/performance.test.ts`, 10 tests:
  - statement counts identical at 1× and 8× data;
  - derived totals equal real counts for every status filter, with and
    without search;
  - the audit count cap, clamping and exact counts below the cap;
  - the new indexes serve the generated SQL (EXPLAIN);
  - invoice search joins `Client` once.
- Unit tests 335/335, integration tests 401/401, typecheck, lint, format
  and build all pass.
- Browser suites 137/137, plus 6/6 checks of the audit log with 10,050
  events.

**Remaining:**

- **Project search** still scans descriptions and joins client names (24 ms
  at 5k projects).
- **Dashboard task counts** are still O(tasks), via an index-only scan.
- **Kanban:** a full page refresh after each move.
- **Payloads:** 500-client filter dropdowns, and the "add member" list on
  every project page.
- **Pagination:** `OFFSET` on the client, project and invoice lists.

## UI/UX polish pass (completed 2026-09-28)

**Method:** every screen (26 owner, 3 member and 5 signed-out views,
including empty, long-content and 404 states) was captured at 1440 px and
390 px on the production build. Each capture was checked for horizontal
overflow and scanned with axe-core (WCAG 2.1 AA and best practices), then
reviewed visually.

**Issues found and fixed:**

- **Mobile lists scrolled sideways (221-489 px):** a long word in a client
  or project name widened the whole card grid. Card lists and cards now use
  a shrinkable single-column grid, so names truncate. The same fix applies
  to the Projects and Invoices lists on the client page.
- **Long names overflowed page titles on mobile:** client and project
  titles now wrap.
- **Outline links rendered without a border** (Edit, Edit details, Download
  PDF, outline "New project" and "Clear filters" links): `buttonVariants()`
  now merges classes like `<Button>` does.
- **Insufficient contrast (WCAG AA):**
  - neutral badges (Draft, Inactive);
  - destructive text on its tint (Overdue badges, alerts, form errors);
  - amber "High" priority text.

  The light-theme `--muted-foreground` and `--destructive` tokens and the
  amber shade were darkened slightly.

- **Keyboard focus was lost** when the archive and invoice confirmation
  steps replaced their buttons. Focus now moves to the confirm button, and
  back to the original action on Back or Cancel.
- **Mobile navigation cut off the current page's item** (e.g. "In…" on
  Invoices, Audit log off-screen). The active item is now scrolled into
  view.
- **Invoice actions on phones** wrapped as a right-aligned jumble. They are
  now left-aligned like the other detail pages; the error text follows.
- **The line-item table's scroll area** was not reachable by keyboard. It
  is now a focusable, labelled region.
- **No `main` landmark** on the sign-in, sign-up, reset, verify, onboarding
  and 404 pages.
- **The 404 page used a link posing as a button:** it is now a real link.

**Verification:**

- 68/68 screen and viewport combinations have no horizontal overflow and no
  axe violations (before: 33 with violations or overflow).
- Keyboard walkthrough on the production build: 14/14.
- Existing browser suites: 137/137.
- 333/333 unit tests (7 new UI tests) and 391/391 integration tests.
- Typecheck, lint, format and build all pass.

## Testing pass (completed 2026-09-28)

**Scope:** a coverage review of every module, adding tests for the gaps.
Every new test runs against real PostgreSQL except the pure unit tests.

- `src/lib/validation/validation.test.ts` (unit):
  - slug and name rules, and `slugify` edge cases;
  - calendar dates (leap days, invalid days, time strings);
  - UTC day boundaries for `isBeforeToday` and `todayUtc`;
  - derived invoice status;
  - money and rate limits exactly at the boundaries;
  - 200/201 invoice items, and stripping of client-sent totals and IDs;
  - project date order and progress bounds, task defaults;
  - `escapeLikePattern`.
- `tests/integration/consistency.test.ts`:
  - races made deterministic with a held row lock:
    - archive vs archive, edit vs archive, restore vs restore (clients);
    - archive vs archive, status change vs archive, edit vs archive
      (projects);
    - concurrent duplicate project member;
    - pay vs cancel of the same invoice;
  - issuing the same invoice twice at once;
  - deleting a task twice;
  - audit-write failures rolling back a client creation and an invoice
    issue (no number consumed);
  - a demoted or promoted member's permissions changing on the next
    request;
  - exactly one audit record per successful change (none for no-op,
    invalid or conflicting ones).
- `tests/integration/edge-cases.test.ts`:
  - issuing an invoice due today (UTC);
  - invoice list:
    - exact and overflowing page boundaries;
    - amount, due-date and number sorts (nulls placement);
    - number search in all accepted notations;
    - status (incl. derived OVERDUE) + client + search combinations with
      scoped counts;
    - an unknown client filter;
  - currencies kept separate, and a draft in each supported currency;
  - Kanban board at exactly 500 and 501 cards;
  - audit log with an inverted date range, unknown or foreign actors, and
    exact page sizes;
  - archived-only and empty organizations.

**Bug found and fixed:** archiving, restoring, editing and changing the
status of clients and projects read the current state and then updated
without re-checking it.

- **Impact:**
  - an edit racing an archive modified the archived record (an edited
    project was even un-archived);
  - a double archive or restore wrote duplicate activity and audit records.
- **Fix:** the updates are now compare-and-set (`updateMany` on the status
  just read, or on "not archived"). The operation that loses gets a 409.

**Results:**

| Check                                      | Result                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| Unit tests                                 | 326/326                                                                   |
| Integration tests                          | 391/391                                                                   |
| Typecheck, lint, format                    | Passed                                                                    |
| Production build                           | Passed                                                                    |
| Existing browser suites (production build) | Kanban 26, invoices 24, dashboard 28, audit log 26, security 33 = 137/137 |

## Security audit fixes (completed 2026-09-28)

A static security audit found no Critical issue, 1 High, 2 Medium and 12 Low
or informational findings. Status of each:

| ID  | Finding                                                                    | Status                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Auth Server Actions bypassed rate limiting                                 | **Fixed.** `callAuthEndpoint` sends them through Better Auth's HTTP pipeline (rate limit, origin check, disabled paths).                                                                                                                            |
| M1  | Forgeable `X-Forwarded-For` (rate limits, audit IPs)                       | **Fixed in code; needs production configuration.** `AUTH_CLIENT_IP_HEADER` / `AUTH_TRUSTED_PROXIES` are required in production. The proxy must be the only way in.                                                                                  |
| M2  | App database role owns the schema                                          | **Fixed in code; needs production configuration.** `db/runtime-role.sql` defines a least-privilege runtime role (verified by a test). The app must connect as it.                                                                                   |
| L1  | Nested reads into User (sessions, accounts, other orgs)                    | **Fixed.** The tenant client only allows User columns under `user` / `actor`.                                                                                                                                                                       |
| L2  | Account events visible in every org of a user                              | **Accepted.** Admins of each organization a person can access need that account's sign-in activity. Documented in §6f.                                                                                                                              |
| L3  | Audit gaps (optional actor, no authz in ownership service, missing events) | **Fixed:** `actor` required, authorization enforced in the service, failed verification codes and password changes audited. **Accepted:** auth events stay best-effort (logged on failure); session revocation and draft edits are not audited yet. |
| L4  | Org/user deletion removes or de-attributes audit history                   | **Accepted for now.** Neither deletion is exposed. Needs a retention/archival decision before one is.                                                                                                                                               |
| L5  | Unbounded display names via Better Auth endpoints                          | **Fixed.** 1-100 characters on sign-up and update-user; Google names truncated.                                                                                                                                                                     |
| L6  | MEMBER can work on tasks in any project                                    | **Accepted.** Current RBAC decision (organization-wide `task:update`), unchanged.                                                                                                                                                                   |
| L7  | No lockout, MFA or breached-password check; sliding sessions               | **Accepted / later.** New features; per-IP limits now apply everywhere (H1, M1).                                                                                                                                                                    |
| L8  | No limits on authenticated writes; deep page offsets                       | **Accepted / later.** Actions are authenticated, authorized and audited; pages are capped (10,000 × 100).                                                                                                                                           |
| L9  | CI supply chain                                                            | **Partly fixed.** Workflow token limited to `contents: read`. SHA pinning and dependency scanning are later.                                                                                                                                        |
| L10 | Database TLS, dev services on all interfaces                               | **Fixed.** Production requires `sslmode` for non-local databases; dev ports bound to 127.0.0.1.                                                                                                                                                     |
| L11 | Public health details                                                      | **Accepted.** Uptime and latency only, no internals; used by probes.                                                                                                                                                                                |
| L12 | CSP `style-src 'unsafe-inline'`                                            | **Accepted.** Documented trade-off; scripts are nonce-only.                                                                                                                                                                                         |

**Verification:**

- **Unit tests:** 281/281, including:
  - client-IP resolution with Better Auth's own `getIP` (forged prefixes
    ignored);
  - env rules (IP config, database TLS, rate-limit flag);
  - nested-read rules and the schema-derived relation list;
  - member removal rules;
  - handler error mapping.
- **Integration tests:** 360/360 against real PostgreSQL, including:
  - `auth-rate-limit.test.ts`: the sign-in, reset and verification Server
    Actions return `RATE_LIMITED` after the limit;
  - `database-privileges.test.ts`: the runtime role works but can't
    UPDATE, DELETE or TRUNCATE the audit log, disable triggers or run DDL,
    and cascades still work;
  - `security-regressions.test.ts`: names, nested reads, and the new
    failure events;
  - escalation attempts against the ownership service.
- **Real browser / HTTP on the production build, 33/33:**
  - UI sign-up, verification and onboarding;
  - stored-XSS payloads inert;
  - replayed Server Actions as MEMBER (FORBIDDEN), signed out, with a forged
    cookie, against another organization (NOT_FOUND), and with forged
    organization and actor IDs (ignored);
  - cross-organization pages and PDFs return 404, MEMBER PDF 403, signed-out
    PDF 401;
  - no audit write endpoint;
  - a 10,000-character name returns 400;
  - an old cookie after sign-out returns 401;
  - the sign-in form is rate limited after 5 attempts, even with the correct
    password;
  - behind an appending proxy, forged `X-Forwarded-For` values don't reset
    the limit;
  - no secrets in audit metadata, and no console, CSP or XSS dialogs.

## Audit logging (completed 2026-09-28)

**Scope:** an append-only, organization-scoped audit trail recorded on the
server. It covers:

- sign-in, sign-out, failed sign-in, and password change and reset;
- organization creation, members added and removed, and role changes, with
  the permissions granted and revoked;
- clients: create, update, archive, restore;
- projects: create, update, status change, archive, restore, membership;
- tasks: assignment and unassignment, and deletion;
- invoices: creation, issue, payment, cancellation.

A central `recordAudit` writes each business event in the same transaction as
the operation. The audit log page (`/o/[orgSlug]/audit-log`) is for OWNER and
ADMIN, with pagination and date, actor, action and resource-type filters.
Design: [architecture.md §6f](architecture.md#6f-audit-logging).

**Verification:**

- **Unit tests:** 261/261, including:
  - secret stripping, size limits and the vocabulary;
  - URL filter parsing;
  - append-only rules in the tenant client;
  - the list, toolbar and nav visibility;
  - that only OWNER and ADMIN hold `audit:read`.
- **Integration tests:** 343/343 against real PostgreSQL, 30 of them for
  audit logging:
  - auth events through the real Better Auth handler, with the server-side
    identity and no passwords or tokens stored;
  - business events through the real Server Actions;
  - no record when an operation fails or is forbidden;
  - organization, member and role events, including the permission diff;
  - forged `actorUserId` and `organizationId` in action input, a tenant
    client refusing a record for another organization, and a static check
    that `src/app` never writes audit records;
  - immutability through the tenant client and at the database level, plus
    CHECK constraints and user/organization deletion;
  - visibility by role, organization isolation, non-members and signed-out
    access;
  - pagination and each filter, alone and combined.
- **Real browser (Chromium via Playwright, production build), 26/26:**
  - a failed sign-in, sign-ins, and a client created and edited through the
    UI all appear with the right actor;
  - the event count matches the database;
  - details disclosure;
  - action, resource, actor ("no signed-in actor" and one member) and
    date-range filters, with an empty state and "Clear filters";
  - pagination;
  - another organization's audit log returns 404, a second organization's
    owner sees only their own events, and neither sees the other's data;
  - MEMBER has no nav item and gets access denied;
  - mobile (390 px) without horizontal overflow;
  - sign-out through the UI is recorded, and signed-out visitors are
    redirected;
  - no passwords, tokens or credential keys in stored metadata;
  - no console or CSP errors besides the deliberate 404s.

**Bugs found and fixed during verification:**

- **Filter race:** changing two filters in quick succession lost the first
  change, and the controlled selects snapped back while the page loaded. The
  toolbar now keeps the selected values locally and re-syncs from the URL.
  Regression test added.
- **Empty gap on mobile:** the "Clear filters" cell kept its height with no
  filters set.

**Known follow-ups:**

- There is no member-management UI yet. Role changes and removals are
  audited in the ownership service, whose callers must pass `actor`. Without
  it (scripts) the record has no actor.
- The database role can still `TRUNCATE` or drop the table. A least-privilege
  application role belongs to production readiness.
- Recorded IP addresses depend on proxy headers (Better Auth `getIP`).
  Trusted-proxy configuration is part of deployment.
- Failed sign-ins for existing accounts are written to every organization of
  that account. Rate limiting (5 per minute) bounds the volume. There is no
  retention or export yet.
- Browser checks are an ad-hoc script, not part of CI.

## Dashboard (completed 2026-09-28)

**Scope:** the organization overview page. It shows:

- total clients, active projects, open tasks and overdue invoices;
- total invoiced and total paid, per currency;
- progress of active projects and tasks by status;
- an invoice status summary;
- recent project/task activity and recent client activity.

Other features:

- loading skeleton, section empty states, and a welcome state for an empty
  organization;
- error boundary;
- responsive layout.

Everything is computed on the server with aggregate queries, scoped to the
caller's organization and gated by role (MEMBER sees no invoice data). Design:
[architecture.md §6e](architecture.md#6e-dashboard).

**Verification:**

- **Unit tests:** 236/236, including 5 for the dashboard's money arithmetic
  and 9 for the dashboard component.
- **Integration tests:** 313/313 against real PostgreSQL, 17 of them for the
  dashboard:
  - exact metrics, and derived OVERDUE, including the due-today and midnight
    UTC boundary;
  - per-currency cent totals, and consistency with the invoice list's counts;
  - activity feeds and their caps;
  - an empty organization;
  - tenant isolation through the session pipeline, and non-member and
    signed-out access;
  - the role matrix, including MEMBER running no invoice queries;
  - a database failure mapped to a generic error;
  - a query-count test: 13 statements regardless of data size.
- **Real browser (Chromium via Playwright, production build), 28/28:**
  - skeleton streamed first, then the empty-organization state;
  - a client created through the UI appears in the activity feed;
  - every metric matches values computed independently in SQL, with exact
    money and the derived overdue count;
  - project progress, task distribution and the invoice summary;
  - drill-down links;
  - another organization's dashboard returns 404 and none of its data
    appears;
  - mobile (390 px) without horizontal overflow;
  - MEMBER sees no invoice data or create links, and signing out redirects to
    sign-in;
  - no console or CSP errors besides the deliberate 404.

**Bugs found and fixed during verification:**

- **Zero-currency noise:** the "outstanding" line listed currencies with
  nothing outstanding (e.g. "€0.00 + …").
- **Oversized amounts in the invoice summary:** multi-currency amounts used
  the metric-card size.

**Known follow-ups:**

- Activity times are formatted in the server's time zone, the same as the
  existing activity timelines. Per-user time zones are not supported yet.
- No org-wide task list exists yet, so task counts do not link anywhere.
- Browser checks are an ad-hoc script, not part of CI yet.

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
