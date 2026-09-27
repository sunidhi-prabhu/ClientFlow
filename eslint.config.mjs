import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

/**
 * Server-only infrastructure allowed to use the unscoped client from
 * `@/lib/db`. Everything else must use `getTenantDb()` from
 * `@/server/tenancy`. Add auth/bootstrap modules here when they exist, and
 * only if they genuinely need cross-organization access.
 */
const RAW_DB_ALLOWED = ["src/server/tenancy/**/*.ts", "src/server/health.ts"];

function databaseImportRules({ allowRawDb }) {
  return {
    paths: [
      {
        name: "@/generated/prisma/client",
        importNames: ["PrismaClient"],
        allowTypeImports: true,
        message: "Do not construct Prisma clients. Use getTenantDb() from '@/server/tenancy'.",
      },
    ],
    patterns: [
      {
        group: ["@prisma/client", "@prisma/client/*", "@/generated/prisma/internal/*"],
        message: "Import generated types from '@/generated/prisma/client'.",
      },
      ...(allowRawDb
        ? []
        : [
            {
              regex: "(^|/)lib/db$",
              message:
                "The unscoped database client bypasses tenant isolation. Use getTenantDb() from '@/server/tenancy'.",
            },
          ]),
    ],
  };
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
  // Database access boundaries. See CLAUDE.md "Multi-tenancy & security".
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        databaseImportRules({ allowRawDb: false }),
      ],
    },
  },
  {
    files: RAW_DB_ALLOWED,
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        databaseImportRules({ allowRawDb: true }),
      ],
    },
  },
  {
    // The one place that constructs the Prisma client.
    files: ["src/lib/db.ts"],
    rules: { "@typescript-eslint/no-restricted-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
]);

export default eslintConfig;
