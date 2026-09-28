-- Least-privilege database role for the running application.
--
-- The schema is owned by the migration role (the one `prisma migrate deploy`
-- connects as). The application connects as `clientflow_app`, which may only
-- read and write rows: no DDL, no TRUNCATE, no trigger changes, and no UPDATE
-- or DELETE on the append-only audit log. Foreign-key cascades (deleting an
-- organization or user) still work: PostgreSQL runs them as the table owner.
--
-- Once per environment, as an administrator:
--   CREATE ROLE clientflow_app LOGIN PASSWORD '<strong password>';
-- After every `prisma migrate deploy` (it only grants on existing tables):
--   psql "<owner connection URL>" -v ON_ERROR_STOP=1 -f db/runtime-role.sql
-- Then set the application's DATABASE_URL to connect as clientflow_app.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO clientflow_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clientflow_app;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM clientflow_app;

-- Migration bookkeeping is not the application's business.
REVOKE ALL ON TABLE public."_prisma_migrations" FROM clientflow_app;

-- The audit log is append-only for the application.
REVOKE UPDATE, DELETE ON TABLE public."AuditLog" FROM clientflow_app;
