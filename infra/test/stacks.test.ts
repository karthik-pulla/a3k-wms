// Checks the AWS templates keep the rules in docs/multi-tenant-design.md: the API reaches PostgreSQL only through
// RDS Proxy, with TLS and IAM sign-in, under a fixed connection cap; only the migration task goes straight to the instance.
import test from "node:test";
import assert from "node:assert/strict";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ApiStack } from "../lib/api-stack.ts";
import { DataStack } from "../lib/data-stack.ts";
import { settingsFor } from "../lib/settings.ts";

function synth(stage: "staging" | "prod") {
  const app = new App();
  const s = settingsFor(stage, k => ({ release: "test123" } as Record<string, string>)[k]);
  const env = { account: "111111111111", region: "us-east-1" };
  const data = new DataStack(app, "Data", s, { env });
  const api = new ApiStack(app, "Api", s, data, { env });
  return { data: Template.fromStack(data), api: Template.fromStack(api), s };
}
const { data, api } = synth("staging");
const prod = synth("prod");

test("RDS Proxy sits in front of the database, with TLS, IAM sign-in and a connection cap", () => {
  data.resourceCountIs("AWS::RDS::DBProxy", 1);
  data.hasResourceProperties("AWS::RDS::DBProxy", {
    EngineFamily: "POSTGRESQL", RequireTLS: true,
    Auth: [Match.objectLike({ AuthScheme: "SECRETS", IAMAuth: "REQUIRED" })],
  });
  data.hasResourceProperties("AWS::RDS::DBProxyTargetGroup", {
    ConnectionPoolConfigurationInfo: Match.objectLike({ MaxConnectionsPercent: 70, MaxIdleConnectionsPercent: 10, ConnectionBorrowTimeout: 30 }),
  });
});

test("the database is private, encrypted and refuses unencrypted connections", () => {
  data.hasResourceProperties("AWS::RDS::DBInstance", { Engine: "postgres", PubliclyAccessible: false, StorageEncrypted: true, BackupRetentionPeriod: 14 });
  data.hasResourceProperties("AWS::RDS::DBParameterGroup", { Parameters: Match.objectLike({ "rds.force_ssl": "1" }) });
  prod.data.hasResourceProperties("AWS::RDS::DBInstance", { MultiAZ: true, DeletionProtection: true });
});

test("the API is configured with the proxy, never the instance, and a connection budget", () => {
  const defs = api.findResources("AWS::ECS::TaskDefinition");
  const env = Object.values(defs).flatMap((d: any) => d.Properties.ContainerDefinitions.flatMap((c: any) => c.Environment ?? []));
  const names = env.map((e: any) => e.Name);
  assert.ok(names.includes("DB_PROXY_HOST"));
  assert.ok(!names.includes("DB_DIRECT_HOST"), "the API must not know the instance's address");
  assert.ok(!names.some((n: string) => /^DB_.*SECRET|PASSWORD/.test(n)), "the API gets no database logins");
  assert.ok(names.includes("APP_KEY_SECRET_ARN"), "only the app key, as a pointer to Secrets Manager");
  assert.equal(env.find((e: any) => e.Name === "DB_CONNECTION_BUDGET")?.Value, "30");
});

test("the API's role may sign in to the proxy (IAM) as the platform role and tenant logins, nothing broader", () => {
  const policies = Object.values(api.findResources("AWS::IAM::Policy")) as any[];
  const statements = policies.flatMap(p => p.Properties.PolicyDocument.Statement);
  const connect = statements.filter(st => [st.Action].flat().includes("rds-db:connect"));
  assert.equal(connect.length, 1);
  const text = JSON.stringify(connect[0].Resource);
  assert.match(text, /wms_platform/);
  assert.match(text, /t_\*/);
  assert.ok(!statements.some(st => [st.Action].flat().some((a: string) => a === "*" || a.startsWith("rds:"))), "no wider database rights");
});

