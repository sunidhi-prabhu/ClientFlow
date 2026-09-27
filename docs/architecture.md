# ClientFlow Architecture

ClientFlow is a multi-tenant CRM and project-management SaaS for freelancers and
small agencies. This document records the architecture and the decisions behind
it. Update it when a decision changes.

**Status:** foundation plus tenant-isolation layer. Authentication, RBAC and
all business features described below as _planned_ do not exist in code yet.

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

| Concern       | Choice                                | Why                                                                                        |
| ------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Framework     | Next.js 16 (App Router) + React 19    | Full-stack in one deployable; Server Components keep data access server-side               |
| Language      | TypeScript (strict)                   | Type safety across UI, services and database                                               |
| Database      | PostgreSQL 17                         | Relational integrity for tenants, invoices, audit history                                  |
| ORM           | Prisma 7 with `@prisma/adapter-pg`    | Mature migrations, generated types; the driver adapter is Prisma 7's standard runtime path |
| Validation    | Zod 4                                 | One schema for env, request bodies, form input                                             |
| Styling       | Tailwind CSS 4                        | Design tokens as CSS variables, fast iteration                                             |
| Components    | shadcn/ui (Base UI primitives)        | Accessible primitives whose source lives in the repo and can be edited                     |
| Icons         | lucide-react                          | Consistent, tree-shakeable                                                                 |
| Unit tests    | Vitest + Testing Library              | Fast, ESM-native, works with the same TS config                                            |
| Lint / format | ESLint (next config) + Prettier       | Standard Next.js rules; formatting never argued in review                                  |
| Local DB      | Docker Compose (`postgres:17-alpine`) | Reproducible dev database; creates a separate test database                                |

## 3. Code organization

```
src/
  app/                    Next.js routes only. Thin: parse input, call a service, render.
    (app)/                Authenticated application area (shares AppShell layout)
    api/                  Route handlers: health, webhooks, external/public API
    error.tsx, global-error.tsx, not-found.tsx
  components/
    ui/                   shadcn/ui primitives (generated, then owned by us)
    layout/               Application frame: shell, navigation, logo
  config/                 Static app configuration (navigation, etc.)
  lib/                    Framework-agnostic infrastructure
    db.ts                 Prisma client singleton (server-only)
    env.ts                Validated environment (server-only)
    errors.ts             AppError hierarchy + response/result types
    api/handle-error.ts   Error → HTTP response / ActionResult mapping
    logger.ts             Structured logger
  server/                 Server-only domain code, one folder per domain:
    health.ts             dependency health checks
    tenancy/              tenant-scoped Prisma client, model classification, scoping rules
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

Only modules in `RAW_DB_ALLOWED` (`eslint.config.mjs`: tenancy, health) may
import the unscoped `@/lib/db`. Everything else, including pages, route
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

### Rules for the request layer (with authentication)

1. Every request resolves a **tenant context** on the server:
   `{ userId, organizationId, role }` from the session plus a membership
   lookup. The organization id is **never trusted from client input alone**; a
   URL slug is only a _selector_ that must match a membership.
2. Only that resolved `organizationId` is passed to `getTenantDb`.
3. Cross-tenant access yields 404, never 403, so other tenants' data cannot be
   probed. (403 is reserved for explicit attempts the tenant client rejects.)

**Not used (yet):** PostgreSQL row-level security. It would need every query
wrapped in a transaction that sets the current org, plus a non-owner database
role. The three layers above provide the isolation guarantees without that
cost. The composite-key schema is compatible with adding RLS later.

## 5. Authorization / RBAC (planned design)

Roles, highest to lowest: `OWNER` > `ADMIN` > `MANAGER` > `MEMBER`.

| Role    | Intended scope                                                             |
| ------- | -------------------------------------------------------------------------- |
| OWNER   | Everything, including billing, deleting the org, transferring ownership    |
| ADMIN   | Manage members and settings, all CRM/project/invoice data                  |
| MANAGER | Manage clients, projects, tasks and invoices; no member/org administration |
| MEMBER  | Work on assigned projects and tasks; read access as configured             |

The exact permission matrix is finalized in the RBAC milestone. Implementation
principles:

- Permissions are checked in the **service layer**, not only in the UI. The UI
  hides actions the user cannot perform, but the server is the authority.
- Checks are expressed as named permissions (e.g. `invoice:send`) mapped to
  roles in one module, never as scattered `role === "ADMIN"` comparisons.
- An organization always has at least one OWNER.

## 6. Authentication (planned)

Not implemented. The library is chosen in the auth milestone. Requirements:
database-backed sessions stored in PostgreSQL via Prisma, secure HTTP-only
cookies, email/password plus optional OAuth, and support for multiple
organization memberships per user. Route protection will happen in server
code (layouts/services) and, where useful, in Next.js `proxy.ts` for redirects.
The proxy is not the security boundary.

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
platforms.
