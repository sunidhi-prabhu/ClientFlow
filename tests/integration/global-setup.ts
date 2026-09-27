import { execFileSync } from "node:child_process";
import path from "node:path";

import pg from "pg";

import { getTestDatabaseUrl } from "./database-url";

/** Create the test database if it does not exist (independent of Docker init scripts). */
async function ensureDatabaseExists(databaseUrl: string) {
  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.slice(1));

  // Connect to the server's maintenance database to issue CREATE DATABASE.
  const maintenance = new URL(databaseUrl);
  maintenance.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenance.href });

  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      databaseName,
    ]);
    if (rowCount === 0) {
      const quoted = `"${databaseName.replaceAll('"', '""')}"`;
      await client.query(`CREATE DATABASE ${quoted}`);
    }
  } finally {
    await client.end();
  }
}

function applyMigrations(databaseUrl: string) {
  const prismaBin = path.resolve("node_modules/.bin/prisma");
  execFileSync(prismaBin, ["migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}

export default async function setup() {
  const databaseUrl = getTestDatabaseUrl();
  await ensureDatabaseExists(databaseUrl);
  applyMigrations(databaseUrl);
}
