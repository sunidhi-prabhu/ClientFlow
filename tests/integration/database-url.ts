/**
 * URL of the integration test database. Integration tests delete all data
 * between tests, so this refuses anything that is not clearly a test database.
 */
export function getTestDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Add it to .env (see .env.example) to run integration tests.",
    );
  }

  const url = new URL(raw);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration tests against "${databaseName}": the database name must end in "_test".`,
    );
  }
  if (process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).href === url.href) {
    throw new Error("TEST_DATABASE_URL must not be the same database as DATABASE_URL.");
  }
  return raw;
}
