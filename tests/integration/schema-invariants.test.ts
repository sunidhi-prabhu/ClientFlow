import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

/**
 * Guards the schema rules from CLAUDE.md for every current and future model,
 * by inspecting the migrated database rather than trusting the checklist.
 */
describe("tenancy schema invariants", () => {
  it("every foreign key between tenant-owned tables includes organizationId on both sides", async () => {
    const violations = await getDb().$queryRaw<{ constraint: string }[]>`
      WITH tenant_tables AS (
        SELECT c.table_name FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.column_name = 'organizationId'
      ),
      fks AS (
        SELECT con.conname, src.relname AS source, dst.relname AS target,
          ARRAY(SELECT attname FROM pg_attribute
                WHERE attrelid = con.conrelid AND attnum = ANY (con.conkey)) AS source_columns,
          ARRAY(SELECT attname FROM pg_attribute
                WHERE attrelid = con.confrelid AND attnum = ANY (con.confkey)) AS target_columns
        FROM pg_constraint con
        JOIN pg_class src ON src.oid = con.conrelid
        JOIN pg_class dst ON dst.oid = con.confrelid
        JOIN pg_namespace ns ON ns.oid = src.relnamespace
        WHERE con.contype = 'f' AND ns.nspname = 'public'
      )
      SELECT conname AS constraint FROM fks
      WHERE source IN (SELECT table_name FROM tenant_tables)
        AND target IN (SELECT table_name FROM tenant_tables)
        AND NOT ('organizationId' = ANY (source_columns) AND 'organizationId' = ANY (target_columns))`;

    expect(violations).toEqual([]);
  });

  it("every tenant-owned table has a non-null organizationId and a unique (organizationId, id)", async () => {
    const tables = await getDb().$queryRaw<{ table: string; nullable: string; unique: boolean }[]>`
      SELECT c.table_name AS table, c.is_nullable AS nullable,
        EXISTS (
          SELECT 1 FROM pg_index i
          JOIN pg_class t ON t.oid = i.indrelid
          WHERE t.relname = c.table_name AND i.indisunique
            AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum)
                = ARRAY['organizationId', 'id']
        ) AS unique
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name = 'organizationId'
      ORDER BY c.table_name`;

    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table).toEqual({ table: table.table, nullable: "NO", unique: true });
    }
  });

  // toAppError classifies P2003 by comparing the failing model with the
  // constraint's table prefix; these two tests keep that assumption true.
  it("every table is named after its Prisma model (no @@map)", async () => {
    const tables = await getDb().$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    expect(tables.map(({ tablename }) => tablename).sort()).toEqual(
      Object.values(Prisma.ModelName).sort(),
    );
  });

  it("every foreign key is named <Table>_..._fkey after the table that owns it", async () => {
    const misnamed = await getDb().$queryRaw<{ constraint: string }[]>`
      SELECT con.conname AS constraint
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = src.relnamespace
      WHERE con.contype = 'f' AND ns.nspname = 'public'
        AND NOT (con.conname LIKE src.relname || '\_%\_fkey')`;
    expect(misnamed).toEqual([]);
  });
});
