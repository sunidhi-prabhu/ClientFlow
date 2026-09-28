# ClientFlow

CRM and project management for freelancers and small agencies: clients,
projects, Kanban tasks, invoices, a dashboard and an audit log, organized into
organizations with role-based access (OWNER, ADMIN, MANAGER, MEMBER).

## Status

Implemented and verified (unit, integration, real-browser; see
[docs/progress.md](docs/progress.md)):

- **Accounts:** email/password sign-up with email verification codes, sign-in,
  password reset, optional Google sign-in, rate limiting.
- **Organizations:** creation (the creator is OWNER), switching between
  organizations, role-based permissions enforced on the server.
- **Clients:** create, edit, archive/restore, search/filter/sort, activity
  history.
- **Projects:** create, edit, status and progress, members, archive/restore,
  activity history.
- **Tasks:** Kanban board with drag-and-drop and a keyboard-accessible
  "Move to" control, assignment to project members, priorities, due dates,
  history.
- **Invoices:** drafts with line items, server-computed totals (integer
  cents), issue (sequential numbers), mark paid, cancel, derived "overdue",
  PDF download and print view.
- **Dashboard:** metrics, project progress, task distribution, invoice
  summary, recent activity.
- **Audit log:** append-only record of sign-ins, member/role changes and
  business changes, for OWNER/ADMIN, with filters.

**Not implemented (known limitations):**

- **No member invitations or member-management screen.** An organization's
  only member through the UI is its creator. Other members can only be added
  directly in the database. The role-change and removal logic exists
  (and is audited), but has no UI.
- No account-settings screen: changing password, name or email; sessions.
  The underlying Better Auth endpoints exist.
- No organization settings or deletion screen, and no data export.
- No reporting beyond the dashboard.
- Single display currency per invoice from a fixed list (USD, EUR, GBP, INR,
  CAD, AUD); no currency conversion.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · PostgreSQL 17 · Prisma 7 ·
Tailwind CSS 4 · shadcn/ui · Better Auth · Zod · Vitest · Playwright (ad-hoc
browser checks) · ESLint · Prettier

Design: [docs/architecture.md](docs/architecture.md). Operations and
deployment: [docs/operations.md](docs/operations.md).

## Run it locally

**Prerequisites:** Node.js 24 (`nvm use` reads `.nvmrc`) and Docker (for
PostgreSQL 17 and Mailpit). Any PostgreSQL 17 with the `pg_trgm` extension
works too.

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # defaults match docker-compose.yml
openssl rand -base64 32     # put the output in .env as BETTER_AUTH_SECRET
npm run db:up               # PostgreSQL (localhost:5432) + Mailpit (localhost:8025)
npm run db:deploy           # apply all migrations
npm run dev                 # http://localhost:3000
```

1. Open http://localhost:3000/sign-up and create an account.
2. The 6-digit verification code arrives in Mailpit: http://localhost:8025.
   Password-reset links do too.
3. After verifying, create your first organization.
4. Health check: `curl http://localhost:3000/api/health` returns
   `{"status":"ok",…}`.

**Trying other roles locally:** there is no invitation screen yet. Sign up a
second account, then add its membership in the database (e.g. with
`npm run db:studio`: a `Membership` row with the organization id, the user
id and a role).

**Google sign-in (optional):** create an OAuth client in Google Cloud with
redirect URI `http://localhost:3000/api/auth/callback/google`, and set
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**Running the production build locally:**

```bash
npm run build
AUTH_TRUSTED_PROXIES=127.0.0.1 npm start   # production requires a client-IP setting
```

`npm start` runs with `NODE_ENV=production`. The app then refuses to start
unless the configuration is complete, including a client-IP setting;
`localhost` URLs are allowed without TLS.

## Testing

```bash
npm run check               # typecheck + lint + format check + unit tests (no database)
npm run test:integration    # real PostgreSQL: creates and migrates clientflow_test, wipes it between tests
```

CI (`.github/workflows/ci.yml`) runs `npm run check`, the integration tests
against PostgreSQL 17, a migration drift check and a production build.
Browser checks (Playwright scripts) were run manually for each milestone and
are not part of CI.

## Deploying

Summary only. The full procedure, required configuration and monitoring are
in [docs/operations.md](docs/operations.md).

1. **Infrastructure:**
   - a Node.js 24 host behind an HTTPS reverse proxy (the only way in);
   - managed PostgreSQL 17 with TLS, backups and point-in-time recovery;
   - an SMTP provider;
   - log collection with alerts.
