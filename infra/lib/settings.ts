// The two environments. Same code; prod gets a standby database (Multi-AZ), two API tasks and deletion protection.
export type Stage = "staging" | "prod";

export interface Settings {
  stage: Stage;
  /** The image tag to run: the git commit being released (the deploy workflow passes it) */
  release: string;
  dbInstanceType: string;
  apiTasks: { min: number; max: number };
  /** Connections one API task may hold (server/src/db/pools.ts). Tasks × this stays well under RDS Proxy's cap. */
  connectionBudget: number;
  perTenantMax: number;
  /** HTTPS certificate (ACM) for *.<domain>; without one the load balancer serves plain HTTP (staging, before a domain) */
  certificateArn?: string;
  alertEmail?: string;
  /** The product's domain: warehouses at <id>.<domain>, the ops console at ops.<domain> */
  domain?: string;
  /** A verified SES sender for invite emails, e.g. no-reply@<domain>; without one, links are copied by hand */
  mailFrom?: string;
  /** Warehouses whose own NAS copies their nightly backups (an IAM user that may read only those), e.g. ["a3k"] */
  nasTenants: string[];
  /** The product's name on its public page (not chosen yet; "WMS" until it is) */
  productName?: string;
  /** Who gets an email for each "Book a visit" request (defaults to alertEmail) */
  visitEmail?: string;
}

export function settingsFor(stage: string, ctx: (key: string) => string | undefined): Settings {
  if (stage !== "staging" && stage !== "prod") throw new Error(`-c stage=staging or -c stage=prod (got "${stage}")`);
  const release = ctx("release");
  if (!release) throw new Error("-c release=<git commit> is required: it's the server image tag to run");
  const base = { stage, release, certificateArn: ctx("certificateArn"), alertEmail: ctx("alertEmail"), domain: ctx("domain"), mailFrom: ctx("mailFrom"),
    productName: ctx("productName"), visitEmail: ctx("visitEmail") ?? ctx("alertEmail"),
    nasTenants: (ctx("nasTenants") ?? "").split(",").map(x => x.trim()).filter(Boolean), perTenantMax: 3, connectionBudget: 30 } as const;
  return stage === "prod"
    ? { ...base, dbInstanceType: "m7g.large", apiTasks: { min: 2, max: 6 } }
    : { ...base, dbInstanceType: "t4g.medium", apiTasks: { min: 1, max: 2 } };
}
