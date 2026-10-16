// Shared by the one-off tasks (migration loop, tenant creation): logins from Secrets Manager and direct connections
// to the database instance. These tasks run inside the VPC on ECS; nothing here runs on anyone's computer.
import pg from "pg";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { Conn } from "../migrate/runner.ts";

export interface Login { username: string; password: string }

export async function getLogin(region: string, secretArn: string): Promise<Login> {
  const sm = new SecretsManagerClient({ region });
  const out = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const v = JSON.parse(out.SecretString ?? "{}") as Partial<Login>;
  if (!v.username || !v.password) throw new Error(`Secret ${secretArn} has no username and password`);
  return { username: v.username, password: v.password };
}

/**
 * A connection straight to the instance (not the proxy), as the master login. The instance's certificate is signed by
 * the RDS certificate authority, which the container trusts through NODE_EXTRA_CA_CERTS (server/Dockerfile).
 */
export function directConnector(host: string, port: number, login: Login) {
  return async (database: string): Promise<Conn> => {
    const c = new pg.Client({ host, port, database, user: login.username, password: login.password, ssl: { rejectUnauthorized: true }, application_name: "wms-migrate" });
    await c.connect();
    return { query: (text, values) => c.query(text, values as unknown[]), end: () => c.end() };
  };
}

export const ident = (s: string) => pg.escapeIdentifier(s);
export const literal = (s: string) => pg.escapeLiteral(s);
