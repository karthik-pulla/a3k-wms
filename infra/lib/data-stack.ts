// Everything that holds data, and the migration task (docs/multi-tenant-design.md, section 2):
// network, one PostgreSQL instance with a database per tenant, RDS Proxy in front of it from day one, the files bucket,
// the platform KMS key, the image repository, and the one-off task that runs the migration loop and creates tenants.
// Deployed before the API stack on every release, so migrations run before new API code serves anyone.
import { ArnFormat, CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";
import type { Settings } from "./settings.ts";

export class DataStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly cluster: ecs.Cluster;
  readonly repo: ecr.Repository;
  readonly proxy: rds.DatabaseProxy;
  readonly proxySg: ec2.SecurityGroup;
  readonly files: s3.Bucket;
  readonly platformKey: kms.Key;
  readonly alerts: sns.Topic;
  /** The one-off task (migration loop, tenant creation): the console starts it to create a warehouse */
  readonly opsTask: ecs.FargateTaskDefinition;
  readonly opsSg: ec2.SecurityGroup;
  /** The server's app key: seals authenticator secrets in every database */
  readonly appKey: secretsmanager.Secret;
  /** Order emails waiting to be put in their warehouse's inbox (only with a domain) */
  readonly inboundQueue?: sqs.Queue;

  constructor(scope: Construct, id: string, s: Settings, props?: StackProps) {
    super(scope, id, props);
    const prod = s.stage === "prod";
    const keep = prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // ---------- Network: public (load balancer), app (API and tasks, out through one NAT), db (no internet at all) ----------
    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "app", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: "db", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    const dbSubnets = { subnetType: ec2.SubnetType.PRIVATE_ISOLATED };

    this.platformKey = new kms.Key(this, "PlatformKey", {
      alias: `wms/${s.stage}/platform`, enableKeyRotation: true, removalPolicy: RemovalPolicy.RETAIN,
      description: `WMS ${s.stage}: database storage, logins and the platform's files (each tenant has its own key too)`,
    });

    this.alerts = new sns.Topic(this, "Alerts", { displayName: `WMS ${s.stage} alerts` });
    if (s.alertEmail) this.alerts.addSubscription(new subs.EmailSubscription(s.alertEmail));

    // ---------- Who may talk to whom: API → proxy → database; the one-off tasks → database directly ----------
    this.proxySg = new ec2.SecurityGroup(this, "ProxySg", { vpc: this.vpc, description: "RDS Proxy: from the API only", allowAllOutbound: false });
    const dbSg = new ec2.SecurityGroup(this, "DbSg", { vpc: this.vpc, description: "PostgreSQL: from RDS Proxy and the migration task only", allowAllOutbound: false });
    const opsSg = new ec2.SecurityGroup(this, "OpsSg", { vpc: this.vpc, description: "Migration and tenant-creation tasks" });
    this.opsSg = opsSg;
    dbSg.addIngressRule(this.proxySg, ec2.Port.tcp(5432), "RDS Proxy");
    dbSg.addIngressRule(opsSg, ec2.Port.tcp(5432), "Migration loop and tenant creation (straight to the instance)");
    this.proxySg.addEgressRule(dbSg, ec2.Port.tcp(5432), "To the instance");

    // ---------- PostgreSQL: one instance, a database per tenant ----------
    const engine = rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 });
    const params = new rds.ParameterGroup(this, "Params", {
      engine,
      parameters: {
        "rds.force_ssl": "1", // no unencrypted connections, even inside the VPC
        "log_min_duration_statement": "1000", // statements slower than 1 s are logged
        "idle_session_timeout": "3600000", // a forgotten connection is closed after an hour
      },
    });
    const db = new rds.DatabaseInstance(this, "Db", {
      engine,
      instanceType: new ec2.InstanceType(s.dbInstanceType),
      vpc: this.vpc, vpcSubnets: dbSubnets, securityGroups: [dbSg],
      credentials: rds.Credentials.fromGeneratedSecret("wmsadmin", { secretName: `wms/${s.stage}/db/master`, encryptionKey: this.platformKey }),
      storageEncrypted: true, storageEncryptionKey: this.platformKey,
      allocatedStorage: 50, maxAllocatedStorage: 500, storageType: rds.StorageType.GP3,
      multiAz: prod,
      parameterGroup: params,
      caCertificate: rds.CaCertificate.RDS_CA_RSA2048_G1,
      backupRetention: Duration.days(14),
      preferredBackupWindow: "05:00-05:45", // ≈ 1 am US Eastern
      preferredMaintenanceWindow: "Sun:07:00-Sun:08:00", // ≈ 3 am Sunday US Eastern
      autoMinorVersionUpgrade: true,
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
      enablePerformanceInsights: true,
      performanceInsightEncryptionKey: this.platformKey,
      deletionProtection: prod,
      removalPolicy: prod ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
    });

    // The API's login to the platform database (wms_platform). The migration task sets this password on the role.
    const platformLogin = new secretsmanager.Secret(this, "PlatformLogin", {
      secretName: `wms/${s.stage}/db/wms_platform`, encryptionKey: this.platformKey,
      description: "RDS Proxy's login for the platform database role (the API itself signs in to the proxy with IAM)",
      generateSecretString: { secretStringTemplate: JSON.stringify({ username: "wms_platform" }), generateStringKey: "password", excludePunctuation: true, passwordLength: 40 },
    });

    // The key that seals authenticator secrets (server/src/core/crypto.ts); only the API reads it
    this.appKey = new secretsmanager.Secret(this, "AppKey", {
      secretName: `wms/${s.stage}/app-key`, encryptionKey: this.platformKey,
      description: "WMS server: seals the authenticator-app secrets of every account. Never rotate without re-sealing them.",
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ---------- RDS Proxy, from day one (docs: "Connections and RDS Proxy") ----------
    // Tenant logins (wms/<stage>/db/t_*) are added to it by tenant creation; its role may read all of them.
    const proxyRole = new iam.Role(this, "ProxyRole", { assumedBy: new iam.ServicePrincipal("rds.amazonaws.com") });
    proxyRole.addToPolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      resources: [platformLogin.secretArn, this.formatArn({ service: "secretsmanager", resource: "secret", resourceName: `wms/${s.stage}/db/t_*`, arnFormat: ArnFormat.COLON_RESOURCE_NAME })],
    }));
    this.platformKey.grantDecrypt(proxyRole);
    this.proxy = new rds.DatabaseProxy(this, "Proxy", {
      dbProxyName: `wms-${s.stage}`,
      proxyTarget: rds.ProxyTarget.fromInstance(db),
      secrets: [platformLogin],
      role: proxyRole,
      vpc: this.vpc, vpcSubnets: dbSubnets, securityGroups: [this.proxySg],
      iamAuth: true, // clients sign in with IAM tokens; no database passwords in the app
      requireTLS: true,
      maxConnectionsPercent: 70, // the most the database ever sees from the proxy, whatever the app does
      maxIdleConnectionsPercent: 10, // quiet tenants cost nothing
      borrowTimeout: Duration.seconds(30), // when the cap is reached, requests wait instead of the database falling over
      idleClientTimeout: Duration.minutes(30),
      debugLogging: false,
    });

    // ---------- Files: photos, logos, PDFs, exports, nightly dumps, under tenants/<id>/ ----------
    this.files = new s3.Bucket(this, "Files", {
      encryption: s3.BucketEncryption.KMS, encryptionKey: this.platformKey, bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, enforceSSL: true, versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [
        { noncurrentVersionExpiration: Duration.days(30) },
        // Nightly backups (server/src/ops/backup.ts) are kept 35 days
        { id: "backups", tagFilters: { "wms-kind": "backup" }, expiration: Duration.days(35) },
        // Order emails as SES received them: deleted once delivered; anything stuck goes after a week
        { id: "inbound", prefix: "inbound/", expiration: Duration.days(7) },
      ],
      removalPolicy: keep, autoDeleteObjects: !prod,
    });

    // ---------- The server image (built and pushed by the deploy workflow, tagged with the release) ----------
    this.repo = new ecr.Repository(this, "Repo", {
      repositoryName: `wms-server-${s.stage}`, imageScanOnPush: true, imageTagMutability: ecr.TagMutability.IMMUTABLE,
      lifecycleRules: [{ maxImageCount: 30 }], removalPolicy: keep, emptyOnDelete: !prod,
    });
    this.cluster = new ecs.Cluster(this, "Cluster", { vpc: this.vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });

    // ---------- One-off task: the migration loop (default) and tenant creation (command override) ----------
    const opsRole = new iam.Role(this, "OpsRole", { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"), description: "Migration loop and tenant creation" });
    db.secret!.grantRead(opsRole);
    platformLogin.grantRead(opsRole);
    opsRole.addToPolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:CreateSecret", "secretsmanager:TagResource"],
      resources: [this.formatArn({ service: "secretsmanager", resource: "secret", resourceName: `wms/${s.stage}/db/t_*`, arnFormat: ArnFormat.COLON_RESOURCE_NAME })],
    }));
    opsRole.addToPolicy(new iam.PolicyStatement({ actions: ["rds:DescribeDBProxies", "rds:ModifyDBProxy"], resources: [this.proxy.dbProxyArn] }));
    opsRole.addToPolicy(new iam.PolicyStatement({ actions: ["kms:CreateKey", "kms:TagResource"], resources: ["*"] }));
    opsRole.addToPolicy(new iam.PolicyStatement({
      actions: ["kms:CreateAlias"],
      resources: [this.formatArn({ service: "kms", resource: "alias", resourceName: `wms/${s.stage}/tenant/*` }), this.formatArn({ service: "kms", resource: "key", resourceName: "*" })],
    }));
    this.platformKey.grantEncryptDecrypt(opsRole);

    const migrate = new ecs.FargateTaskDefinition(this, "MigrateTask", { cpu: 256, memoryLimitMiB: 512, taskRole: opsRole });
    this.opsTask = migrate;
    migrate.addContainer("migrate", {
      image: ecs.ContainerImage.fromEcrRepository(this.repo, s.release),
      command: ["node", "dist/src/migrate/main.js"],
      environment: {
        AWS_REGION: this.region, WMS_STAGE: s.stage,
        DB_DIRECT_HOST: db.dbInstanceEndpointAddress, DB_DIRECT_PORT: db.dbInstanceEndpointPort,
        DB_MASTER_SECRET_ARN: db.secret!.secretArn, DB_PLATFORM_SECRET_ARN: platformLogin.secretArn,
        DB_PROXY_NAME: this.proxy.dbProxyName, DB_PROXY_HOST: this.proxy.endpoint,
        MIGRATE_CONCURRENCY: "4",
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "migrate", logRetention: logs.RetentionDays.ONE_YEAR }),
    });

    // ---------- The nightly backup: every warehouse dumped on its own, with its own key (server/src/ops/backup.ts) ----------
    const backupRole = new iam.Role(this, "BackupRole", { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"), description: "Nightly backup of every database" });
    db.secret!.grantRead(backupRole);
    backupRole.addToPolicy(new iam.PolicyStatement({
      actions: ["s3:PutObject", "s3:PutObjectTagging"],
      resources: [this.files.arnForObjects("tenants/*/backups/*"), this.files.arnForObjects("platform/backups/*")],
    }));
    // Encrypting with each warehouse's own key (made when the warehouse is created, alias wms/<stage>/tenant/<id>)
    backupRole.addToPolicy(new iam.PolicyStatement({
      actions: ["kms:GenerateDataKey", "kms:Encrypt"], resources: ["*"],
      conditions: { "ForAnyValue:StringLike": { "kms:ResourceAliases": `alias/wms/${s.stage}/tenant/*` } },
    }));
    this.platformKey.grantEncrypt(backupRole);
    const backup = new ecs.FargateTaskDefinition(this, "BackupTask", { cpu: 512, memoryLimitMiB: 1024, ephemeralStorageGiB: 50, taskRole: backupRole });
    backup.addContainer("backup", {
      image: ecs.ContainerImage.fromEcrRepository(this.repo, s.release),
      command: ["node", "dist/src/ops/backup.js"],
      environment: {
        AWS_REGION: this.region, DB_DIRECT_HOST: db.dbInstanceEndpointAddress, DB_DIRECT_PORT: db.dbInstanceEndpointPort,
        DB_MASTER_SECRET_ARN: db.secret!.secretArn, FILES_BUCKET: this.files.bucketName, PLATFORM_KEY_ARN: this.platformKey.keyArn,
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "backup", logRetention: logs.RetentionDays.ONE_YEAR }),
    });
    // Every night at 08:00 UTC (3–4 am in the US East)
    new events.Rule(this, "NightlyBackup", {
      description: "Nightly backup of every warehouse's database", schedule: events.Schedule.cron({ minute: "0", hour: "8" }),
      targets: [new targets.EcsTask({
        cluster: this.cluster, taskDefinition: backup, launchType: ecs.LaunchType.FARGATE,
        subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, securityGroups: [opsSg],
      })],
    });
    // A night that didn't finish emails the team
    new events.Rule(this, "BackupFailed", {
      description: "The nightly backup stopped with an error",
      eventPattern: {
        source: ["aws.ecs"], detailType: ["ECS Task State Change"],
        detail: { clusterArn: [this.cluster.clusterArn], lastStatus: ["STOPPED"], group: [`family:${backup.family}`], containers: { exitCode: [{ "anything-but": 0 }] } },
      },
      targets: [new targets.SnsTopic(this.alerts, { message: events.RuleTargetInput.fromText(`WMS ${s.stage}: the nightly backup failed. Its log is in CloudWatch (stream prefix "backup").`) })],
    });
    // ---------- Restoring one warehouse from its backup into a copy, and swapping it in (server/src/ops/restore.ts, by hand) ----------
    const restoreRole = new iam.Role(this, "RestoreRole", { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"), description: "Restore a warehouse's nightly backup into a new database" });
    db.secret!.grantRead(restoreRole);
    restoreRole.addToPolicy(new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: [this.files.arnForObjects("tenants/*/backups/*")] }));
    // Decrypting with the warehouses' own keys (and the platform key, for a warehouse backed up before it had one)
    restoreRole.addToPolicy(new iam.PolicyStatement({
      actions: ["kms:Decrypt"], resources: ["*"],
      conditions: { "ForAnyValue:StringLike": { "kms:ResourceAliases": `alias/wms/${s.stage}/tenant/*` } },
    }));
    this.platformKey.grantDecrypt(restoreRole);
    const restore = new ecs.FargateTaskDefinition(this, "RestoreTask", { cpu: 512, memoryLimitMiB: 1024, ephemeralStorageGiB: 50, taskRole: restoreRole });
    restore.addContainer("restore", {
      image: ecs.ContainerImage.fromEcrRepository(this.repo, s.release),
      command: ["node", "dist/src/ops/restore.js"], // started by hand with the arguments as a command override (docs/aws-setup.md)
      environment: {
        AWS_REGION: this.region, DB_DIRECT_HOST: db.dbInstanceEndpointAddress, DB_DIRECT_PORT: db.dbInstanceEndpointPort,
        DB_MASTER_SECRET_ARN: db.secret!.secretArn, FILES_BUCKET: this.files.bucketName,
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "restore", logRetention: logs.RetentionDays.ONE_YEAR }),
    });
    // A warehouse's own NAS copying its backups: may read that warehouse's backups only (access keys made by hand, docs/aws-setup.md)
    for (const tenant of s.nasTenants) {
      if (!/^[a-z][a-z0-9-]{1,30}$/.test(tenant)) throw new Error(`nasTenants: "${tenant}" isn't a warehouse id`);
      const nas = new iam.User(this, `Nas-${tenant}`, { userName: `wms-${s.stage}-nas-${tenant}` });
      nas.addToPolicy(new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [this.files.bucketArn], conditions: { StringLike: { "s3:prefix": [`tenants/${tenant}/backups/*`, `tenants/${tenant}/backups/`] } } }));
      nas.addToPolicy(new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: [this.files.arnForObjects(`tenants/${tenant}/backups/*`)] }));
      nas.addToPolicy(new iam.PolicyStatement({ actions: ["kms:Decrypt"], resources: ["*"], conditions: { "ForAnyValue:StringEquals": { "kms:ResourceAliases": `alias/wms/${s.stage}/tenant/${tenant}` } } }));
      new CfnOutput(this, `NasUser${tenant.replace(/-/g, "")}`, { value: nas.userName, description: `Read-only user for ${tenant}'s NAS: make its access key in the IAM console` });
    }

    const alarm = (a: cloudwatch.Alarm) => a.addAlarmAction(new cwActions.SnsAction(this.alerts));

    // ---------- Order emails: <id>@orders.<domain> → SES → files bucket + queue → the API → the warehouse's inbox ----------
    if (s.domain) {
      const ordersDomain = `orders.${s.domain}`;
      const dead = new sqs.Queue(this, "InboundDead", { retentionPeriod: Duration.days(14), encryption: sqs.QueueEncryption.SQS_MANAGED, enforceSSL: true });
      const queue = new sqs.Queue(this, "Inbound", {
        visibilityTimeout: Duration.minutes(3), encryption: sqs.QueueEncryption.SQS_MANAGED, enforceSSL: true,
        deadLetterQueue: { queue: dead, maxReceiveCount: 5 },
      });
      this.inboundQueue = queue;
      const topic = new sns.Topic(this, "InboundMail", { displayName: `WMS ${s.stage} order emails` });
      topic.addSubscription(new subs.SqsSubscription(queue, { rawMessageDelivery: true }));
      new ses.ReceiptRuleSet(this, "InboundRules", {
        receiptRuleSetName: `wms-${s.stage}-inbound`,
        rules: [{ recipients: [ordersDomain], scanEnabled: true, actions: [new sesActions.S3({ bucket: this.files, objectKeyPrefix: "inbound/", kmsKey: this.platformKey, topic })] }],
      });
      alarm(dead.metricApproximateNumberOfMessagesVisible().createAlarm(this, "InboundStuck", { threshold: 1, evaluationPeriods: 1, alarmDescription: `An order email couldn't be put in its warehouse's inbox after 5 tries (queue ${dead.queueName}).` }));
      new CfnOutput(this, "OrdersDomain", { value: ordersDomain, description: "Each warehouse's order address is <id>@this. Needs an MX record and the rule set made active (docs/aws-setup.md)" });
      new CfnOutput(this, "InboundRuleSet", { value: `wms-${s.stage}-inbound` });
    }

    // ---------- Alarms on connections (docs: "Watch it") ----------
    const proxyMetric = (metricName: string, statistic = "Maximum") =>
      new cloudwatch.Metric({ namespace: "AWS/RDS", metricName, dimensionsMap: { ProxyName: this.proxy.dbProxyName }, statistic, period: Duration.minutes(1) });
    alarm(new cloudwatch.MathExpression({
      expression: "100 * used / allowed",
      usingMetrics: { used: proxyMetric("DatabaseConnections"), allowed: proxyMetric("MaxDatabaseConnectionsAllowed") },
      period: Duration.minutes(1), label: "Proxy connections used (% of its cap)",
    }).createAlarm(this, "ProxyNearCap", { threshold: 80, evaluationPeriods: 5, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD, alarmDescription: "RDS Proxy is using over 80% of the connections it may open. Requests will start waiting." }));
    alarm(proxyMetric("DatabaseConnectionsBorrowLatency", "p99").createAlarm(this, "ProxyBorrowSlow", {
      threshold: 1_000_000, evaluationPeriods: 5, alarmDescription: "Requests wait over 1 s for a database connection (p99).", treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }));
    alarm(db.metricCPUUtilization().createAlarm(this, "DbCpu", { threshold: 80, evaluationPeriods: 10, alarmDescription: "Database CPU over 80% for 10 minutes." }));
    alarm(db.metricFreeStorageSpace().createAlarm(this, "DbStorage", { threshold: 10 * 1024 ** 3, evaluationPeriods: 1, comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD, alarmDescription: "Under 10 GB free on the database." }));

    // ---------- What the deploy workflow and people need ----------
    const appSubnets = this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds;
    new CfnOutput(this, "RepoUri", { value: this.repo.repositoryUri });
    new CfnOutput(this, "ClusterName", { value: this.cluster.clusterName });
    new CfnOutput(this, "MigrateTaskDefinition", { value: migrate.taskDefinitionArn });
    new CfnOutput(this, "BackupTaskDefinition", { value: backup.taskDefinitionArn });
    new CfnOutput(this, "RestoreTaskDefinition", { value: restore.taskDefinitionArn });
    new CfnOutput(this, "FilesBucket", { value: this.files.bucketName });
    new CfnOutput(this, "OpsSubnets", { value: Fn.join(",", appSubnets) });
    new CfnOutput(this, "OpsSecurityGroup", { value: opsSg.securityGroupId });
    new CfnOutput(this, "ProxyEndpoint", { value: this.proxy.endpoint });
    new CfnOutput(this, "DbEndpoint", { value: db.dbInstanceEndpointAddress });
  }
}