test("only the proxy and the migration task may reach the instance; the API reaches only the proxy", () => {
  const ingress = Object.values(data.findResources("AWS::EC2::SecurityGroup")).flatMap((g: any) => g.Properties.SecurityGroupIngress ?? []);
  assert.ok(ingress.every((r: any) => r.FromPort === 5432 ? !!r.SourceSecurityGroupId : true), "5432 only from security groups, never an address range");
  const dbRules = Object.values(data.findResources("AWS::EC2::SecurityGroupIngress")) as any[];
  assert.equal(dbRules.filter(r => r.Properties.FromPort === 5432).length, 2, "instance: from the proxy and the migration task");
  api.resourceCountIs("AWS::EC2::SecurityGroupIngress", 2); // API → proxy, load balancer → API
});

test("with a domain: the console at ops.<domain>, HTTPS cookies with a certificate", () => {
  const app = new App();
  const s = settingsFor("staging", k => ({ release: "t", domain: "wms.example", certificateArn: "arn:aws:acm:us-east-1:111111111111:certificate/x" } as Record<string, string>)[k]);
  const env = { account: "111111111111", region: "us-east-1" };
  const d = new DataStack(app, "D2", s, { env });
  const t = Template.fromStack(new ApiStack(app, "A2", s, d, { env }));
  const vars = Object.values(t.findResources("AWS::ECS::TaskDefinition")).flatMap((x: any) => x.Properties.ContainerDefinitions.flatMap((c: any) => c.Environment ?? []));
  assert.equal(vars.find((e: any) => e.Name === "OPS_HOST")?.Value, "ops.wms.example");
  assert.equal(vars.find((e: any) => e.Name === "COOKIE_SECURE")?.Value, "1");
});

test("the API may start only the tenant-creation task, and pass only its roles", () => {
  const statements = (Object.values(api.findResources("AWS::IAM::Policy")) as any[]).flatMap(p => p.Properties.PolicyDocument.Statement);
  const run = statements.find(st => st.Action === "ecs:RunTask");
  assert.ok(run && !JSON.stringify(run.Resource).includes("*"), "RunTask on one task definition");
  const pass = statements.find(st => st.Action === "iam:PassRole");
  assert.ok(pass && Array.isArray(pass.Resource) && pass.Resource.length === 2);
});

test("the migration task goes straight to the instance with the master login", () => {
  const defs = Object.values(data.findResources("AWS::ECS::TaskDefinition")) as any[];
  const migrate = defs.flatMap(d => d.Properties.ContainerDefinitions).find((c: any) => c.Name === "migrate");
  assert.deepEqual(migrate.Command, ["node", "dist/src/migrate/main.js"]);
  const names = migrate.Environment.map((e: any) => e.Name);
  for (const n of ["DB_DIRECT_HOST", "DB_MASTER_SECRET_ARN", "DB_PLATFORM_SECRET_ARN", "DB_PROXY_NAME"]) assert.ok(names.includes(n), n);
});

test("files are private, encrypted and HTTPS-only; images are scanned and can't be overwritten", () => {
  data.hasResourceProperties("AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    BucketEncryption: { ServerSideEncryptionConfiguration: [Match.objectLike({ ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: "aws:kms" }) })] },
  });
  data.hasResourceProperties("AWS::S3::BucketPolicy", { PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Effect: "Deny", Condition: { Bool: { "aws:SecureTransport": "false" } } })]) } });
  data.hasResourceProperties("AWS::ECR::Repository", { ImageTagMutability: "IMMUTABLE", ImageScanningConfiguration: { ScanOnPush: true } });
});

test("there are alarms on the proxy's connections", () => {
  const alarms = Object.values(data.findResources("AWS::CloudWatch::Alarm")) as any[];
  assert.ok(alarms.some(a => JSON.stringify(a).includes("MaxDatabaseConnectionsAllowed")));
  assert.ok(alarms.some(a => JSON.stringify(a).includes("DatabaseConnectionsBorrowLatency")));
});

test("a release must be named; the stage must be staging or prod", () => {
  assert.throws(() => settingsFor("staging", () => undefined), /release/);
  assert.throws(() => settingsFor("dev", () => "x"), /stage/);
});
