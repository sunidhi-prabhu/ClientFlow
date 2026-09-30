# ClientFlow operations runbook

What must be in place outside this repository before real customers use
ClientFlow, and how to deploy, migrate, roll back, back up and monitor it.
Application design is in [architecture.md](architecture.md); status in
[progress.md](progress.md).

Items marked **Required** are not done by the code; someone has to configure
them. The application refuses to start (see "Startup") when the configuration
it can check is missing or unsafe.

## 1. Infrastructure

| Component      | Requirement                                                                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js        | 24.x (`.nvmrc`, `engines`). Run `next start` (`npm start`) behind a reverse proxy or load balancer that terminates HTTPS.                                                                                                              |
| PostgreSQL     | 17 (tested), managed service with TLS, point-in-time recovery and automated backups. The `pg_trgm` extension must be available (trusted; the migration creates it).                                                                    |
| SMTP           | A transactional email provider reachable over `smtps://` (verification codes, password-reset links).                                                                                                                                   |
| Reverse proxy  | **Required.** Only path to the app. Sets or overwrites the client address (see `AUTH_CLIENT_IP_HEADER` / `AUTH_TRUSTED_PROXIES`) and forwards `Host` / `X-Forwarded-Host` unchanged (Server Actions compare the Origin with the host). |
| Log collection | **Required.** Collects stdout/stderr (one JSON object per line in production) and supports alerts (section 7).                                                                                                                         |

Instances: rate-limit counters are stored in PostgreSQL (`RateLimit`), so
several instances enforce one shared limit. Size the connection pools:
`instances × DATABASE_POOL_MAX` must stay below the database's connection
limit (or use a pooler such as PgBouncer in transaction mode).

## 2. Configuration

All variables are validated in `src/lib/env.ts` (see `.env.example`).

| Variable                                                           | Production value                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                     | The **runtime role** (`clientflow_app`, section 4) with `sslmode=verify-full` (TLS is required for non-local databases). |
| `DATABASE_POOL_MAX`                                                | Connections per instance (default 10).                                                                                   |
| `DATABASE_CONNECT_TIMEOUT_MS`                                      | Default 10000.                                                                                                           |
| `DATABASE_STATEMENT_TIMEOUT_MS`                                    | Default 30000.                                                                                                           |
| `BETTER_AUTH_SECRET`                                               | ≥ 32 random characters (`openssl rand -base64 32`), from the secret manager.                                             |
| `BETTER_AUTH_URL`                                                  | The public `https://` origin.                                                                                            |
| `AUTH_CLIENT_IP_HEADER` **or** `AUTH_TRUSTED_PROXIES`              | Required in production (section 1).                                                                                      |
| `SMTP_URL`, `EMAIL_FROM`                                           | Provider credentials (`smtps://`). Timeouts are added automatically unless set in the URL.                               |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                         | Optional; both or neither.                                                                                               |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` (8) | Optional billing (section 8): all or none. Live keys (`sk_live_`) only in production.                                    |
| `LOG_LEVEL`                                                        | `info`.                                                                                                                  |

Never set `AUTH_RATE_LIMIT` (tests only; it can only turn rate limiting on).

**Secrets** (`BETTER_AUTH_SECRET`, database and SMTP passwords, Google secret,
Stripe secret key and webhook secret)
live in the platform's secret manager, never in the repository or image
(`.env*` files are git-ignored; only `.env.example` is tracked). No secret is
exposed to the browser: the app has no `NEXT_PUBLIC_*` variables and all
configuration is read on the server.

**Rotating `BETTER_AUTH_SECRET`** signs everyone out (session cookies are
signed with it). Rotate it after any suspected leak; plan it otherwise.

## 3. Startup, health and shutdown

- **Startup:** `src/instrumentation.ts` validates the database, auth and email
  configuration before the server accepts requests. An invalid configuration
  stops the process with a message naming the variable.
- **Liveness:** `GET /api/health/live` → 200 whenever the process serves
  requests. Does not touch the database (an outage must not restart healthy
  instances).
- **Readiness:** `GET /api/health` → 200 with a database check, 503 when
  PostgreSQL is unreachable (3 s timeout). Use it to take instances out of the
  load balancer, not to restart them.
- **Shutdown:** the platform sends SIGTERM to `next start`. Configure a
  drain period (take the instance out of the load balancer first, then stop
  it) and verify on the platform that in-flight requests complete. Emails
  queued with `after()` in the last moments may be lost; users can request a
  new code.

## 4. Database

### Roles (required)

1. Migrations run as the **schema owner**.
2. Create the runtime role once: `CREATE ROLE clientflow_app LOGIN PASSWORD '…';`
3. After **every** migration run
   `psql "<owner URL>" -v ON_ERROR_STOP=1 -f db/runtime-role.sql` (grants row
   access only; the audit log is insert/select only; new tables need the
   re-run).
4. The application's `DATABASE_URL` uses `clientflow_app`.

### Migrations

- Apply with `npx prisma migrate deploy` (as the owner) **before** starting the
  new version. The Prisma CLI is a dev dependency: run it from the CI/build
  environment (full `npm ci`), not from a production-only install. The
  runtime needs no Prisma CLI (the client is generated at build time).
- Migrations run in a transaction; a failure leaves the schema unchanged.
- Write **backward-compatible (expand/contract)** migrations: the previous
  release must keep working on the new schema (add columns as nullable or
  with defaults, backfill, then enforce in a later release; never rename or
  drop in the same release that stops using a column).
- `CREATE INDEX` in a migration blocks writes to that table while it builds.
  On large tables, create the index `CONCURRENTLY` by hand first (same name)
  and make the migration `CREATE INDEX IF NOT EXISTS`, or schedule a quiet
  window. Existing migrations were applied to empty or small tables.
- CI verifies every migration applies to a fresh database and that the schema
  matches (`prisma migrate diff`).

### Backups and restore (required)

- Enable automated daily backups **and** point-in-time recovery (target RPO ≤ 5
  minutes, RTO ≤ 1 hour; adjust to the contract).
- Encrypt backups and restrict access (they contain personal data, invoices
  and the audit log).
- **Test a restore** into a separate instance at least quarterly: run
  `npx prisma migrate status` against it and sign in.
- The audit log has no retention limit. Deleting an organization deletes its
  audit history (cascade), so backups are the only record afterwards; define a
  retention policy before offering account deletion.

## 5. Deploying and rolling back

1. CI must pass (typecheck, lint, format, unit, integration, drift check,
   build).
2. Back up (or confirm a recent PITR point).
3. `npx prisma migrate deploy` as the owner, then re-apply
   `db/runtime-role.sql`.
4. Deploy the new build; instances become ready when `/api/health` returns 200.
5. Smoke test: sign in, open the overview, open an invoice PDF.

**Rollback:** redeploy the previous build. Because migrations are
backward-compatible (section 4), the previous version runs on the new schema.
Prisma has no down migrations: undo a schema change with a new forward
migration, or restore from backup (PITR) for data problems. Never edit an
applied migration.

## 6. Security operations

- Single entry point through the proxy; the app is not reachable directly
  (client-IP trust depends on it).
- HTTPS only (`BETTER_AUTH_URL` must be `https://`; cookies are then `Secure`,
  HSTS is sent).