2. **Configuration** (secret manager, never in the repository):
   - `DATABASE_URL` with `sslmode=verify-full`, connecting as the runtime role;
   - `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` (`https://`);
   - `AUTH_CLIENT_IP_HEADER` or `AUTH_TRUSTED_PROXIES`;
   - `SMTP_URL` (`smtps://`) and `EMAIL_FROM`;
   - optionally `GOOGLE_*` and the `DATABASE_*` pool settings.
3. **Database:**
   - run `npx prisma migrate deploy` as the schema owner (from CI or a build
     environment with dev dependencies);
   - apply `db/runtime-role.sql`;
   - have the app connect as `clientflow_app`.
4. **Release:** `npm ci && npm run build`, then `npm start`. Probes:
   - `/api/health/live` for liveness;
   - `/api/health` for readiness.
5. **Rollback:** redeploy the previous build; migrations are forward-only and
   must stay backward-compatible.

## Scripts

| Script                      | Description                                                    |
| --------------------------- | -------------------------------------------------------------- |
| `npm run dev`               | Start the dev server                                           |
| `npm run build`             | Production build                                               |
| `npm start`                 | Serve the production build                                     |
| `npm run check`             | Typecheck, lint, format check and unit tests                   |
| `npm run typecheck`         | Generate route types and run `tsc`                             |
| `npm run lint`              | ESLint (zero warnings allowed)                                 |
| `npm run format`            | Format with Prettier                                           |
| `npm test`                  | Unit tests                                                     |
| `npm run test:integration`  | Integration tests against real PostgreSQL                      |
| `npm run db:up` / `db:down` | Start / stop local PostgreSQL and Mailpit (Docker)             |
| `npm run db:migrate`        | Create and apply a migration from `prisma/schema.prisma` (dev) |
| `npm run db:deploy`         | Apply pending migrations (production/CI)                       |
| `npm run db:generate`       | Regenerate the Prisma client                                   |
| `npm run db:studio`         | Open Prisma Studio                                             |
| `npm run db:reset`          | Drop, recreate and re-migrate the dev database                 |

## Environment variables

Declared in [.env.example](.env.example) and validated by
[src/lib/env.ts](src/lib/env.ts); see
[docs/operations.md](docs/operations.md) for production values.

| Variable                                         | Required                  | Description                                                                   |
| ------------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`                                   | yes                       | PostgreSQL connection string (TLS required for non-local hosts in production) |
| `DATABASE_POOL_MAX`                              | no                        | Connections per process (default 10)                                          |
| `DATABASE_CONNECT_TIMEOUT_MS`                    | no                        | Default 10000                                                                 |
| `DATABASE_STATEMENT_TIMEOUT_MS`                  | no                        | Default 30000                                                                 |
| `LOG_LEVEL`                                      | no                        | `debug` \| `info` (default) \| `warn` \| `error`                              |
| `BETTER_AUTH_SECRET`                             | yes                       | Signs cookies and tokens; at least 32 characters                              |
| `BETTER_AUTH_URL`                                | yes                       | Public base URL (HTTPS in production)                                         |
| `AUTH_CLIENT_IP_HEADER` / `AUTH_TRUSTED_PROXIES` | one of them in production | How the client IP is determined (rate limiting, audit)                        |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`      | no                        | Enable Google sign-in (both or neither)                                       |
| `SMTP_URL`                                       | yes                       | SMTP server (`smtp://localhost:1025` = Mailpit)                               |
| `EMAIL_FROM`                                     | yes                       | Sender address                                                                |
| `TEST_DATABASE_URL`                              | for integration tests     | Name must end in `_test` (created if missing, wiped between tests)            |

## Project structure

```
src/app/            Routes: pages, Server Actions, route handlers (auth, health, invoice PDF)
src/components/     UI primitives (ui/), layout, shared pieces and one folder per feature
src/config/         Navigation
src/lib/            Infrastructure and pure logic: db, env, errors, logger, money, permissions, validation
src/server/         Server-only domain logic and data access (one folder per domain), tenancy, auth
src/instrumentation.ts  Startup configuration check and server error logging
prisma/             Schema and migrations
db/                 Runtime database role (least privilege)
tests/integration/  Real-PostgreSQL tests
docs/               Architecture, operations runbook, progress log
```

## Multi-tenancy

Application code reads and writes tenant data only through
`getTenantDb(organizationId)` from `src/server/tenancy`. It scopes every query
to one organization and rejects cross-organization writes. Composite foreign
keys make PostgreSQL itself reject cross-organization links. See
[docs/architecture.md §4](docs/architecture.md#4-multi-tenancy) and the
new-model checklist in [CLAUDE.md](CLAUDE.md).

## Roadmap

1. Member management: invitations, role changes, removal (service logic exists)
2. Account and organization settings
3. Reporting and data export
