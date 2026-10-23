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

test("every night, each warehouse is backed up on its own; old backups go after 35 days; a failed night emails the team", () => {
  data.hasResourceProperties("AWS::Events::Rule", { ScheduleExpression: "cron(0 8 * * ? *)", State: "ENABLED" });
  data.hasResourceProperties("AWS::ECS::TaskDefinition", { ContainerDefinitions: [Match.objectLike({ Command: ["node", "dist/src/ops/backup.js"] })] });
  data.hasResourceProperties("AWS::S3::Bucket", { LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ Id: "backups", ExpirationInDays: 35, TagFilters: [{ Key: "wms-kind", Value: "backup" }] })]) } });
  data.hasResourceProperties("AWS::Events::Rule", { EventPattern: Match.objectLike({ "detail-type": ["ECS Task State Change"], detail: Match.objectLike({ lastStatus: ["STOPPED"] }) }) });
  // The backup may write backups only, and encrypt only with the warehouses' own keys and the platform's
  const policies = JSON.stringify(data.findResources("AWS::IAM::Policy", { Properties: { Roles: [{ Ref: Match.stringLikeRegexp("BackupRole") }] } }));
  assert.match(policies, /tenants\/\*\/backups\/\*/);
  assert.match(policies, /alias\/wms\/staging\/tenant\/\*/);
  assert.doesNotMatch(policies, /s3:GetObject|s3:DeleteObject/);
  // No NAS user unless one is asked for
  data.resourceCountIs("AWS::IAM::User", 0);
});

test("the restore task may read backups and decrypt them with the warehouses' keys, and write nothing to the bucket", () => {
  data.hasResourceProperties("AWS::ECS::TaskDefinition", { ContainerDefinitions: [Match.objectLike({ Name: "restore", Command: ["node", "dist/src/ops/restore.js"] })] });
  const statements = (Object.values(data.findResources("AWS::IAM::Policy", { Properties: { Roles: [{ Ref: Match.stringLikeRegexp("RestoreRole") }] } })) as any[])
    .flatMap(p => p.Properties.PolicyDocument.Statement);
  const get = statements.find(st => st.Action === "s3:GetObject");
  assert.ok(get, "s3:GetObject");
  assert.match(JSON.stringify(get.Resource), /tenants\/\*\/backups\/\*/);
  assert.doesNotMatch(JSON.stringify(get.Resource), /platform\/backups|inbound/);
  const decrypt = statements.find(st => st.Action === "kms:Decrypt" && st.Condition);
  assert.deepEqual(decrypt.Condition, { "ForAnyValue:StringLike": { "kms:ResourceAliases": "alias/wms/staging/tenant/*" } });
  const text = JSON.stringify(statements);
  assert.doesNotMatch(text, /s3:PutObject|s3:DeleteObject|kms:Encrypt|kms:GenerateDataKey"/);
  // Reaches the instance the same way the migration and backup tasks do (no new way in)
  const defs = Object.values(data.findResources("AWS::ECS::TaskDefinition")) as any[];
  const env = defs.flatMap(d => d.Properties.ContainerDefinitions).find((c: any) => c.Name === "restore").Environment.map((e: any) => e.Name);
  for (const n of ["DB_DIRECT_HOST", "DB_MASTER_SECRET_ARN", "FILES_BUCKET"]) assert.ok(env.includes(n), n);
});

test("a warehouse's NAS user may read that warehouse's backups and nothing else", () => {
  const app = new App();
  const s = settingsFor("prod", k => ({ release: "test123", nasTenants: "a3k" } as Record<string, string>)[k]);
  const t = Template.fromStack(new DataStack(app, "DataNas", s, { env: { account: "111111111111", region: "us-east-1" } }));
  t.resourceCountIs("AWS::IAM::User", 1);
  const policy = JSON.stringify(t.findResources("AWS::IAM::Policy", { Properties: { Users: [{ Ref: Match.stringLikeRegexp("Nasa3k") }] } }));
  assert.match(policy, /tenants\/a3k\/backups\/\*/);
  assert.match(policy, /alias\/wms\/prod\/tenant\/a3k"/);
  assert.doesNotMatch(policy, /s3:PutObject|s3:DeleteObject|tenants\/\*/);
});

test("with a domain, order emails come in through SES to a queue the API reads; without one, nothing is set up", () => {
  data.resourceCountIs("AWS::SES::ReceiptRuleSet", 0);
  const app = new App();
  const s = settingsFor("staging", k => ({ release: "test123", domain: "wms.example" } as Record<string, string>)[k]);
  const env = { account: "111111111111", region: "us-east-1" };
  const d = new DataStack(app, "DataMail", s, { env });
  const a = Template.fromStack(new ApiStack(app, "ApiMail", s, d, { env }));
  const t = Template.fromStack(d);
  t.hasResourceProperties("AWS::SES::ReceiptRule", { Rule: Match.objectLike({ Recipients: ["orders.wms.example"], ScanEnabled: true, Actions: [Match.objectLike({ S3Action: Match.objectLike({ ObjectKeyPrefix: "inbound/" }) })] }) });
  t.hasResourceProperties("AWS::SQS::Queue", { RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }) });
  t.hasResourceProperties("AWS::SNS::Subscription", { Protocol: "sqs", RawMessageDelivery: true });
  const apiEnv = JSON.stringify(a.findResources("AWS::ECS::TaskDefinition"));
  assert.match(apiEnv, /"ORDERS_DOMAIN","Value":"orders\.wms\.example"/);
  assert.match(apiEnv, /INBOUND_QUEUE_URL/);
  const apiPolicy = JSON.stringify(a.findResources("AWS::IAM::Policy"));
  assert.match(apiPolicy, /inbound\/\*/);
});

