import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Read directly (not via `env()`) so `prisma generate` works without a
    // database URL, e.g. on a fresh clone or in CI. Commands that connect
    // (migrate, studio) fail with a clear error if it is missing.
    url: process.env.DATABASE_URL,
  },
});
