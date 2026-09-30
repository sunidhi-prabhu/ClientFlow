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

| Variable                                                                                   | Production value                                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                                             | The **runtime role** (`clientflow_app`, section 4) with `sslmode=verify-full` (TLS is required for non-local databases). |
| `DATABASE_POOL_MAX`                                                                        | Connections per instance (default 10).                                                                                   |
| `DATABASE_CONNECT_TIMEOUT_MS`                                                              | Default 10000.                                                                                                           |
| `DATABASE_STATEMENT_TIMEOUT_MS`                                                            | Default 30000.                                                                                                           |
| `BETTER_AUTH_SECRET`                                                                       | ≥ 32 random characters (`openssl rand -base64 32`), from the secret manager.                                             |
| `BETTER_AUTH_URL`                                                                          | The public `https://` origin.                                                                                            |
| `AUTH_CLIENT_IP_HEADER` **or** `AUTH_TRUSTED_PROXIES`                                      | Required in production (section 1).                                                                                      |
| `SMTP_URL`, `EMAIL_FROM`                                                                   | Provider credentials (`smtps://`). Timeouts are added automatically unless set in the URL.                               |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                                 | Optional; both or neither.                                                                                               |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_*` (8) | Optional billing (section 8): all or none. Live keys (`rzp_live_`) only in production.                                   |
| `LOG_LEVEL`                                                                                | `info`.                                                                                                                  |

Never set `AUTH_RATE_LIMIT` (tests only; it can only turn rate limiting on).

**Secrets** (`BETTER_AUTH_SECRET`, database and SMTP passwords, Google secret,
Razorpay key secret and webhook secret)
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

## 8. Billing (Razorpay)

Billing is optional: without the Razorpay variables every organization stays
on Free and the billing page says paid plans are unavailable. Plans are priced
in **USD**, so customers pay by **card** (Razorpay supports international
currencies for subscriptions on cards only; UPI and eMandate are INR-only).
To enable it:

1. **Razorpay account** at https://dashboard.razorpay.com. Test mode works
   right after sign-up; live mode needs KYC (business details, bank account),
   and payouts go to that Indian bank account.
2. **International payments.** Account & Settings → International payments:
   request activation (needed for USD; test mode may also require it).
3. **API keys.** Account & Settings → API Keys → Generate test key: put the key
   id (`rzp_test_…`) and secret in `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
   Outside production the app only accepts test keys.
4. **Plans.** `npm run billing:setup-plans` creates the 8 USD plans (monthly and
   yearly for Starter $9/$90, Growth $19/$190, Professional $39/$390, Agency
   $79/$790) and prints the `RAZORPAY_PLAN_*` lines. Safe to re-run. Before each
   checkout ClientFlow re-checks the plan's amount, currency and period against
   `src/lib/billing.ts` and refuses to charge a mismatch.
5. **Webhook.** Account & Settings → Webhooks → Add: URL
   `https://<your domain>/api/billing/webhook`, a secret of your choice (≥ 16
   characters, also in `RAZORPAY_WEBHOOK_SECRET`), events
   `subscription.authenticated`, `subscription.activated`,
   `subscription.charged`, `subscription.pending`, `subscription.halted`,
   `subscription.cancelled`, `subscription.completed`, `subscription.paused`,
   `subscription.resumed`, `subscription.updated`. Razorpay cannot reach
   `localhost`: locally the billing page re-reads the subscription on each
   visit instead (or use a tunnel such as `cloudflared` to test webhooks).
6. Deploy, then re-apply `db/runtime-role.sql` (tables `Subscription`,
   `BillingEvent`).

**GST.** Every paid plan is charged its price plus 18% GST (`GST_RATE_BPS` in
`src/lib/billing.ts`): $9 → $10.62, $19 → $22.42, $39 → $46.02, $79 → $93.22
per month (yearly $106.20 / $224.20 / $460.20 / $932.20). The pricing page shows
"+ 18% GST" and each payment step shows price, GST and total; the Razorpay plans
are created with the GST-inclusive total. GST may only be charged once the
business is GST-registered: set `gstin` in `src/config/business.ts` (shown on
the policy pages) and confirm the treatment with an accountant before going live.

**Policy pages** (`/terms`, `/privacy`, `/refunds`, `/delivery`, `/contact`,
linked from the landing page footer) are what Razorpay's website review checks.
Business details live in `src/config/business.ts`; update `policiesUpdated`
whenever the text changes, and have the text reviewed before going live.

**Behavior to know:**

- Checkout creates the subscription on the server and opens Razorpay's hosted
  payment page in a new tab. The plan changes only from subscription data read
  back from Razorpay (webhook, or the billing page re-reading the
  organization's own stored subscription); nothing in a URL grants anything.
- Upgrades apply immediately (Razorpay `schedule_change_at: now`); downgrades
  and annual → monthly apply at the end of the billing period. Cancelling
  (downgrade to Free) happens at the end of the period and **cannot be undone**
  at Razorpay; the organization can subscribe again afterwards.
- `pending` (a charge failed, Razorpay retries) keeps the paid plan; `halted`,
  `cancelled`, `completed`, `expired` and `paused` fall back to Free limits.
  Nothing is ever deleted: over-limit organizations keep using their records and
  only new clients/projects (and restores) are refused.
- Webhook failures return 500 and Razorpay retries; watch for "Billing webhook
  rejected" (bad signature) and "unknown provider plan" / "does not match the
  published price" errors in the logs. Processed event ids are stored in
  `BillingEvent` (prunable after 30 days).
- Test cards (test mode): Mastercard `5104 0155 5555 5558` (international,
  recurring), any future expiry and CVV; simulate a failed renewal from the
  subscription's page in the dashboard.
