# ClientFlow Architecture

ClientFlow is a multi-tenant CRM and project-management SaaS for freelancers and
small agencies. This document records the architecture and the decisions behind
it. Update it when a decision changes.

**Status:** foundation, tenant isolation, authentication, organizations and
RBAC infrastructure. Business features (clients, projects, tasks, invoices,
reports) are not implemented yet.

---

## 1. System overview

A single **Next.js modular monolith** backed by **one PostgreSQL database**.

```
Browser
  │  HTML / RSC payloads / Server Actions / JSON
  ▼
Next.js (App Router, Node.js runtime)
  ├─ src/app/             routing, layouts, pages, route handlers (thin)
  ├─ src/server/<domain>/ services + data access (business rules, tenancy, RBAC)
  └─ src/lib/             cross-cutting infrastructure (db, env, errors, logging)
  │
  ▼  Prisma Client + @prisma/adapter-pg (node-postgres pool)
PostgreSQL
```

No microservices, no separate API server, no message broker. Background work
(e.g. invoice reminders, report generation) will be added only when a feature
needs it, starting with the simplest option (a scheduled route or a
Postgres-backed job queue) before introducing new infrastructure.

## 2. Technology choices

| Concern        | Choice                                | Why                                                                                        |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Framework      | Next.js 16 (App Router) + React 19    | Full-stack in one deployable; Server Components keep data access server-side               |
| Language       | TypeScript (strict)                   | Type safety across UI, services and database                                               |
| Database       | PostgreSQL 17                         | Relational integrity for tenants, invoices, audit history                                  |
| ORM            | Prisma 7 with `@prisma/adapter-pg`    | Mature migrations, generated types; the driver adapter is Prisma 7's standard runtime path |
| Validation     | Zod 4                                 | One schema for env, request bodies, form input                                             |
| Styling        | Tailwind CSS 4                        | Design tokens as CSS variables, fast iteration                                             |
| Components     | shadcn/ui (Base UI primitives)        | Accessible primitives whose source lives in the repo and can be edited                     |
| Icons          | lucide-react                          | Consistent, tree-shakeable                                                                 |
| Unit tests     | Vitest + Testing Library              | Fast, ESM-native, works with the same TS config                                            |
| Lint / format  | ESLint (next config) + Prettier       | Standard Next.js rules; formatting never argued in review                                  |
| Authentication | Better Auth 1.7 (+ emailOTP plugin)   | Maintained auth: scrypt hashing, DB sessions, verification, reset, Google                  |
| Email          | nodemailer (SMTP); Mailpit locally    | Provider-neutral; local inbox for development                                              |
| Local DB       | Docker Compose (`postgres:17-alpine`) | Reproducible dev database; creates a separate test database                                |

## 3. Code organization

```
src/
  app/                    Next.js routes only. Thin: parse input, call a service, render.
    (auth)/               sign-in, sign-up, verify-email, forgot/reset password + auth actions
    (onboarding)/         create an organization
    o/[orgSlug]/          the application for one organization (AppShell)
    api/                  Route handlers: health, webhooks, external/public API
    error.tsx, global-error.tsx, not-found.tsx
  components/
    ui/                   shadcn/ui primitives (generated, then owned by us)
    layout/               Application frame: shell, navigation, logo
  config/                 Static app configuration (navigation, etc.)
  proxy.ts                CSP nonce + optimistic sign-in redirect (not a security boundary)
  lib/                    Framework-agnostic infrastructure
    permissions.ts        RBAC policy (pure; server-enforced, UI may read)
    security/headers.ts   security headers and CSP
    db.ts                 Prisma client singleton (server-only)
    env.ts                Validated environment (server-only)
    errors.ts             AppError hierarchy + response/result types
    api/handle-error.ts   Error → HTTP response / ActionResult mapping
    logger.ts             Structured logger
  server/                 Server-only domain code, one folder per domain:
    health.ts             dependency health checks
    protected.ts          the request pipeline (tenantAction, tenantRoute, authenticatedAction)
    auth/                 Better Auth config, session helpers, auth error mapping
    email/                SMTP mailer, templates, deferred dispatch
    organizations/        organization bootstrap (org + OWNER membership)
    tenancy/              tenant client, tenant context, membership listing, scoping rules
    <domain>/             e.g. clients/, projects/: service.ts, schemas.ts, *.test.ts
  generated/prisma/       Generated Prisma client (git-ignored; `npm run db:generate`)
prisma/
  schema.prisma           Schema (tenancy rules in its header comment)
  migrations/             Committed SQL migrations
tests/                    Test setup, lint-boundary test
  integration/            Real-PostgreSQL tests + setup (create DB, migrate, truncate)
docs/                     Architecture and design documents
```

