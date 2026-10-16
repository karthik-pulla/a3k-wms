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
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
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
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30) }],
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

    // ---------- Alarms on connections (docs: "Watch it") ----------
    const proxyMetric = (metricName: string, statistic = "Maximum") =>
      new cloudwatch.Metric({ namespace: "AWS/RDS", metricName, dimensionsMap: { ProxyName: this.proxy.dbProxyName }, statistic, period: Duration.minutes(1) });
    const alarm = (a: cloudwatch.Alarm) => a.addAlarmAction(new cwActions.SnsAction(this.alerts));
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
    new CfnOutput(this, "OpsSubnets", { value: Fn.join(",", appSubnets) });
    new CfnOutput(this, "OpsSecurityGroup", { value: opsSg.securityGroupId });
    new CfnOutput(this, "ProxyEndpoint", { value: this.proxy.endpoint });
    new CfnOutput(this, "DbEndpoint", { value: db.dbInstanceEndpointAddress });
  }
}
