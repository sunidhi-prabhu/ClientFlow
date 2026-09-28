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
    api/                  Route handlers: auth (Better Auth), health (+ /live), invoice PDF
    error.tsx, global-error.tsx, not-found.tsx
  components/
    ui/                   shadcn/ui primitives (generated, then owned by us)
    layout/               Application frame: shell, navigation, logo
    shared/               Reused pieces: empty state, pagination, timeline, progress, errors
    <feature>/            clients/, projects/, tasks/, invoices/, dashboard/, audit/
  config/                 Static app configuration (navigation, etc.)
  proxy.ts                CSP nonce + optimistic sign-in redirect (not a security boundary)
  instrumentation.ts      startup configuration check (exit on invalid) + server error logging
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
    audit/                recordAudit (the only audit writer) and the audit log queries
    startup.ts            configuration validation and request-error reporting
    <domain>/             clients/, projects/, tasks/, invoices/, dashboard/: service.ts
                          (input schemas live in src/lib/validation/<domain>.ts)
  generated/prisma/       Generated Prisma client (git-ignored; `npm run db:generate`)
prisma/
  schema.prisma           Schema (tenancy rules in its header comment)
  migrations/             Committed SQL migrations
db/runtime-role.sql       Least-privilege grants for the application's database role
tests/                    Test setup, lint-boundary test
  integration/            Real-PostgreSQL tests + setup (create DB, migrate, truncate)
docs/                     Architecture, operations runbook (operations.md), progress log
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

Nested reads can't leave the organization through `User`. Relations from
tenant models to the global `User` (`user`, `actor`; kept complete by a test
that parses the schema) may only select the user's own columns in `include` /
`select`. A user's sessions, accounts, and memberships or activity in other
organizations are rejected (`TenantIsolationError`). (Audit L1.)

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
| Audit log    | `audit:read`                                             | yes   | yes          | no                | no                   |

Roles are strictly nested (each has everything the role below has).

**Role changes** (`canChangeRole` / `assertCanChangeRole`) prevent escalation:
requires `member:update-role`; nobody changes their own role; only an OWNER
may grant OWNER or change an OWNER; otherwise actors manage only lower-ranked
members and grant roles up to their own rank.

**At least one OWNER** is enforced in two layers:

1. **Application check** (`src/server/organizations/ownership.ts`). Change or
   remove memberships only through `changeMembershipRole(db, id, role, actor)`
   and `removeMembership(db, id, actor)`. `actor` is required: a request's
   tenant context, for which the service itself enforces `member:update-role`
   plus `assertCanChangeRole`, or `member:remove` plus `assertCanRemoveMember`,
   or `SYSTEM_ACTOR` for maintenance code (audited as a system change). The
   actor is recorded in the audit log. (Audit L3.) Inside a transaction they refuse to demote or
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

**Rate limiting** (Better Auth, disabled in tests unless `AUTH_RATE_LIMIT=on`):
5/min for sign-in, sign-up, OTP and change-password, 3/min for reset
requests, 100/min otherwise, counted per client IP. Counters are kept **in the
memory of each server process**. That is correct for a single instance only;
see the production requirement in §12.

- **The auth forms go through the same limiter.** Better Auth rate-limits,
  checks the origin and applies `disabledPaths` only in its HTTP router;
  `auth.api.*` calls skip all three. The auth Server Actions therefore call
  endpoints through `callAuthEndpoint` (`src/server/auth/endpoint.ts`). It
  builds a request to the handler with the caller's headers and copies the
  response cookies onto the Server Action response. Never call
  `getAuth().api.*` from a request path. (Security audit H1; regression test
  in `tests/integration/auth-rate-limit.test.ts`.)
- **Client IP.** Next.js keeps a client-supplied `X-Forwarded-For`, and Better
  Auth's default trusts a single-value header, so a client could choose its
  own IP (and a fresh bucket) per request. `AUTH_CLIENT_IP_HEADER` (a header
  the edge overwrites) or `AUTH_TRUSTED_PROXIES` (proxies stripped from the
  right of `X-Forwarded-For`) configures `advanced.ipAddress`
  (`client-ip.ts`), and production refuses to start without one of them. The
  application must only be reachable through that proxy. (Audit M1.)
