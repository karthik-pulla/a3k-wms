// The WMS team's very first console account, as a one-off ECS task (nobody exists yet to invite them):
//   node dist/src/ops/firstOperator.js --name "Sam" --username sam --email sam@example.com --ops-url https://ops.example.com
// Prints an invite link (7 days): open it, choose a password, connect an authenticator app. After that, invite the rest
// of the team from the console. It refuses to run once the team has anyone.
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { migrateConfig } from "../config.ts";
import { OPS_TABLES } from "../core/auth.ts";
import { singleConnectionDb } from "../core/db.ts";
import { firstOperator, opsLog } from "../core/ops-api.ts";
import { directConnector, getLogin } from "./aws.ts";

async function main() {
  const { values } = parseArgs({ options: { name: { type: "string" }, username: { type: "string" }, email: { type: "string" }, "ops-url": { type: "string" } } });
  if (!values.name || !values.username || !values.email || !values["ops-url"]) throw new Error("Give --name, --username, --email and --ops-url");
  const cfg = migrateConfig();
  const conn = await directConnector(cfg.directHost, cfg.directPort, await getLogin(cfg.region, cfg.masterSecretArn))(cfg.platformDb);
  try {
    const db = singleConnectionDb(conn);
    const link = await firstOperator({ db, tables: OPS_TABLES, appKey: new Uint8Array(32), now: Date.now, issuer: "WMS console", ownWords: [], log: opsLog() }, db,
      { name: values.name, username: values.username, email: values.email, baseUrl: values["ops-url"].replace(/\/+$/, "") });
    console.log(JSON.stringify({ ok: true, inviteLink: link }, null, 2));
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
