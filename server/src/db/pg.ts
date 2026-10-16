// Real pg pools for AWS: TLS to RDS Proxy, signed in with short-lived IAM tokens (no database passwords in the app).
import pg from "pg";
import { Signer } from "@aws-sdk/rds-signer";
import type { PoolFactory, PoolLike, TenantDb } from "./pools.ts";

/** IAM sign-in tokens for RDS Proxy last 15 minutes; a new connection signs a fresh one (signing is local, no call to AWS) */
export function iamPassword(region: string, host: string, port: number, username: string): () => Promise<string> {
  const signer = new Signer({ region, hostname: host, port, username });
  return () => signer.getAuthToken();
}

export function proxyPool(region: string, db: TenantDb, opts: { max: number; idleMs: number }, onError: (e: Error) => void): PoolLike {
  const pool = new pg.Pool({
    host: db.dbHost,
    port: db.dbPort,
    database: db.dbName,
    user: db.dbUser,
    password: iamPassword(region, db.dbHost, db.dbPort, db.dbUser),
    // RDS Proxy presents an Amazon certificate that Node already trusts
    ssl: { rejectUnauthorized: true },
    max: opts.max,
    idleTimeoutMillis: opts.idleMs,
    connectionTimeoutMillis: 5_000,
    // Statements are sent unnamed, so a proxy connection is never pinned to one client
    application_name: "wms-api",
  });
  // A connection that drops while idle must not crash the server
  pool.on("error", onError);
  return pool;
}

export const proxyPoolFactory = (region: string, onError: (e: Error) => void): PoolFactory =>
  (db, opts) => proxyPool(region, db, opts, onError);