**Dependency direction:** `app → server → lib`. `components` may import `lib`
(utilities) but never `server` or `lib/db`. Server-only modules import
`server-only` so accidental client imports fail the build.

## 4. Multi-tenancy

**Model:** shared database, shared schema, row-level tenancy by
`organizationId`. Isolation is enforced in three independent layers, each
covered by tests.

- `Organization` is the tenant. Every tenant-owned table has a non-null
  `organizationId` foreign key. _Implemented:_ `Organization`, plus minimal
  `Client` and `Project` tables that establish the parent/child structure
  (their feature fields come with the client/project milestones).
- A `User` can belong to many organizations through `Membership`
  (`userId`, `organizationId`, `role`). **Roles live on the membership, not the
  user.** _Planned with authentication._
- The active organization is part of the URL (planned: `/o/[orgSlug]/…`), so
  links are shareable and multiple tabs can use different orgs.

### Layer 1: tenant-scoped client (`src/server/tenancy/`)

`getTenantDb(organizationId)` returns the shared Prisma client wrapped in a
query extension. For every operation on every model it applies `scopeArgs`
(`scope.ts`):

| Operation                                                         | Behaviour                                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| reads, `count`, `aggregate`, `groupBy`, `delete*`, `update*`      | `where` (and `cursor`) gets `organizationId = current`                                 |
| `create`, `createMany*`, `upsert.create`                          | `data.organizationId = current`                                                        |
| a different `organizationId` anywhere (where, data, compound key) | **rejected** with `TenantIsolationError` (403), logged as a warning, never overwritten |
| nested relation writes (`connect`, `create`, … in `data`)         | rejected: they can re-parent rows across tenants; set scalar FKs instead               |
| `$queryRaw`, `$executeRaw`, `…Unsafe`                             | rejected                                                                               |
| `Organization` model                                              | only its own row (`id = current`); create/delete/upsert rejected                       |
| unclassified or `global` models, unknown operations               | rejected (fail closed)                                                                 |

Scoping applies inside `$transaction` too. Because `update`/`delete` by `id`
are scoped, touching another organization's row fails with Prisma `P2025`,
which the error layer maps to 404.

Caller-supplied foreign ids are resolved before writing with
`requireTenantRecord(db, model, id)` (`references.ts`), a scoped
`findUnique`. Nonexistent and other-organization ids throw the same
`ReferenceNotFoundError` (404). The composite FK remains the final guard, and a
P2003 from a race is mapped to that same 404.

`models.ts` classifies every model as `tenant`, `organization` or `global`.
It is typed `satisfies Record<Prisma.ModelName, …>`, so adding a model without
classifying it fails type-checking. A unit test also checks the
classification against the `organizationId` column.

### Layer 2: import boundary (ESLint)

Only modules in `RAW_DB_ALLOWED` (`eslint.config.mjs`: tenancy, health, auth,
and the organization bootstrap file) may import the unscoped `@/lib/db`. Everything else, including pages, route
handlers, Server Actions and domain services, must use `getTenantDb`.
Constructing a `PrismaClient` or importing `@prisma/client` is forbidden
everywhere except `src/lib/db.ts`. `tests/eslint-boundaries.test.ts` proves the
rules fire.

### Layer 3: database constraints (composite foreign keys)

- Every tenant-owned table has `UNIQUE (organizationId, id)`.
- A child references a tenant-owned parent with **both** columns:
  `FOREIGN KEY (organizationId, clientId) REFERENCES Client(organizationId, id)`.
  A `Project` row can therefore only point at a `Client` with the _same_
  `organizationId`. PostgreSQL rejects anything else, including raw SQL, bugs in
  privileged code, or moving a child to another org without its parent.
- `UNIQUE (organizationId, id)` is also the organization-leading index for
  tenant-wide queries; other indexes (e.g. `(organizationId, clientId)`) also
  lead with `organizationId`.
- `tests/integration/schema-invariants.test.ts` inspects the migrated
  database and fails if any FK between two tenant-owned tables omits
  `organizationId`, or a tenant table lacks `NOT NULL organizationId` /
  `UNIQUE (organizationId, id)`. The rules hold for future models automatically.
- Composite child FKs use `ON DELETE NO ACTION` (a parent with children can't
  be deleted, but deleting an organization cascades through all its rows) and
  never `SET NULL` (which would null `organizationId`).

