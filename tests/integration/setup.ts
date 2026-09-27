import { afterAll, beforeEach, vi } from "vitest";

import { getDb } from "@/lib/db";
import { type EmailMessage } from "@/server/email/mailer";

import { outbox } from "./support/outbox";

// Capture outgoing email instead of sending it (every integration test file).
vi.mock("@/server/email/mailer", async () => {
  const { outbox: messages } = await import("./support/outbox");
  return {
    sendEmail: async (message: EmailMessage) => {
      messages.push(message);
    },
  };
});

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

// Isolate tests: start each one from empty tables and an empty outbox.
beforeEach(async () => {
  outbox.length = 0;
  const names = await applicationTables();
  if (names.length > 0) {
    await getDb().$executeRawUnsafe(`TRUNCATE TABLE ${names.join(", ")} RESTART IDENTITY CASCADE`);
  }
});

afterAll(async () => {
  await getDb().$disconnect();
});