- The runtime database role cannot alter or delete audit records (section 4).
- Dependencies: run `npm audit` (or an equivalent scanner) in CI and before
  releases; pin GitHub Actions to commit SHAs.

## 7. Monitoring and alerting (required)

Logs are JSON lines with `level`, `time`, `msg` and context. Alert on:

| Signal                                                                                                     | Meaning                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/api/health` 503 or failing readiness                                                                     | Database unreachable.                                                   |
| `msg: "Request failed"` (rate above baseline)                                                              | Unhandled server errors; the `digest` matches the "Ref" shown to users. |
| `msg: "Email delivery failed"`                                                                             | SMTP provider problems: users are not getting codes or reset links.     |
| `msg: "Tenant isolation violation rejected"`                                                               | A code path tried to cross organizations: investigate immediately.      |
| `msg: "Could not record authentication audit event"`                                                       | Audit trail gap for sign-ins.                                           |
| `[auth]` warnings, many 429 responses                                                                      | Credential stuffing or misconfigured client IPs.                        |
| Database: connections, CPU, slow queries (`statement_timeout` cancellations), storage growth of `AuditLog` | Capacity.                                                               |

Error tracking: the `onRequestError` hook in `src/instrumentation.ts` is the
place to forward errors to a tracker (e.g. Sentry) when one is chosen.

## 8. Billing (Stripe)

Billing is optional: without the Stripe variables every organization stays on
Free and the billing page says paid plans are unavailable. To enable it:

1. **Stripe account.** Use **test mode** until real payments are intended
   (outside production the app only accepts `sk_test_` keys). Payouts go to
   the bank account connected in Stripe (Settings → Payouts).
2. **Products and prices.** Create one product per paid plan (Starter, Growth,
   Professional, Agency), each with two **recurring** USD prices: monthly
   ($9, $19, $39, $79) and yearly ($90, $190, $390, $790). Copy the eight
   `price_…` ids into the `STRIPE_PRICE_*` variables. The app never accepts a
   price from the browser; an unknown price on a subscription grants nothing.
3. **Payment methods.** Settings → Payment methods: enable the methods to offer
   (cards, wallets, bank debits that support recurring payments). Checkout
   shows what is enabled there; card details never reach ClientFlow.
4. **Customer portal.** Settings → Billing → Customer portal: activate it
   (payment method updates, invoice history; plan changes and cancellation
   are done in ClientFlow).
5. **Webhook endpoint.** Developers → Webhooks → Add endpoint:
   `https://<your domain>/api/billing/webhook`, events
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `customer.subscription.paused`, `customer.subscription.resumed`,
   `invoice.paid`, `invoice.payment_failed`. Put its signing secret in
   `STRIPE_WEBHOOK_SECRET`.
   Locally: `stripe listen --forward-to localhost:3000/api/billing/webhook`
   prints a `whsec_…` secret for development.
6. **Restricted key (recommended).** Instead of the secret key, a restricted
   key (`rk_…`) with write access to Customers, Checkout Sessions,
   Subscriptions and Customer portal sessions.
7. Deploy, then re-apply `db/runtime-role.sql` (new tables `Subscription`,
   `StripeEvent`).

**Behavior to know:**

- The plan changes only from verified Stripe data (webhook, or the checkout
  return page re-reading the session from Stripe). Redirect URLs grant nothing.
- `PAST_DUE` keeps the paid plan while Stripe retries the payment; `UNPAID`,
  `CANCELED`, `INCOMPLETE*` and `PAUSED` fall back to Free limits. Nothing is
  ever deleted: over-limit organizations keep using their records and only
  new clients/projects (and restores) are refused. Configure Stripe's retry
  schedule and final action (Settings → Billing → Subscriptions and emails).
- Webhook failures return 500 and Stripe retries for up to three days; watch
  for "Stripe webhook rejected" (bad signature) and "unknown Price" errors in
  the logs. Each processed event id is stored in `StripeEvent` (prunable after
  30 days).
- Test cards: `4242 4242 4242 4242` (succeeds), `4000 0000 0000 0341`
  (attaches, then fails on charge); any future date and CVC.