### Layer 4: tenant context and the request pipeline

`getTenantContext(orgSlug)` (`src/server/tenancy/context.ts`, cached per
request with React `cache()`):

1. validates the session in the database (`requireSession`; 401 if missing,
   expired or revoked);
2. looks up the signed-in user's **membership** in the organization whose slug
   is in the URL. The slug is only a _selector_; unknown organizations and
   organizations the user does not belong to both return the same 404;
3. returns `{ userId, organization, membership, role }`. Every value comes from
   the session and the database. Nothing is read from request data.

`src/server/protected.ts` runs the one pipeline for every protected entry point:

```
authenticated session → tenant context → permission check → input validation
→ business operation (with getTenantDb(ctx.organization.id)) → error handling
```

- `tenantAction({ permission, input }, handler)`: Server Actions, returns `ActionResult`.
- `tenantRoute({ permission, input }, handler)`: Route Handlers under `/api/o/[orgSlug]/…`.
- `authenticatedAction({ input }, handler)`: signed in, no organization yet (onboarding).

Input is read only after authorization succeeds, and Zod schemas strip unknown
keys, so `{ role: "OWNER", organizationId, userId }` in a request has no
effect. Pages use `getTenantContextForPage` (redirect to sign-in / 404).

Global authentication models (`User`, `Session`, `Account`, `Verification`) are
classified `global` and are unreachable through `getTenantDb`. `Membership` is
tenant-owned and follows every rule above. It has one deliberate index that
does not lead with `organizationId`: `(userId)`, for "which organizations does
this user belong to".

## 5. Authorization / RBAC

Defined in one pure module, `src/lib/permissions.ts`. The server enforces it
through the pipeline (`assertPermission`); UI code may call `hasPermission` to
hide actions, but that is never the security control. Code checks named
permissions, never `role === "ADMIN"`.

| Area         | Permissions                                              | OWNER | ADMIN        | MANAGER           | MEMBER               |
| ------------ | -------------------------------------------------------- | ----- | ------------ | ----------------- | -------------------- |
| Organization | `organization:read` / `update` / `delete`                | all   | read, update | read              | read                 |
| Members      | `member:read` / `invite` / `update-role` / `remove`      | all   | all          | read              | read                 |
| Clients      | `client:read` / `create` / `update` / `delete`           | all   | all          | all               | read                 |
| Projects     | `project:*`                                              | all   | all          | all               | read                 |
| Tasks        | `task:*`                                                 | all   | all          | all               | read, create, update |
| Invoices     | `invoice:read` / `create` / `update` / `delete` / `send` | all   | all          | all except delete | none                 |
| Reports      | `report:read`                                            | yes   | yes          | yes               | no                   |

Roles are strictly nested (each has everything the role below has).

**Role changes** (`canChangeRole` / `assertCanChangeRole`) prevent escalation:
requires `member:update-role`; nobody changes their own role; only an OWNER
may grant OWNER or change an OWNER; otherwise actors manage only lower-ranked
members and grant roles up to their own rank.

**At least one OWNER** is enforced in two layers:

1. **Application check** (`src/server/organizations/ownership.ts`). Change or
   remove memberships only through `changeMembershipRole(db, id, role)` and
   `removeMembership(db, id)`. Inside a transaction they refuse to demote or
   remove the last OWNER with `OwnerRequiredError`, a 409 `CONFLICT`: "An
   organization must always have at least one owner. Make another member an
   owner first." Callers remain responsible for authorization
   (`member:update-role` / `member:remove` and `assertCanChangeRole`).
2. **Database backstop**: a deferred constraint trigger
   (`Membership_organization_has_owner`, migration `auth_and_memberships`)
   rejects any commit that leaves an existing organization without an OWNER.
   That covers code that bypasses the check, deleting the owner's user
   account, and two concurrent demotions that both pass the check.
   `toAppError` recognises the trigger (SQLSTATE `23514` with its message,
   whether raised as Prisma `P2039` or at `COMMIT`) and returns the same 409.

To transfer ownership, promote the new owner first, then demote or remove the
old one. Deleting the whole organization is allowed and cascades to all of its
memberships.

## 6. Authentication

