// A throwaway PostgreSQL for tests: PGlite (PostgreSQL compiled to WebAssembly) inside the test process, in memory.
// Nothing is installed or left running; each test gets a fresh database with the real migration files applied.
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Db, Sql } from "../src/core/db.ts";
import { singleConnectionDb } from "../src/core/db.ts";
import { readMigrations } from "../src/migrate/files.ts";
import { migrateDatabase, type Conn } from "../src/migrate/runner.ts";
import { migrationsDir } from "../src/migrate/main.ts";

/** Plain statements go through the extended protocol; whole migration files (several statements) through exec */
export function pgliteSql(pg: PGlite): Sql & Conn {
  return {
    query: async (text: string, values?: unknown[]) => {
      if (values?.length) return { rows: (await pg.query(text, values)).rows as any[] };
      const results = await pg.exec(text);
      return { rows: (results.at(-1)?.rows ?? []) as any[] };
    },
    end: async () => {},
  };
}

export async function freshDb(kind: "tenant" | "platform"): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite();
  const sql = pgliteSql(pg);
  // The platform migrations grant to the API's role, which the migration task creates first on AWS
  if (kind === "platform") await sql.query("CREATE ROLE wms_platform");
  if (kind === "platform") await migrateDatabase(sql, readMigrations(join(migrationsDir(), "platform")));
  else await migrateDatabase(sql, readMigrations(join(migrationsDir(), "tenant")));
  return { db: singleConnectionDb(sql), pg };
}
