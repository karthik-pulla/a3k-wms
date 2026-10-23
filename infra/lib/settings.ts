// The two environments. Same code; prod gets two API tasks and deletion protection. The database's size and its standby
// copy (Multi-AZ) are settings (WMS_DB_SIZE, WMS_DB_STANDBY), so growing is a change of setting and a deploy, not of code.
// Owner's plan (23 Oct 2026): start prod small with no standby while there are up to 5 warehouses; scale up later.
export type Stage = "staging" | "prod";

export interface Settings {
  stage: Stage;
  /** The image tag to run: the git commit being released (the deploy workflow passes it) */
  release: string;
  /** RDS instance class without "db.", e.g. "t4g.large" */
  dbInstanceType: string;
  /** A standby copy of the database in a second zone that takes over by itself if the main one fails (Multi-AZ) */
  dbStandby: boolean;
  apiTasks: { min: number; max: number };
  /** Connections one API task may hold (server/src/db/pools.ts). Tasks × this stays well under RDS Proxy's cap. */
  connectionBudget: number;
  perTenantMax: number;
  /** HTTPS certificate (ACM) for *.<domain>; without one the load balancer serves plain HTTP (staging, before a domain) */
  certificateArn?: string;
  /** The same kind of certificate for CloudFront, which only takes ones in us-east-1. Defaults to certificateArn (the
   *  usual case: the stacks run in us-east-1); a stack in another region needs its own one here. */
  cdnCertificateArn?: string;
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
  const cdnCertificateArn = ctx("cdnCertificateArn") ?? ctx("certificateArn");
  if (cdnCertificateArn && cdnCertificateArn.split(":")[3] !== "us-east-1")
    throw new Error(`CloudFront needs its certificate in us-east-1 (got ${cdnCertificateArn}): set -c cdnCertificateArn (WMS_CDN_CERTIFICATE_ARN)`);
  const dbSize = ctx("dbSize");
  if (dbSize !== undefined && !/^[a-z][a-z0-9-]*\.[a-z0-9]+$/.test(dbSize)) throw new Error(`-c dbSize is an instance class like t4g.large or m7g.large (got "${dbSize}")`);
  const standby = ctx("dbStandby");
  if (standby !== undefined && standby !== "true" && standby !== "false") throw new Error(`-c dbStandby is true or false (got "${standby}")`);
  const base = { stage, release, certificateArn: ctx("certificateArn"), cdnCertificateArn, alertEmail: ctx("alertEmail"), domain: ctx("domain"), mailFrom: ctx("mailFrom"),
    productName: ctx("productName"), visitEmail: ctx("visitEmail") ?? ctx("alertEmail"),
    nasTenants: (ctx("nasTenants") ?? "").split(",").map(x => x.trim()).filter(Boolean), perTenantMax: 3, connectionBudget: 30 } as const;
  // Defaults: a small database with no standby (up to ~5 warehouses); scaling up, e.g. m7g.large with a standby, is a setting
  return stage === "prod"
    ? { ...base, dbInstanceType: dbSize ?? "t4g.large", dbStandby: standby === "true", apiTasks: { min: 2, max: 6 } }
    : { ...base, dbInstanceType: dbSize ?? "t4g.medium", dbStandby: standby === "true", apiTasks: { min: 1, max: 2 } };
}
