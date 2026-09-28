# ClientFlow

CRM and project management for freelancers and small agencies: clients,
projects, Kanban tasks, invoices and reporting, organized into multi-user
organizations with role-based access.

> **Status:** foundation, tenant isolation, authentication (email/password,
> email verification, password reset, Google), organizations with roles, RBAC,
> client management, project management and task management (Kanban) are in
> place. Invoices and reports are not implemented yet (see [Roadmap](#roadmap)).

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · PostgreSQL 17 · Prisma 7 ·
Tailwind CSS 4 · shadcn/ui · Better Auth · Zod · Vitest · ESLint · Prettier

See [docs/architecture.md](docs/architecture.md) for design decisions.

## Prerequisites

- Node.js 24 (`nvm use` reads `.nvmrc`)
- Docker (for the local PostgreSQL database), or any PostgreSQL 15+ you can connect to

## Getting started

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # defaults match docker-compose.yml
# set BETTER_AUTH_SECRET in .env:  openssl rand -base64 32
npm run db:up               # PostgreSQL + Mailpit (local email inbox) in Docker
npm run db:deploy           # apply migrations
npm run dev                 # http://localhost:3000
```

Create an account at http://localhost:3000/sign-up. The verification code
(and any password reset link) arrives in Mailpit at http://localhost:8025.
After verifying, create your first organization.

To enable **Continue with Google**, create an OAuth client in Google Cloud,
add `http://localhost:3000/api/auth/callback/google` as an authorized redirect
URI, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Check that everything is connected:

```bash
curl http://localhost:3000/api/health
# {"status":"ok",...,"checks":{"database":{"status":"ok","latencyMs":2}}}
```

Each organization's overview page (`/o/<slug>`) shows the same database status.

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

| Variable                                    | Required              | Description                                                                            |
| ------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | yes                   | PostgreSQL connection string                                                           |
| `LOG_LEVEL`                                 | no                    | `debug` \| `info` (default) \| `warn` \| `error`                                       |
| `BETTER_AUTH_SECRET`                        | yes                   | Signs cookies and tokens; at least 32 characters                                       |
| `BETTER_AUTH_URL`                           | yes                   | Public base URL (HTTPS in production)                                                  |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no                    | Enable Google sign-in (both or neither)                                                |
| `SMTP_URL`                                  | yes                   | SMTP server for verification codes and reset links (`smtp://localhost:1025` = Mailpit) |
| `EMAIL_FROM`                                | yes                   | Sender address                                                                         |
| `TEST_DATABASE_URL`                         | for integration tests | Test database; name must end in `_test` (created if missing, wiped between tests)      |

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

1. Member management (invitations, role changes, removal)
2. ~~Client management~~ (done)
3. ~~Projects and Kanban tasks~~ (done)
4. Invoices
5. Audit logs
6. Reporting
