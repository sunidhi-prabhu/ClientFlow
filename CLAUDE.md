@AGENTS.md

# ClientFlow: project rules

Multi-tenant CRM + project-management SaaS (Next.js 16 App Router, TypeScript,
PostgreSQL, Prisma 7, Tailwind 4, shadcn/ui). Full rationale:
`docs/architecture.md`. Read it before adding a feature.

## Commands

- `npm run dev`: dev server (needs `.env` and `npm run db:up`)
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
  from `@/lib/db` is allowed only in the allowlist `RAW_DB_ALLOWED` in `eslint.config.mjs` (tenancy, health).
  Add a module there only for genuine infrastructure/auth/bootstrap needs. Never construct `PrismaClient`; never
  import `@prisma/client`. Generated types come from `@/generated/prisma/client`. ESLint enforces all of this.
- Env vars: add to `.env.example` **and** the Zod schema in `src/lib/env.ts`; read via `getServerEnv()`, not `process.env`.
  Exceptions: `LOG_LEVEL` in the logger (must work with invalid env) and test-only `TEST_DATABASE_URL`.
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

## Error handling

- Expected failures: throw `AppError` subclasses from `@/lib/errors` (`NotFoundError`, `ForbiddenError`, `ValidationError`, …).
- Route handlers: wrap with `withErrorHandling` from `@/lib/api/handle-error`. Error body is `{ error: { code, message, details? } }`.
- Server Actions: return `ActionResult<T>`; convert caught errors with `toActionError`.
- Never put internal details (SQL, stack traces, connection strings) in client-facing messages; log with `logger` instead.

## Conventions

- Validate all external input (request bodies, form data, params) with Zod.
- Money = integer minor units + currency code. IDs = cuid. Timestamps UTC.
- UI: use `src/components/ui` (shadcn; add with `npx shadcn@latest add <name>`), Tailwind tokens (`bg-primary`,
  `text-muted-foreground`), never hard-coded colors. Must work at mobile widths.
- Only add a nav item (`src/config/navigation.ts`) when its route exists. No placeholder or mock features.
- Unit tests live next to code as `*.test.ts(x)`; client component tests add `// @vitest-environment jsdom`.
  Database behaviour (tenancy, constraints, migrations) is tested in `tests/integration/` against real PostgreSQL,
  never with mocks.
- Next.js 16 differs from older versions (e.g. error boundaries receive `retry`, not `reset`; `middleware` is now
  `proxy`). Check `node_modules/next/dist/docs/` when unsure.