- **Display names** are limited to 100 characters on every endpoint that sets
  one (`hooks.before` for `/sign-up/email` and `/update-user`). Names coming
  from Google are truncated on account creation. (Audit L5.)

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

## 6c. Task management (Kanban)

**Model.** `Task`: title, description, `status` (TODO, IN_PROGRESS, REVIEW,
DONE), `priority` (LOW … URGENT), optional `dueDate` (`DATE`), optional
`assigneeUserId`, timestamps. Tasks are deleted (not archived). Their history
survives in `ProjectActivity`.

**Database guarantees** (migration `task_management`):

- **Project:** `Task(organizationId, projectId) → Project(organizationId, id)`.
  A task belongs to exactly one project of its own organization (cascade on
  project delete).
- **Assignee:**
  `Task(organizationId, projectId, assigneeUserId) → ProjectMember(organizationId, projectId, userId)`.
  An assignee must be a member of this exact project (and therefore of the
  organization). NULL means unassigned (`MATCH SIMPLE`).
- **Unassign trigger:** a composite FK cannot `SET NULL` only the assignee
  column, so the FK is `NO ACTION`. A `BEFORE DELETE` trigger on
  `ProjectMember` (`ProjectMember_unassign_tasks`) clears the assignee first.
  Removing someone from a project, or from the organization (which cascades to
  `ProjectMember`), unassigns their tasks there instead of failing.
- **Indexes:** `(organizationId, projectId, status)` for the board,
  `(organizationId, projectId, assigneeUserId)` for the assignee FK, and
  `ProjectActivity (organizationId, taskId, createdAt)` for task history.