**Library:** [Better Auth](https://www.better-auth.com) 1.7 with its Prisma
adapter (`src/server/auth/auth.ts`), mounted at `/api/auth/[...all]`. It was
chosen over Auth.js because it provides, as maintained library code,
everything required: email/password with scrypt hashing, database sessions,
email verification, password reset with session revocation, Google OAuth and
account linking. Auth.js's credentials provider supports only JWT sessions and
has no built-in verification or reset.

**Sessions.** Opaque tokens stored in the `Session` table; the browser holds a
signed, `HttpOnly`, `SameSite=Lax` cookie (`Secure` + `__Secure-` prefix over
HTTPS). An unsigned token is rejected. The cookie cache is disabled, so every
request checks the database, and sign-out and revocation take effect
immediately. Helpers: `getSession`, `getCurrentUser`, `requireSession` (401),
`requireSessionOrRedirect` (pages).

#### Session lifecycle

The behaviour below was measured on a production build (`npm start`) against
PostgreSQL, not just read from the configuration.

| Event                                                                                         | Database session (`Session.expiresAt`)                           | Browser cookie                                                                                                  |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Sign-in, email verification (auto sign-in), Google callback                                   | New row, expires in **7 days**                                   | Set, `Max-Age` 7 days                                                                                           |
| Any authenticated request < 1 day after the last extension                                    | Unchanged                                                        | Unchanged                                                                                                       |
| **Page request** (full load or client navigation) ≥ 1 day after the last extension            | Extended to now + 7 days                                         | **Not refreshed**: Server Components cannot set cookies, and Better Auth's `nextCookies` plugin skips the write |
| **Server Action** or **Route Handler** (incl. `/api/auth/*`) ≥ 1 day after the last extension | Extended to now + 7 days                                         | Re-issued with `Max-Age` 7 days                                                                                 |
| Session past `expiresAt`                                                                      | Row deleted on the next lookup                                   | Cleared; the user is sent to sign-in                                                                            |
| Sign-out                                                                                      | Row deleted                                                      | Cleared                                                                                                         |
| Password reset                                                                                | **All** of the user's sessions deleted                           | The user must sign in again                                                                                     |
| Password change (`/change-password`)                                                          | **All** sessions deleted, one new session created for the caller | Replaced with the new session                                                                                   |

Consequences:

- A session stays valid while the user makes at least one request per 7 days,
  but the browser keeps the cookie only for 7 days from when it was **last
  written**: sign-in, or a Server Action / Route Handler call that ran the
  refresh. A user who only navigates pages (no actions or API calls) for 7 days
  is signed out when the cookie expires, even though the database row was
  extended. Once feature Server Actions exist, normal use re-issues the cookie.
- The database expiry is never earlier than the cookie's, so a cookie the
  browser still holds is always backed by a valid row, unless it was revoked.
- The configuration is `expiresIn` 7 days and `updateAge` 1 day
  (`src/server/auth/auth.ts`). There is no absolute maximum session age beyond
  the sliding window; add one if a compliance requirement demands it.

**Email verification** uses Better Auth's `emailOTP` plugin instead of the
default stateless JWT links (which are not stored server-side and can be
replayed until they expire): 6-digit codes, stored hashed in `Verification`,
valid 10 minutes, deleted atomically on use, and destroyed after 5 wrong
attempts. Password sign-in requires a verified address; verifying signs the
user in. Unused plugin endpoints (OTP sign-in, OTP reset, email change) are
disabled.

**Password reset:** a single-use token in a link, stored hashed, valid 1 hour,
consumed atomically. A successful reset revokes all of the user's sessions.
The request endpoint returns the same response (and does equivalent work)
whether or not the address is registered. **Duplicate sign-up** returns the
same response as a new sign-up; the existing owner is emailed instead.

**Google** uses Better Auth's standard provider (PKCE and state), enabled only
when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set. Automatic linking to an
existing account requires that account's email to be verified (prevents
pre-registration takeover).

**Email delivery:** nodemailer over `SMTP_URL` (`src/server/email`). Sending is
deferred with Next.js `after()`, so response timing does not reveal whether an
email was sent. Only the message type is logged, never codes, links or tokens.
Better Auth's own logging is limited to warnings.

**Rate limiting** (Better Auth, disabled in tests): 5/min for sign-in,
sign-up, OTP and change-password, 3/min for reset requests, 100/min otherwise,
counted per client IP. Counters are kept **in the memory of each server
process**. That is correct for a single instance only; see the production
requirement in §12.

#### Account-management endpoints

Every Better Auth endpoint was reviewed against ClientFlow's needs. Behaviour
was verified with requests against the running handler
(`tests/integration/auth.test.ts`).