test("CloudFront keeps the app's hashed files for a year and never caches pages or the APIs", () => {
  const CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad", ALL_VIEWER = "216adef6-5c7f-47e4-b989-5492eafa07d3";
  const app = new App();
  const s = settingsFor("staging", k => ({ release: "t", domain: "wms.example", certificateArn: "arn:aws:acm:us-east-1:111111111111:certificate/x" } as Record<string, string>)[k]);
  const env = { account: "111111111111", region: "us-east-1" };
  const t = Template.fromStack(new ApiStack(app, "ACdn", s, new DataStack(app, "DCdn", s, { env }), { env }));
  t.resourceCountIs("AWS::CloudFront::Distribution", 1);
  const dist = (Object.values(t.findResources("AWS::CloudFront::Distribution"))[0] as any).Properties.DistributionConfig;
  assert.equal(dist.HttpVersion, "http2and3");
  // Every warehouse's address, the console and the public page, on the us-east-1 certificate
  assert.deepEqual(dist.Aliases, ["wms.example", "www.wms.example", "*.wms.example"]);
  assert.equal(dist.ViewerCertificate.AcmCertificateArn, "arn:aws:acm:us-east-1:111111111111:certificate/x");
  assert.equal(dist.ViewerCertificate.SslSupportMethod, "sni-only");
  // The load balancer is reached over HTTPS when there's a certificate
  assert.equal(dist.Origins[0].CustomOriginConfig.OriginProtocolPolicy, "https-only");

  // Pages (the default) and the three APIs: not cached; Host, cookies and query strings all reach the API
  const byPath = Object.fromEntries((dist.CacheBehaviors as any[]).map(b => [b.PathPattern, b]));
  for (const b of [dist.DefaultCacheBehavior, byPath["/api/*"], byPath["/ops/api/*"], byPath["/portal/api/*"]]) {
    assert.ok(b, "behavior");
    assert.equal(b.CachePolicyId, CACHING_DISABLED);
    assert.equal(b.OriginRequestPolicyId, ALL_VIEWER);
    assert.ok(b.AllowedMethods.includes("POST"));
    assert.equal(b.ViewerProtocolPolicy, "redirect-to-https");
  }

  // /assets/* (scripts, styles, fonts): cached as long as the server says, up to a year, compressed, keyed by Host only
  const assets = byPath["/assets/*"];
  assert.equal(assets.Compress, true);
  assert.deepEqual(assets.AllowedMethods, ["GET", "HEAD"]);
  assert.deepEqual(assets.CachePolicyId, { Ref: Object.keys(t.findResources("AWS::CloudFront::CachePolicy"))[0] });
  t.hasResourceProperties("AWS::CloudFront::CachePolicy", { CachePolicyConfig: Match.objectLike({
    MinTTL: 0, MaxTTL: 31536000,
    ParametersInCacheKeyAndForwardedToOrigin: {
      EnableAcceptEncodingGzip: true, EnableAcceptEncodingBrotli: true,
      HeadersConfig: { HeaderBehavior: "whitelist", Headers: ["Host"] },
      CookiesConfig: { CookieBehavior: "none" }, QueryStringsConfig: { QueryStringBehavior: "none" },
    },
  }) });
  // Only /assets/ is cached: nothing else gets a cache policy of its own
  assert.deepEqual(Object.keys(byPath).sort(), ["/api/*", "/assets/*", "/ops/api/*", "/portal/api/*"]);
});

test("without a domain CloudFront answers at its own address; a certificate outside us-east-1 needs its own CloudFront one", () => {
  const dist = (Object.values(api.findResources("AWS::CloudFront::Distribution"))[0] as any).Properties.DistributionConfig;
  assert.equal(dist.Aliases, undefined);
  assert.equal(dist.Origins[0].CustomOriginConfig.OriginProtocolPolicy, "http-only");
  const ctx = (extra: Record<string, string>) => (k: string) => ({ release: "t", domain: "wms.example", ...extra } as Record<string, string>)[k];
  assert.throws(() => settingsFor("prod", ctx({ certificateArn: "arn:aws:acm:eu-west-1:111111111111:certificate/x" })), /us-east-1/);
  const s = settingsFor("prod", ctx({ certificateArn: "arn:aws:acm:eu-west-1:111111111111:certificate/x", cdnCertificateArn: "arn:aws:acm:us-east-1:111111111111:certificate/y" }));
  assert.equal(s.cdnCertificateArn, "arn:aws:acm:us-east-1:111111111111:certificate/y");
});
