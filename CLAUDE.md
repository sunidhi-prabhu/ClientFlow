@AGENTS.md

# ClientFlow: project rules

Multi-tenant CRM + project-management SaaS (Next.js 16 App Router, TypeScript,
PostgreSQL, Prisma 7, Tailwind 4, shadcn/ui). Full rationale:
`docs/architecture.md`. Read it before adding a feature.

## Commands

- `npm run dev`: dev server (needs `.env` and `npm run db:up`, which also starts Mailpit at http://localhost:8025)
- `npm run check`: typecheck + lint + format check + tests. **Run before finishing any task.**
- `npm run test` / `npm run test:watch`: unit tests (no database)
- `npm run test:integration`: real-PostgreSQL tests (needs `TEST_DATABASE_URL`, DB name must end in `_test`)
- `npm run db:migrate -- --name <change>`: create/apply a migration after editing `prisma/schema.prisma`
- `npm run db:generate`: regenerate the Prisma client (also runs on `npm install`)

## Architecture rules

- **Layers:** `src/app` (routes, thin) → `src/server/<domain>` (business logic, data access) → `src/lib` (infra).
  Components never import `src/server` or `@/lib/db`.
- Server-only modules start with `import "server-only";`.
- Tenant data access only via `getTenantDb(organizationId)` from `@/server/tenancy`. The unscoped `getDb()`
  from `@/lib/db` is allowed only in the allowlist `RAW_DB_ALLOWED` in `eslint.config.mjs` (tenancy, health, auth,
  organization bootstrap).
  Add a module there only for genuine infrastructure/auth/bootstrap needs. Never construct `PrismaClient`; never
  import `@prisma/client`. Generated types come from `@/generated/prisma/client`. ESLint enforces all of this.
- Env vars: add to `.env.example` **and** the Zod schema in `src/lib/env.ts`; read via `getServerEnv()`, not `process.env`.
  Groups: `getServerEnv()` (database, logging), `getAuthEnv()` (Better Auth, Google), `getEmailEnv()` (SMTP).
  Exceptions: `LOG_LEVEL` in the logger (must work with invalid env), `BETTER_AUTH_URL` in `src/proxy.ts`, and
  test-only `TEST_DATABASE_URL`.
- Keep it a monolith. No new services, queues or caches without an explicit decision recorded in `docs/architecture.md`.

## Multi-tenancy & security (non-negotiable)

- **New model checklist** (see `prisma/schema.prisma` header):
  1. Tenant-owned → required `organizationId`, relation to `Organization` (`onDelete: Cascade`),
     `@@unique([organizationId, id])`, and any other indexes leading with `organizationId`.
  2. Relations to tenant-owned parents use composite FKs:
     `fields: [organizationId, parentId], references: [organizationId, id]` (`onDelete: NoAction`/`Cascade`, never `SetNull`).
  3. Classify it in `src/server/tenancy/models.ts` (a type error until you do).
  4. Add cross-tenant cases to `tests/integration/`. (`schema-invariants.test.ts` checks 1–2 automatically.)
- The `organizationId` passed to `getTenantDb` comes from the server-resolved tenant context
  (session + membership), **never** from client input alone.
- The tenant client rejects (never rewrites) other-org ids, nested relation writes and raw SQL. Write foreign keys
  as scalar columns (`clientId`), and let the composite FKs verify them. Don't work around a rejection.
- Cross-tenant reads/updates/deletes surface as 404 (Prisma P2025 → `NotFoundError`), not 403.
- Before writing a caller-supplied foreign id (e.g. `clientId`), resolve it with
  `requireTenantRecord(db, "client", id)` from `@/server/tenancy`. Unknown and other-org ids both give the same 404.
  Any P2003 that still reaches `toAppError` maps to the same 404 (child side) or 409 (deleting a referenced parent).
- Don't use `@@map` or custom FK `map:` names: P2003 classification relies on Prisma's default naming
  (checked by `schema-invariants.test.ts`).
- Roles (`OWNER` > `ADMIN` > `MANAGER` > `MEMBER`) live on `Membership`, not `User`.
  Authorization is enforced in the service layer via named permissions, not ad-hoc role comparisons or UI-only checks.
- Mutations that need auditing write the `AuditLog` row in the same transaction.
- New tenant-scoped features need tests that attempt cross-tenant access and insufficient-role access.

## Authentication, tenant context & RBAC

- Auth = Better Auth (`src/server/auth/auth.ts`). Never hand-roll password hashing, tokens or sessions. Session
  helpers: `getSession`, `getCurrentUser`, `requireSession` (throws 401), `requireSessionOrRedirect` (pages).
- Protected entry points use the pipeline in `src/server/protected.ts`, never their own auth code:
  `tenantAction({ permission, input }, …)`, `tenantRoute(…)` (routes under `/api/o/[orgSlug]/…`),
  `authenticatedAction` (signed in, no org). Pages use `getTenantContextForPage(orgSlug)`.
- Handlers get `ctx` (userId, organization, membership, role; from session + DB) and `db` (tenant-scoped). Never
  read user id, organization id or role from input; the org slug in the URL is only a selector.
- Permissions live in `src/lib/permissions.ts` (`<resource>:<action>`). Add new permissions there. Role changes
  must go through `assertCanChangeRole`.
- Change or remove memberships only via `changeMembershipRole` / `removeMembership`
  (`src/server/organizations/ownership.ts`): they return 409 instead of removing/demoting the last OWNER. The DB
  trigger is the backstop, not the check. To transfer ownership, promote the new owner first.
- Better Auth endpoints: review before enabling new ones and record the decision in docs/architecture.md
  ("Account-management endpoints"). `/change-password` always revokes other sessions (hook in `auth.ts`).
- Rate limiting is in-memory: single instance only until shared storage is configured (docs §12).
- `proxy.ts` is only a UX redirect + CSP nonce. It is not a security boundary.
- Emails go through `dispatchEmail` (deferred with `after()`). Never log codes, links, tokens or email bodies.
- Security headers: `src/lib/security/headers.ts`. Every page is dynamically rendered (CSP nonce); keep
  `connection()` in the root layout. Document any new CSP exception in docs/architecture.md.

## Error handling

- Expected failures: throw `AppError` subclasses from `@/lib/errors` (`NotFoundError`, `ForbiddenError`, `ValidationError`, …).
- Route handlers: wrap with `withErrorHandling` from `@/lib/api/handle-error`. Error body is `{ error: { code, message, details? } }`.
- Server Actions: return `ActionResult<T>`; convert caught errors with `toActionError`.
- Never put internal details (SQL, stack traces, connection strings) in client-facing messages; log with `logger` instead.

## Feature modules (pattern: clients)

- Shape: `src/lib/validation/<domain>.ts` (Zod) → `src/server/<domain>/service.ts` (tenant db only, writes + history
  in one transaction) → `src/app/o/[orgSlug]/<domain>/actions.ts` (`tenantAction`) → pages via
  `tenantPage(orgSlug, permission)` → presentational components in `src/components/<domain>/`.
- Look up ids from requests through the tenant client, so foreign ids are a 404 (`NotFoundError` → `notFound()`).
- Escape `%`, `_`, `\` before Prisma `contains` searches (see `escapeLikePattern` in the clients service).
- Don't put `loading.tsx` above a page that calls `notFound()`: the streamed shell turns the 404 into a 200.
  Scope list skeletons with a route group (e.g. `clients/(list)/loading.tsx`).
- Reuse `src/components/shared/` (ActivityTimeline, EmptyState, ListPagination, ArchiveButton, ListSearchInput +
  useListSearch, ProgressBar, SegmentError) and `escapeLikePattern` (`src/server/search.ts`) instead of copying them.
- Cross-entity references (e.g. project → client, project member → membership) get a composite FK on
  `(organizationId, …)` **and** an explicit tenant-client lookup before the write (clear 404 / 409 messages).
- Calendar dates (`@db.Date`) are UTC midnight: parse `YYYY-MM-DD` as UTC and format with `timeZone: "UTC"`
  (`src/lib/calendar-date.ts`, `calendarDateField` in `src/lib/validation/dates.ts`).
- Server Components can't pass functions to Client Components (only Server Actions): pass strings like a base path.
- Raw SQL / triggers that write timestamps must use `now() AT TIME ZONE 'UTC'` (Prisma stores UTC wall-clock time;
  the database server's time zone may differ).
- Status changes that can race (e.g. Kanban moves) are compare-and-set: `updateMany({ where: { id, status: old } })`,
  409 when nothing matched. Test races with a held row lock, not `Promise.all` (which rarely overlaps).
- Navigation that looks like a button: `<Link className={buttonVariants()}>`, not `<Button render={<Link/>}>` (which
  gives the link `role="button"`).

## Conventions

- Validate all external input (request bodies, form data, params) with Zod.
- Money = integer minor units + currency code. IDs = cuid. Timestamps UTC. All money math goes through
  `src/lib/money.ts` (BigInt, half-up rounding; quantities in thousandths, rates in basis points). Never do money
  arithmetic with floats, and never trust amounts or totals from the client: recompute on the server.
- Records that become immutable (e.g. issued invoices): enforce in the service (lock-and-check with
  `updateMany WHERE status = …`) **and** in the database (trigger), and let organization cascades through
  (`pg_trigger_depth() > 1`).
- UI: use `src/components/ui` (shadcn; add with `npx shadcn@latest add <name>`), Tailwind tokens (`bg-primary`,
  `text-muted-foreground`), never hard-coded colors. Must work at mobile widths.
- Only add a nav item (`src/config/navigation.ts`) when its route exists. No placeholder or mock features.
- Unit tests live next to code as `*.test.ts(x)`; client component tests add `// @vitest-environment jsdom`.
  Database behaviour (tenancy, constraints, migrations) is tested in `tests/integration/` against real PostgreSQL,
  never with mocks.
- Next.js 16 differs from older versions (e.g. error boundaries receive `retry`, not `reset`; `middleware` is now
  `proxy`). Check `node_modules/next/dist/docs/` when unsure.
