// Reads the numbered SQL files of one kind (platform or tenant) in the order they run.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MigrationFile } from "./runner.ts";

export function readMigrations(dir: string): MigrationFile[] {
  const names = readdirSync(dir).filter(n => n.endsWith(".sql")).sort();
  const files = names.map(name => {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name)) throw new Error(`${name}: migration files are named like 0001_what_it_does.sql`);
    const sql = readFileSync(join(dir, name), "utf8").replace(/\r\n/g, "\n");
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex"), noTransaction: /^--\s*no-transaction\b/.test(sql) };
  });
  const numbers = files.map(f => f.name.slice(0, 4));
  if (new Set(numbers).size !== numbers.length) throw new Error(`${dir}: two migration files have the same number`);
  return files;
}
