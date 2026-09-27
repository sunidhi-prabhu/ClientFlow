import { afterAll, beforeEach } from "vitest";

import { getDb } from "@/lib/db";

let tables: string[] | undefined;

/** Every application table in the test database (migrations bookkeeping excluded). */
async function applicationTables() {
  tables ??= (
    await getDb().$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  ).map(({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`);
  return tables;
}

// Isolate tests: start each one from empty tables.
beforeEach(async () => {
  const names = await applicationTables();
  if (names.length > 0) {
    await getDb().$executeRawUnsafe(`TRUNCATE TABLE ${names.join(", ")} RESTART IDENTITY CASCADE`);
  }
});

afterAll(async () => {
  await getDb().$disconnect();
});
