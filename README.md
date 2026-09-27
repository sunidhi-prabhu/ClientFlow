# ClientFlow

CRM and project management for freelancers and small agencies: clients,
projects, Kanban tasks, invoices and reporting, organized into multi-user
organizations with role-based access.

> **Status:** project foundation. The application shell, database connection,
> health check, error handling, tenant-isolation layer and test setup
> (unit + PostgreSQL integration + CI) are in place. Authentication and
> business features are not implemented yet (see [Roadmap](#roadmap)).

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · PostgreSQL 17 · Prisma 7 ·
Tailwind CSS 4 · shadcn/ui · Zod · Vitest · ESLint · Prettier

See [docs/architecture.md](docs/architecture.md) for design decisions.

## Prerequisites

- Node.js 24 (`nvm use` reads `.nvmrc`)
- Docker (for the local PostgreSQL database), or any PostgreSQL 15+ you can connect to

## Getting started

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # defaults match docker-compose.yml
npm run db:up               # start PostgreSQL in Docker and wait until healthy
npm run dev                 # http://localhost:3000
```

Check that everything is connected:

```bash
curl http://localhost:3000/api/health
# {"status":"ok",...,"checks":{"database":{"status":"ok","latencyMs":2}}}
```

The overview page at `/` shows the same database status.

**Using your own PostgreSQL instead of Docker:** set `DATABASE_URL` in `.env`
and skip `npm run db:up`.

## Scripts

| Script                     | Description                                                    |
| -------------------------- | -------------------------------------------------------------- |
| `npm run dev`              | Start the dev server                                           |
| `npm run build`            | Production build                                               |
| `npm start`                | Serve the production build                                     |
| `npm run check`            | Typecheck, lint, format check and tests (run before pushing)   |
| `npm run typecheck`        | Generate route types and run `tsc`                             |
| `npm run lint`             | ESLint (zero warnings allowed)                                 |
| `npm run format`           | Format with Prettier                                           |
| `npm test`                 | Run the test suite once                                        |
| `npm run test:watch`       | Run tests in watch mode                                        |
| `npm run test:integration` | Integration tests against real PostgreSQL                      |
| `npm run db:up`            | Start local PostgreSQL (Docker)                                |
| `npm run db:down`          | Stop local PostgreSQL (data is kept in a volume)               |
| `npm run db:migrate`       | Create and apply a migration from `prisma/schema.prisma` (dev) |
| `npm run db:deploy`        | Apply pending migrations (production/CI)                       |
| `npm run db:generate`      | Regenerate the Prisma client                                   |
| `npm run db:studio`        | Open Prisma Studio                                             |
| `npm run db:reset`         | Drop, recreate and re-migrate the dev database                 |

## Environment variables

Declared in [.env.example](.env.example) and validated at runtime by
[src/lib/env.ts](src/lib/env.ts).

| Variable            | Required              | Description                                                                       |
| ------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`      | yes                   | PostgreSQL connection string                                                      |
| `LOG_LEVEL`         | no                    | `debug` \| `info` (default) \| `warn` \| `error`                                  |
| `TEST_DATABASE_URL` | for integration tests | Test database; name must end in `_test` (created if missing, wiped between tests) |

## Project structure

```
src/app/            Routes, layouts, route handlers (api/health)
src/components/     UI primitives (ui/) and app frame (layout/)
src/config/         Static configuration (navigation)
src/lib/            Infrastructure: db, env, errors, logger
src/server/         Server-only domain logic (one folder per domain)
prisma/             Schema and migrations
docs/               Architecture documentation
tests/              Test setup
```

## Database

Local PostgreSQL runs in Docker ([docker-compose.yml](docker-compose.yml)) with
databases `clientflow` (development) and `clientflow_test` (reserved for
integration tests). The Prisma client connects through the `pg` driver
adapter; the connection URL is configured in
[prisma.config.ts](prisma.config.ts). Change the schema in
`prisma/schema.prisma`, then run `npm run db:migrate -- --name <change>`.

## Testing

```bash
npm test                    # unit tests, no database needed
npm run db:up               # then, with PostgreSQL running:
npm run test:integration    # creates + migrates clientflow_test, cleans data between tests
```

CI (`.github/workflows/ci.yml`) runs `npm run check`, the integration tests
against PostgreSQL 17, a schema/migration drift check, and a production build.

## Multi-tenancy

Application code reads and writes tenant data only through
`getTenantDb(organizationId)` from `src/server/tenancy`, which scopes every
query to one organization. Composite foreign keys make PostgreSQL itself reject
cross-organization links. See
[docs/architecture.md §4](docs/architecture.md#4-multi-tenancy) and the
new-model checklist in [CLAUDE.md](CLAUDE.md).

## Roadmap

1. Authentication, users, memberships and organization switching
2. Tenant context resolution (session + membership → `getTenantDb`)
3. RBAC enforcement and role-based tests
4. Client management
5. Projects and Kanban tasks
6. Invoices
7. Audit logs
8. Reporting