**Activity.** Task events use the existing `ProjectActivity` table (no new
audit mechanism): TASK_CREATED, TASK_UPDATED (title / due date / "description
changed"), TASK_STATUS_CHANGED, TASK_PRIORITY_CHANGED,
TASK_ASSIGNMENT_CHANGED, TASK_DELETED.

- Each row carries `taskId` (deliberately not a foreign key, so history
  outlives a deleted task) and the task title at the time.
- Description text is never stored.
- The project page's "Recent activity" still lists project-level events only
  (`taskId IS NULL`). Task history is shown on each task's page.

**Operations and permissions** (existing RBAC; no new permissions):

| Operation                                                               | Permission    | Roles                 |
| ----------------------------------------------------------------------- | ------------- | --------------------- |
| View board and tasks                                                    | `task:read`   | all                   |
| Create (quick-add per column)                                           | `task:create` | all                   |
| Edit, move, assign / unassign, change priority / due date / description | `task:update` | all                   |
| Delete                                                                  | `task:delete` | OWNER, ADMIN, MANAGER |

**Current behaviour for MEMBER, kept unchanged and documented:** like
`project:read`, task permissions are organization-wide. A MEMBER can create,
edit and move tasks in **any** project of the organization, not only projects
they belong to, but cannot delete tasks. Restricting MEMBERs to their own
projects is a separate RBAC design decision (see follow-ups).

**Tenant and project checks** (service `src/server/tasks/service.ts`, tenant
client only):

- **Existing tasks:** looked up by id through the tenant client. A foreign
  task is `404 Task not found`, and the project is always read from the task,
  never from input.
- **Creation:** the `projectId` in the input is verified through the tenant
  client (foreign or unknown → `404 Project not found`).
- **Archived projects:** their tasks are read-only (409).
- **Assignees:** checked against the task's project. A user who is unknown,
  in another organization, or in the organization but not on the project all
  get the same `422 "The assignee must be a member of this project"`. The
  composite FK is the backstop.
- **Task pages:** the page verifies that the task belongs to the project in
  the URL (otherwise 404).

**Kanban moves** are atomic compare-and-set:
`UPDATE … WHERE id = ? AND status = <current>` in a transaction with the
activity row. The client sends `fromStatus` (the column it saw). If the task
was moved meanwhile, the pre-check or the conditional update fails and the
action returns `409`. The board updates optimistically and rolls the card back
on any rejection. An integration test holds a row lock from a second
connection to prove the atomic path. Drag-and-drop uses `@dnd-kit/core`
(pointer and keyboard sensors). Each card also has a "Move to" select as the
accessible alternative. Cards are ordered within a column by priority, then
due date; there is no manual reordering.

**Board loading** takes 5 SQL statements regardless of task count: project
check, tasks, then one batched query each for project members, memberships
and users (asserted by a query-counting test). The board is capped at 500
cards, with a notice to use the filters. Filters (search over title and
description, assignee including "unassigned", priority) are URL parameters on
the project page.

## 6d. Invoice management

**Model** (migration `invoice_management`):

- `Invoice`: client, per-organization `number` (assigned on issue), `status`,
  `currency` (2-decimal ISO 4217: USD, EUR, GBP, INR, CAD, AUD), `issueDate`,
  `dueDate`, notes, `discountBps`/`taxBps`, stored totals (`subtotalCents`,
  `discountCents`, `taxCents`, `totalCents`), and
  `issuedAt`/`paidAt`/`cancelledAt`.
- `InvoiceItem`: description, `quantityMilli`, `unitPriceCents`,
  `amountCents`, position.
- `Organization.invoiceSequence`: the per-organization numbering counter.

**Money** (`src/lib/money.ts`, pure, shared by server and UI):

- **Units:** amounts in integer cents; quantities in thousandths (1.5 →
  1500); rates in basis points (18.25% → 1825).
- **Arithmetic:** line amount = quantity × unit price, and percentages are
  computed with BigInt and rounded half-up to the cent. No floating-point
  arithmetic is used for money, and display goes through
  `Intl.NumberFormat` with exact decimal strings.
- **Order:** discount = subtotal × discount rate; tax = (subtotal − discount)
  × tax rate; total = subtotal − discount + tax.
- **Limits:** each amount and total is at most 10,000,000.00 (fits 32-bit
  integers); at most 200 items per invoice.
- **Inputs:** decimal strings are parsed exactly. A client-supplied line
  amount or total is never accepted; the server recomputes everything.

**States.** Stored: DRAFT, ISSUED, PAID, CANCELLED. OVERDUE is derived
(ISSUED with a due date before today, UTC) for display, filtering and counts.
It needs no scheduler and can never be stale.

| From                   | To        | Action                                                                                     | Permission                      |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------ | ------------------------------- |
| —                      | DRAFT     | create                                                                                     | `invoice:create`                |
| DRAFT                  | DRAFT     | edit header, add/edit/remove items                                                         | `invoice:update`                |
| DRAFT                  | ISSUED    | issue (needs ≥ 1 item, total > 0, due date not in the past; assigns number and issue date) | `invoice:send`                  |
| ISSUED (incl. overdue) | PAID      | mark paid                                                                                  | `invoice:update`                |
| DRAFT or ISSUED        | CANCELLED | cancel                                                                                     | `invoice:delete` (OWNER, ADMIN) |

Anything else is a 409 (PAID and CANCELLED are final; paid invoices cannot be
cancelled). MEMBER has no invoice permissions: the nav item is hidden, the
pages show "no access", and the PDF route returns 403.

**Consistency:**

- **Lock-and-check:** every change to a draft starts with
  `UPDATE Invoice … WHERE id = ? AND status = 'DRAFT'`. That one statement
  checks the state and takes the invoice's row lock, so concurrent edits are
  serialized.
- **Recompute in the same transaction:** totals are recomputed from the
  stored line amounts within that transaction, so they always match the items.
- **Transitions** are compare-and-set updates.
- **Numbering:** issuing increments `Organization.invoiceSequence` atomically,
  which locks the organization row. Numbers are unique
  (`UNIQUE (organizationId, number)`) and gap-free among issued invoices.
  Drafts have no number.

**Database guarantees** (independent of application code):

- **Composite FKs:** invoice → client, and item → invoice, both within the
  same organization.
- **CHECK constraints:** `total = subtotal − discount + tax` with every amount
  ≥ 0 and discount ≤ subtotal; rates 0–10000; currency `^[A-Z]{3}$`; the
  issuing fields (number, issue date, issued-at) are set together or not at
  all (drafts none; issued and paid all; cancelled either); due ≥ issue date;
  `paidAt` iff PAID; `cancelledAt` iff CANCELLED; items have quantity > 0,
  price and amount ≥ 0, and a non-empty description.
- **Triggers:**
  - `Invoice_guard` allows only the transitions above. Once an invoice is not
    a draft, only status, `paidAt`, `cancelledAt` and `updatedAt` may change,
    and non-draft invoices cannot be deleted.
  - `InvoiceItem_guard` blocks any insert, update or delete of items unless
    the invoice is a draft.
  - Deletes that are part of an organization cascade
    (`pg_trigger_depth() > 1`) are allowed, so organizations can still be
    deleted.

**Isolation.** Invoice, item and client ids are looked up through the
tenant-scoped client: another organization's ids are 404, and the same goes
for a foreign or nonexistent client. Archived clients cannot be invoiced
(409).

**Download and print.** `GET /api/o/[orgSlug]/invoices/[invoiceId]/pdf`
(`tenantRoute`, `invoice:read`) returns an A4 PDF generated with `pdf-lib`.
Its standard fonts only encode WinAnsi, so unsupported characters are
replaced and amounts use the currency code. The details page also prints
cleanly: the app shell and actions are `print:hidden`, and transient UI state
(e.g. an old validation error) is reset when the invoice becomes read-only.

**Not included (by scope):** partial payments, refunds or credit notes,
recurring invoices, per-organization default currency or tax, emailing
invoices, and an invoice activity history (lifecycle timestamps are stored).

## 6e. Dashboard

The organization home page (`/o/[orgSlug]`, in the `(overview)` route group
so its `loading.tsx` does not wrap other routes) shows:

- headline metrics: clients, active projects, open tasks, overdue invoices,
  total invoiced and total paid;
- progress of active projects;
- tasks by status;
- an invoice status summary;
- recent project/task activity and recent client activity.

**Access.** The page uses `tenantPage(orgSlug, "organization:read")`. The
organization and role come from the session and membership, never from the
request; only the URL slug is read, and a non-member gets a 404.
`getDashboard(db, role, now)` in `src/server/dashboard/service.ts` gates each
section by permission:

| Section  | Permission     |
| -------- | -------------- |
| Clients  | `client:read`  |
| Projects | `project:read` |
| Tasks    | `task:read`    |
| Invoices | `invoice:read` |

A section the role cannot read is returned as `null` and its queries are not
run, so MEMBER never queries invoices.

**Queries.** Every metric is computed in PostgreSQL through the tenant-scoped
client. One concurrent batch makes 13 SQL statements, a number that does not
change with data size (see the query-count test):

- `groupBy(status)` for clients, projects and tasks.
- Two invoice aggregates:
  - `groupBy(status, currency)` with `_count` and `_sum(totalCents)`;
  - the derived OVERDUE group (`status = ISSUED AND dueDate < todayUtc(now)`,
    the same rule as the invoice list), by currency.
- Three capped lists, each with Prisma's batched `IN (…)` relation loads:
  - the 5 active projects due soonest, with open-task counts computed in the
    same statement;
  - the 8 latest `ProjectActivity` rows (task events included);
  - the 8 latest `ClientActivity` rows.

The activity feeds are served by the `(organizationId, createdAt)` indexes
added in migration `dashboard_activity_indexes`. Nothing is cached.

**Definitions:**

- **Total clients:** ACTIVE + INACTIVE; archived clients are excluded.
- **Open tasks:** not DONE, in projects that are not archived.
- **Total invoiced:** ISSUED (including overdue) + PAID.
- **Total paid:** PAID.
- **Outstanding:** ISSUED.
- Drafts and cancelled invoices appear only in the status summary.

**Money.** Totals are integer cents per currency (`summarizeInvoices` in
`src/lib/dashboard.ts`). Different currencies are listed separately and never
added together. A sum outside the exact integer range throws instead of
rounding.

## 6f. Audit logging

One append-only, tenant-owned table, `AuditLog`, with these columns:

- `id` and `organizationId`;
- `actorUserId`, nullable;
- `action` (`<resource>.<verb>`) and `resourceType`;
- `resourceId`, nullable;
- `metadata` (a JSON object) and `createdAt`.

The vocabulary is defined in `src/lib/audit.ts`.

**Events:**

| Area                     | Actions                                                                                                                                                     | Where recorded                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Authentication           | `auth.login`, `auth.logout`, `auth.login_failed`, `auth.verification_failed`, `auth.password_changed`, `auth.password_change_failed`, `auth.password_reset` | Better Auth hooks (`src/server/auth/auth.ts` → `src/server/auth/audit.ts`) |
| Organization and members | `organization.created`, `member.added`, `member.role_changed` (with permissions granted/revoked), `member.removed`                                          | `organizations/bootstrap.ts`, `organizations/ownership.ts`                 |
| Clients                  | `client.created`, `client.updated`, `client.archived`, `client.restored`                                                                                    | clients service                                                            |
| Projects                 | `project.created`, `project.updated`, `project.status_changed`, `project.archived`, `project.restored`, `project.member_added`, `project.member_removed`    | projects service                                                           |
| Tasks                    | `task.assigned`, `task.unassigned` (including assignment on creation), `task.deleted`                                                                       | tasks service                                                              |
| Invoices                 | `invoice.created`, `invoice.issued`, `invoice.paid`, `invoice.cancelled` (previous status recorded as displayed, so OVERDUE → PAID)                         | invoices service                                                           |

There are no editable per-member permissions: a member's permissions are
their role. "Permission changes" are therefore audited as `member.role_changed`,
with the exact lists of permissions granted and revoked.

**Writing.** `recordAudit(tx, ctx, event)` in `src/server/audit/service.ts` is
the only helper that builds records:

- The actor is `ctx.userId` from the session, and the organization is
  `ctx.organization.id`.
- The tenant client rejects a record for any other organization.
- Business events are written inside the operation's own transaction, so the
  change and its record commit or roll back together. A failed or forbidden
  operation leaves no record.
- No route or Server Action writes audit records; a test checks `src/app`
  statically. Values from the request (e.g. `actorUserId` or `organizationId`
  in action input) are stripped by Zod and never reach a record.

**Authentication events** belong to an account, not an organization:

- One row is written per organization the user is a member of, where that
  organization's administrators can see it.
- The user always comes from Better Auth, never from the request body:
  - sign-in: the new session (`databaseHooks.session.create`);
  - sign-out: the deleted session on `/sign-out`;
  - failed sign-in: the account found for the attempted email, with no actor;
  - password change: the new session;
  - password reset: `onPasswordReset`.
- A failed sign-in for an unknown address, or for a user without
  organizations, is only logged, without the address.
- Recording is best effort: the sign-in or sign-out has already happened, so
  a write failure is logged instead of failing it.
- Metadata includes the IP and user agent as seen by Better Auth.

**Secrets.** `sanitizeAuditMetadata` makes metadata safe to store:

- drops keys that look like credentials at any depth (password, token,
  secret, API key, authorization, cookie, session, OTP, `code`, hash,
  credential, private key, signature);
- converts values to JSON;
- caps string length, array length and depth.

Callers never pass passwords or tokens in the first place; the hooks never
read the request's password.

**Immutability:**

1. The tenant client refuses `update*`, `delete*` and `upsert` on append-only
   models (`appendOnly` in `src/server/tenancy/models.ts`).
2. The `AuditLog_guard` trigger (migration `audit_logging`) rejects UPDATE
   and DELETE from any client. The only exceptions are foreign-key actions
   (`pg_trigger_depth() > 1`):
   - deleting the organization removes its log;
   - deleting a user only clears `actorUserId`.
3. CHECK constraints: the action format, the allowed resource types, and
   metadata must be an object.

`TRUNCATE` and the table owner are outside these guards. The application
must therefore **not** connect as the schema owner. `db/runtime-role.sql`
grants a runtime role (`clientflow_app`) row access only: no TRUNCATE, no DDL,
no trigger changes, and no UPDATE or DELETE on `AuditLog`. Foreign-key
cascades still work, because PostgreSQL runs them as the table owner.
`tests/integration/database-privileges.test.ts` applies the same script to a
test role and verifies both halves. (Audit M2; the role split itself is a
deployment step, see §12.)

**Reading.** `/o/[orgSlug]/audit-log` is the audit log page:

- It uses `tenantPage(orgSlug, "audit:read")`: OWNER and ADMIN only. Other
  roles see "access denied", and the nav item is hidden from them.
  Non-members get 404 and signed-out visitors are redirected.
- It is newest first and paginated (25 per page). The count and the reachable
  pages are capped at `AUDIT_COUNT_LIMIT` (10,000) matching events. Beyond
  that the page shows "10,000+" and the newest 10,000, with a hint to narrow
  the date range. Below the cap, counts are exact.
  - An exact `COUNT(*)` and a deep `OFFSET` grow with the log, which grows with
    every change and sign-in. The capped count is ordered like the page, so
    each filter's `(organizationId, …, createdAt)` index stops it after
    10,001 entries.
  - Pages are read from `(organizationId, createdAt, id)` without a sort.
  - Measured on 1M events (performance pass): first page 50 → 0.8 ms of
    database time, deepest page 191 → 1.5 ms.
- Filters are in the URL and parsed with Zod; invalid values are ignored:
  - an inclusive UTC date range;
  - actor (current members, or "no signed-in actor");
  - action;
  - resource type.
- Each row shows the action, the resource with a link when it still has a
  page, a summary of changes, and the full sanitized metadata on demand.
- Queries use the `(organizationId, …, createdAt)` indexes.

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

> **Production deployment requirements (security audit).**
>
> 1. **Database roles (M2).** Run `prisma migrate deploy` as the schema owner.
>    Create `clientflow_app` (LOGIN) once, apply
>    `psql "<owner URL>" -v ON_ERROR_STOP=1 -f db/runtime-role.sql` after every
>    migration, and set the application's `DATABASE_URL` to `clientflow_app`.
> 2. **TLS to the database (L10).** A non-local `DATABASE_URL` must include
>    `sslmode=require|verify-ca|verify-full`; production refuses to start
>    otherwise.
> 3. **Client IP (M1).** Put the app behind a proxy that sets or overwrites the
>    client address, make it the only way in, and set
>    `AUTH_CLIENT_IP_HEADER` or `AUTH_TRUSTED_PROXIES` (required in
>    production).
>
> **Rate-limit storage.** Counters are stored in PostgreSQL (`RateLimit`,
> Better Auth `rateLimit.storage: "database"`), so every instance enforces the
> same limits and restarts do not reset them. Client IPs must come from the
> trusted proxy configuration above.
>
> **Startup and health.** `src/instrumentation.ts` validates all configuration
> before the server accepts requests (invalid configuration stops the
> process) and logs every server error as one JSON line with its digest.
> `/api/health/live` is the liveness probe (no database); `/api/health` is the
> readiness probe (database check, 503).
>
> The full deployment, migration, rollback, backup and monitoring procedure is
> in [operations.md](operations.md).

## 13. Known limitations

Implemented behavior is described above. These are deliberately **not**
implemented yet (details and follow-ups per milestone in
[progress.md](progress.md)):

- **Member management UI:** no invitations, role-change or removal screens.
  The service functions (`src/server/organizations/ownership.ts`) enforce the
  rules and write audit records, but nothing calls them from a request yet.
  An organization is created with its OWNER only.
- **Settings:** no account screen (password, name, sessions) and no
  organization settings or deletion screen.
- **Operations:** browser checks are ad-hoc Playwright scripts, not CI. No
  error-tracking service is integrated (the `onRequestError` hook logs JSON
  and is where one would plug in). No audit-log retention policy.
- **Scale:** list pagination (other than the audit log) uses `OFFSET`; project
  search scans descriptions; the Kanban board reloads the page after each
  move; the dashboard's task counts are linear in tasks (index-only).
- **RBAC granularity:** MEMBER can work on tasks in any project of the
  organization (`task:update` is organization-wide).
