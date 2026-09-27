import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Lints snippets as if they lived at the given path, using the real config.
const eslint = new ESLint({ cwd: process.cwd() });

async function restrictedImportErrors(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter(
    (message) => message.ruleId === "@typescript-eslint/no-restricted-imports",
  );
}

const RAW_DB_IMPORT = `import { getDb } from "@/lib/db";\nexport const db = getDb();\n`;

describe("database import boundaries", () => {
  it.each([
    "src/app/(app)/page.tsx",
    "src/app/api/example/route.ts",
    "src/app/actions.ts",
    "src/components/example.tsx",
    "src/server/clients/service.ts",
    // Only the bootstrap file is allowlisted, not the whole organizations module.
    "src/server/organizations/settings.ts",
    "src/server/protected.ts",
    "src/lib/permissions.ts",
  ])("forbids the unscoped client in %s", async (filePath) => {
    expect(await restrictedImportErrors(RAW_DB_IMPORT, filePath)).toHaveLength(1);
  });

  it("forbids relative imports of the unscoped client", async () => {
    const code = `import { getDb } from "../../lib/db";\nexport const db = getDb();\n`;
    expect(await restrictedImportErrors(code, "src/app/api/example/route.ts")).toHaveLength(1);
  });

  it.each([
    "src/server/tenancy/tenant-db.ts",
    "src/server/tenancy/context.ts",
    "src/server/health.ts",
    "src/server/auth/auth.ts",
    "src/server/organizations/bootstrap.ts",
  ])("allows the unscoped client in infrastructure module %s", async (filePath) => {
    expect(await restrictedImportErrors(RAW_DB_IMPORT, filePath)).toHaveLength(0);
  });

  it("forbids constructing a second Prisma client anywhere outside lib/db", async () => {
    const code = `import { PrismaClient } from "@/generated/prisma/client";\nexport const c = PrismaClient;\n`;
    expect(await restrictedImportErrors(code, "src/server/tenancy/tenant-db.ts")).toHaveLength(1);
    expect(await restrictedImportErrors(code, "src/app/api/example/route.ts")).toHaveLength(1);
  });

  it("still allows generated types and the tenant client", async () => {
    const code = [
      `import type { PrismaClient, Client } from "@/generated/prisma/client";`,
      `import { getTenantDb } from "@/server/tenancy";`,
      `export type T = [PrismaClient, Client, typeof getTenantDb];`,
      ``,
    ].join("\n");
    expect(await restrictedImportErrors(code, "src/app/api/example/route.ts")).toHaveLength(0);
  });
});