| Endpoint                                                             | Decision                                      | Security behaviour                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /change-password`                                              | **Keep** (for a future account-settings page) | Requires a valid session **and the current password**. A wrong password changes nothing. On success **every existing session is revoked** and the caller gets a fresh one. Better Auth leaves this to the client (`revokeOtherSessions`, default `false`); a `hooks.before` in `auth.ts` forces it `true`. Rate limited 5/min. |
| `POST /update-user`                                                  | **Keep**                                      | Only `name` and `image` can change. `email` is rejected (400); `emailVerified` and other fields are ignored.                                                                                                                                                                                                                   |
| `GET /list-sessions`                                                 | **Keep**                                      | Lists only the caller's active sessions, and needs a session under 1 day old. The response contains raw session tokens, which are not usable as cookies without the server-side signature; they only serve `revoke-session`.                                                                                                   |
| `POST /revoke-session`, `/revoke-sessions`, `/revoke-other-sessions` | **Keep**                                      | Operate only on the caller's own sessions; another user's token is ignored.                                                                                                                                                                                                                                                    |
| `GET /list-accounts`, `POST /link-social`, `/unlink-account`         | **Keep**                                      | Own accounts only. Provider tokens and password hashes are stripped from output; linking requires matching emails.                                                                                                                                                                                                             |
| `POST /update-session`                                               | **Keep** (inert)                              | No custom session fields are configured, so nothing can be changed. `expiresAt` and `userId` in the body are rejected.                                                                                                                                                                                                         |
| `POST /change-email`, `/delete-user`                                 | Unavailable (Better Auth defaults)            | Disabled unless explicitly configured (400 / 404). Enabling account deletion needs a decision on sole-owner organizations; the owner invariant blocks it today.                                                                                                                                                                |
| `GET /verify-email`, `POST /send-verification-email`                 | **Disabled**                                  | The default link verification accepts stateless JWTs that can be replayed and also sign the user in (verified before disabling). ClientFlow never sends them; verification is `/email-otp/*` only.                                                                                                                             |
| `POST /verify-password`                                              | **Disabled**                                  | Unused; would only be a password-guessing oracle for someone holding a session.                                                                                                                                                                                                                                                |
| `POST /get-access-token`, `/refresh-token`, `GET /account-info`      | **Disabled**                                  | Would expose Google OAuth tokens and profile to browser JavaScript. ClientFlow does not call Google APIs.                                                                                                                                                                                                                      |
| Email OTP sign-in / reset / email-change endpoints                   | **Disabled**                                  | Only OTP email verification is used.                                                                                                                                                                                                                                                                                           |

**Route protection:** `src/proxy.ts` redirects requests without a session
cookie away from `/o/*` and `/onboarding` (a UX optimisation only). The
security boundary is server code: pages call `requireSessionOrRedirect` /
`getTenantContextForPage`, actions and routes go through the pipeline.

**Organization bootstrap** (`src/server/organizations/bootstrap.ts`): the
signed-in user (from the session, never from input) creates an organization;
the organization and its OWNER membership are created in one transaction.
Slugs are unique (409 on conflict) and derived from the name when omitted.

### Security headers

| Header                                            | Value / purpose                                                                                                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` (pages, `src/proxy.ts`) | Per-request nonce: `script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self' https://accounts.google.com`, `upgrade-insecure-requests` on HTTPS |
| `Content-Security-Policy` (`/api/*`)              | `default-src 'none'; frame-ancestors 'none'`                                                                                                                                                                                |
| `X-Frame-Options`                                 | `DENY` (clickjacking, legacy browsers)                                                                                                                                                                                      |
| `X-Content-Type-Options`                          | `nosniff`                                                                                                                                                                                                                   |
| `Referrer-Policy`                                 | `strict-origin-when-cross-origin`                                                                                                                                                                                           |
| `Permissions-Policy`                              | camera, microphone, geolocation, payment, usb, topics disabled                                                                                                                                                              |
| `Cross-Origin-Opener-Policy`                      | `same-origin` (Google sign-in is a redirect, not a popup)                                                                                                                                                                   |
| `Strict-Transport-Security`                       | production only, 2 years, subdomains                                                                                                                                                                                        |

**Documented CSP exceptions:**

- `style-src 'unsafe-inline'`: React and the UI primitives set inline `style`
  attributes, which nonces cannot authorise.
- `'unsafe-eval'` in development only, which React needs for debugging.
- `form-action https://accounts.google.com`: the "Continue with Google" form
  may end in a redirect to Google when JavaScript is disabled.
- Every page renders dynamically (`connection()` in the root layout), because
  nonces can only be applied to per-request HTML.

## 6a. Client management

**Model.** `Client` (name, company, email, phone, address, notes, `status`
ACTIVE / INACTIVE / ARCHIVED, `archivedAt`) and `ClientActivity`
(append-only history: CREATED, UPDATED, ARCHIVED, RESTORED, with the acting
user and, for updates, `{ field: { from, to } }`). Both are tenant-owned; the
activity table references its client with a composite key. Note text is never
copied into the history (only "notes changed").

**Layers.**

- `src/lib/validation/client.ts`: Zod schemas shared by the server and forms.
  Unknown keys such as `organizationId` are stripped. `ARCHIVED` cannot be set
  by editing. URL query parsing falls back to defaults on bad input.
- `src/server/clients/service.ts`: all data access, through the tenant-scoped
  client only. Each write and its activity row happen in one transaction.
- `src/app/o/[orgSlug]/clients/actions.ts`: Server Actions built with
  `tenantAction`.
- Pages use `tenantPage(orgSlug, permission)`: signed out → sign-in,
  non-member → 404, role without permission → "no access" state.
- UI components (`src/components/clients/`) only render data and call
  actions.

**Permissions.**

| Operation                               | Permission                                             | Roles                 |
| --------------------------------------- | ------------------------------------------------------ | --------------------- |
| List, search, view details and activity | `client:read`                                          | all                   |
| Create                                  | `client:create`                                        | OWNER, ADMIN, MANAGER |
| Edit                                    | `client:update`                                        | OWNER, ADMIN, MANAGER |
| Archive / restore                       | `client:delete` (archive is the destructive operation) | OWNER, ADMIN, MANAGER |

The client's projects section on the details page additionally requires
`project:read`.

**Isolation.** Client ids from the URL or request are looked up through the
tenant-scoped client, so another organization's client id behaves exactly
like a nonexistent one: a 404 page, or `NOT_FOUND` from actions. Archived
clients are read-only until restored (409 on edit). Archiving twice, or
restoring an active client, is a 409.

**Search and lists.** Case-insensitive substring search over name, company
and email. `%`, `_` and `\` are escaped, because Prisma's `contains` does not
escape LIKE wildcards. Filter by status (default: active and inactive), sort
by name / recently updated / recently added, offset pagination (20 per page,
max 100) with the page clamped to the last one. Filter, search and page live
in the URL. Per-status counts respect the current search. Indexes:
`(organizationId, status, name)` and `(organizationId, updatedAt)`. Substring
search is a sequential scan within the organization; add a `pg_trgm` GIN
index if client counts grow large.

**UI states.** The `loading.tsx` skeleton lives in the `(list)` route group so
it covers only the list. A loading boundary above the details page would make
`notFound()` respond with HTTP 200 (the shell would already be streaming).
`error.tsx` covers all client pages.

## 6b. Project management

**Model.**

- `Project`: name, description, optional `clientId`, `status` (PLANNING,
  ACTIVE, ON_HOLD, COMPLETED, ARCHIVED), `priority` (LOW … URGENT),
  `startDate`/`dueDate` (calendar days, `DATE`), `progress` 0–100,
  `archivedAt`, and `statusBeforeArchive` (so restore returns to the previous
  status).
- `ProjectMember`: `(organizationId, projectId, userId)`.
- `ProjectActivity`: the same pattern as `ClientActivity`. Types: CREATED,
  UPDATED, STATUS_CHANGED, ARCHIVED, RESTORED, MEMBER_ADDED, MEMBER_REMOVED.
  Description text is never copied into the history.

**Database guarantees** (migration `project_management`):

- **Client:** `Project(organizationId, clientId) → Client(organizationId, id)`.
  A client, if set, must be in the same organization. A NULL `clientId` means
  "no client" (`MATCH SIMPLE`).
- **Members:**
  `ProjectMember(organizationId, userId) → Membership(organizationId, userId)`.
  A project member must be a member of the organization, and leaving the
  organization removes the person from its projects (cascade).
  `ProjectMember(organizationId, projectId) → Project` cascades.
  `UNIQUE (organizationId, projectId, userId)`.
- **CHECK constraints:** `progress BETWEEN 0 AND 100`, and
  `dueDate >= startDate` when both are set. Prisma cannot express these; they
  live in the migration SQL.
- **Indexes:** `(organizationId, status, name)`, `(organizationId, clientId)`,
  `(organizationId, updatedAt)`, `ProjectMember (organizationId, userId)`,
  `ProjectActivity (organizationId, projectId, createdAt)`.

**Layers** (same as clients):

- `src/lib/validation/project.ts`;
- `src/server/projects/service.ts` (tenant database only; every change and its
  activity row in one transaction);
- `src/app/o/[orgSlug]/projects/actions.ts` (`tenantAction`);
- pages via `tenantPage`;
- `src/components/projects/`.

**Permissions** (existing RBAC; no new permissions):

| Operation                                                 | Permission       | Roles                 |
| --------------------------------------------------------- | ---------------- | --------------------- |
| List, search, view details, team and activity             | `project:read`   | all                   |
| Create                                                    | `project:create` | OWNER, ADMIN, MANAGER |
| Edit fields, set status, set progress, add/remove members | `project:update` | OWNER, ADMIN, MANAGER |
| Archive / restore                                         | `project:delete` | OWNER, ADMIN, MANAGER |

**Isolation.**

- **Projects:** every project id is looked up through the tenant client, so
  another organization's project is a 404 (page) or `NOT_FOUND` (action) for
  every operation, including member management.
- **Clients and members:** a client id or user id is checked through the tenant
  client before a write. A foreign or nonexistent id gives the same
  `404 Referenced resource not found`, and the composite FKs above are the
  database backstop.
- **Archived records:** assigning an archived client is a 409 (an existing
  archived assignment is kept). Archived projects are read-only (409) until
  restored.

**Lists.**

- **Search:** name, description and client name, with wildcards escaped via
  the shared `escapeLikePattern`.
- **Filters:** status (default: all except archived) and client (a client or
  "no client").
- **Sort:** name, due date (empty last), priority, recently updated or
  recently added.
- **Pagination:** 20 per page, clamped to the last page.
- **Query count:** a page with client names and member counts takes 4 SQL
  statements regardless of size (asserted by a query-counting integration
  test).
- **Overdue:** a project is overdue when it is past its due date (UTC) and not
  completed or archived.

**Tasks** are not implemented; the details page shows a placeholder section.

**Shared UI** (`src/components/shared/`), used by clients and projects:
`ActivityTimeline`, `EmptyState`, `ListPagination`, `ArchiveButton`,
`ListSearchInput`/`useListSearch`, `ProgressBar` and `SegmentError`.

## 7. Error handling

Implemented in `src/lib/errors.ts` and `src/lib/api/handle-error.ts`.

- **Expected errors** are `AppError` subclasses (`ValidationError`,
  `NotFoundError`, `ForbiddenError`, `UnauthenticatedError`, `ConflictError`,
  …) with a stable `code`, HTTP `status`, a client-safe `message` and optional
  `details`.
- **Route handlers** are wrapped with `withErrorHandling`. Thrown `AppError`s
  become `{ "error": { "code", "message", "details?" } }` with the right
  status. `ZodError`s become `422 VALIDATION_ERROR` with field details.
  Prisma `P2002` (unique violation) becomes `409 CONFLICT` and `P2025`
  (record not found, including another tenant's row) becomes `404 NOT_FOUND`.
  `P2003` (foreign key violation) is classified by which side of the key failed.
  An invalid, nonexistent or other-organization reference on the child
  table becomes `404 "Referenced resource not found"`. Deleting a parent that
  is still referenced becomes `409 CONFLICT`. The classification compares
  `meta.modelName` with the constraint's `<Table>_…_fkey` prefix; the
  integration schema invariants assert that naming.
  Anything else, including other Prisma errors, is logged in full and returned as a generic
  `500 INTERNAL_ERROR`, so internals never leak.
- **Server Actions** return `ActionResult<T>` (`{ ok: true, data }` or
  `{ ok: false, error }`) instead of throwing, per Next.js guidance for
  `useActionState`. Use `toActionError(error)` in the catch block.
- **Rendering errors** are caught by `app/error.tsx` (segment) and
  `app/global-error.tsx` (root layout). `notFound()` renders `app/not-found.tsx`.
- **Logging** goes through `lib/logger.ts`: JSON lines in production,
  readable output in development, level set by `LOG_LEVEL`.

## 8. Data conventions (to apply when models are added)

- Primary keys: `String @id @default(cuid())` (or UUIDv7). Never expose
  sequential ids.
- `createdAt` / `updatedAt` on every table; timestamps stored in UTC.
- Money: integer minor units (`amountCents Int`) plus an ISO 4217 `currency`.
  Never floats.
- Soft delete only where a feature requires it (e.g. invoices stay for
  accounting); otherwise hard delete plus an audit log entry.
- Audit log entries are written in the **same transaction** as the change they
  record, and include `organizationId`, `actorUserId`, `action`, `entityType`,
  `entityId` and a JSON diff/metadata.
- Schema changes only via Prisma migrations (`npm run db:migrate`), committed
  to git. Production applies them with `npm run db:deploy`.

## 9. Configuration

- All environment variables are declared in `.env.example` and validated by
  Zod in `src/lib/env.ts`. Code reads `getServerEnv()`, not `process.env`.
  (`TEST_DATABASE_URL` is read only by the integration test tooling.)
- `DATABASE_URL` has no `?schema=` parameter: the runtime driver adapter
  ignores it while Prisma Migrate honours it, so setting it would split
  migrations and queries across schemas. Everything uses `public`.
- Validation is lazy (first use) so `next build` runs without runtime secrets;
  misconfiguration fails the first request with a readable message.
- `prisma.config.ts` loads `.env` for the Prisma CLI.

## 10. Observability

- `GET /api/health` returns `200` when PostgreSQL answers `SELECT 1` within 3s,
  `503` otherwise, with `Cache-Control: no-store` and no internal error details.
  Suitable for load balancer and uptime checks.
- Structured logs to stdout. An error tracker (e.g. Sentry) can be added via
  `instrumentation.ts` when deploying.

## 11. Testing strategy

| Level       | Tooling                             | Status   | Scope                                                                     |
| ----------- | ----------------------------------- | -------- | ------------------------------------------------------------------------- |
| Unit        | Vitest (node env)                   | In place | Pure logic, error mapping, env, tenancy scoping rules, lint boundaries    |
| Component   | Vitest + Testing Library (jsdom)    | In place | Client components (`// @vitest-environment jsdom`)                        |
| Integration | Vitest against `clientflow_test` DB | In place | Real Postgres: tenant isolation, composite FKs, error mapping (RBAC next) |
| End-to-end  | Playwright                          | Planned  | Critical flows once auth exists                                           |

**Integration tests** (`npm run test:integration`, config
`vitest.integration.config.mts`):

- `TEST_DATABASE_URL` must name a database ending in `_test` and differ from
  `DATABASE_URL`; otherwise the run is refused before anything is touched.
- Global setup creates the database if it is missing (via the server's
  `postgres` maintenance database) and runs `prisma migrate deploy`. It does
  not depend on the Docker init script.
- Before each test, every application table is truncated (table list read
  from `pg_tables`, so new models need no test changes). Test files run
  serially against the one database.

Integration tests also cover authentication, organizations, tenant context and
authorization end to end. Outgoing email is captured in an in-memory outbox
(`tests/integration/support/outbox.ts`, installed in `setup.ts`). Better Auth
is called through its real HTTP handler. Server Actions and the pipeline read
the session through a `next/headers` stand-in
(`tests/integration/support/next-request.ts`) carrying a real session cookie.

**CI** (`.github/workflows/ci.yml`) runs against a PostgreSQL 17 service:
Prisma validate → `npm run check` → integration tests → a drift check
(`prisma migrate diff` between the migrated test database and
`schema.prisma`; fails if a migration is missing) → production build.

Async Server Components are not unit-testable in Vitest; cover them with E2E
tests and keep their logic in testable services.

## 12. Deployment (target)

Any Node.js 24 host (Vercel, Fly.io, Render, a container) plus managed
PostgreSQL. Build: `npm ci && npm run build` (postinstall runs
`prisma generate`). Release: `npm run db:deploy` before starting the new
version. Use a pooled connection string (e.g. PgBouncer) on serverless
platforms. Configure `BETTER_AUTH_SECRET`, an HTTPS `BETTER_AUTH_URL`, a real
SMTP provider (`SMTP_URL`, `EMAIL_FROM`, preferably `smtps://`) and,
optionally, Google OAuth credentials.

> **Production deployment task: shared rate-limit storage.** The
> authentication rate limiter keeps its counters in each server process's
> memory. That is correct for **one** application instance. With several
> instances (horizontal scaling, serverless, rolling deploys), each keeps its
> own counters, so the effective limit multiplies by the number of instances,
> and counters reset on every restart or cold start. **Before running more
> than one instance**, configure Better Auth's `rateLimit.storage` as
> `"database"` (adds a table via migration) or `"secondary-storage"` (e.g.
> Redis), and confirm client IPs are taken from the trusted proxy header
> (`advanced.ipAddress`). Until then, deploy a single instance.
