// What the sign-in logic needs from a database: the server gives it a tenant's pool through RDS Proxy
// (server/src/db/pools.ts); the app's preview and the tests give it PGlite, an in-memory PostgreSQL.

export interface Sql {
  query<T = any>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

/** A database, and a way to run several statements as one transaction on one connection */
export interface Db extends Sql {
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
}

/** Runs fn in a transaction on a single-connection database (PGlite) */
export function singleConnectionDb(q: Sql): Db {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    query: (t, v) => q.query(t, v),
    tx: <T,>(fn: (q: Sql) => Promise<T>) => {
      // One transaction at a time on one connection
      const run = chain.then(async () => {
        await q.query("BEGIN");
        try { const r = await fn(q); await q.query("COMMIT"); return r; } catch (e) { await q.query("ROLLBACK"); throw e; }
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}
