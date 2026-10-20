// The API on ECS Fargate behind a load balancer. It reaches PostgreSQL only through RDS Proxy, signing in with IAM as
// wms_platform (the platform database) or a tenant's own login (t_<id>). Deployed after the migration loop has run.
import { ArnFormat, CfnOutput, Duration, Fn, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import type { DataStack } from "./data-stack.ts";
import type { Settings } from "./settings.ts";

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, s: Settings, data: DataStack, props?: StackProps) {
    super(scope, id, props);

    const apiSg = new ec2.SecurityGroup(this, "ApiSg", { vpc: data.vpc, description: "WMS API tasks" });
    // The API may reach the proxy, and nothing reaches the database except through it
    new ec2.CfnSecurityGroupIngress(this, "ApiToProxy", {
      groupId: data.proxySg.securityGroupId, sourceSecurityGroupId: apiSg.securityGroupId, ipProtocol: "tcp", fromPort: 5432, toPort: 5432, description: "WMS API",
    });

    const taskRole = new iam.Role(this, "ApiRole", { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"), description: "WMS API" });
    // IAM sign-in to RDS Proxy: the platform role and every tenant's login (t_*), on this proxy only
    const proxyId = Fn.select(6, Fn.split(":", data.proxy.dbProxyArn));
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ["rds-db:connect"],
      resources: ["wms_platform", "t_*"].map(user => this.formatArn({ service: "rds-db", resource: "dbuser", resourceName: `${proxyId}/${user}`, arnFormat: ArnFormat.COLON_RESOURCE_NAME })),
    }));
    // Tenant files (photos, PDFs, exports) under tenants/<id>/; per-tenant keys come with the files work
    data.files.grantReadWrite(taskRole, "tenants/*");
    // The app key (seals authenticator secrets). On the role itself: a grant on the secret would make the data stack
    // depend on this one.
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [data.appKey.secretArn] }));
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["kms:Decrypt"], resources: [data.platformKey.keyArn], conditions: { StringEquals: { "kms:ViaService": `secretsmanager.${this.region}.amazonaws.com` } } }));
    // "Create a warehouse" in the ops console starts the one-off task (which has the master login the API never gets)
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["ecs:RunTask"], resources: [data.opsTask.taskDefinitionArn] }));
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["ecs:DescribeTasks"], resources: ["*"], conditions: { ArnEquals: { "ecs:cluster": data.cluster.clusterArn } } }));
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["iam:PassRole"], resources: [data.opsTask.taskRole.roleArn, data.opsTask.obtainExecutionRole().roleArn] }));
    // Invite and reset emails, from one verified sender only
    // Order emails: take them off the queue, read and delete what SES kept (encrypted with the platform key)
    if (data.inboundQueue) {
      taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"], resources: [data.inboundQueue.queueArn] }));
      taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:DeleteObject"], resources: [data.files.arnForObjects("inbound/*")] }));
      taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["kms:Decrypt"], resources: [data.platformKey.keyArn], conditions: { StringEquals: { "kms:ViaService": `s3.${this.region}.amazonaws.com` } } }));
    }
    if (s.mailFrom) taskRole.addToPolicy(new iam.PolicyStatement({ actions: ["ses:SendEmail"], resources: ["*"], conditions: { StringEquals: { "ses:FromAddress": s.mailFrom } } }));

    const https = !!s.certificateArn;
    const svc = new patterns.ApplicationLoadBalancedFargateService(this, "Api", {
      cluster: data.cluster,
      cpu: 512, memoryLimitMiB: 1024,
      desiredCount: s.apiTasks.min,
      taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [apiSg],
      publicLoadBalancer: true,
      ...(https ? { protocol: elbv2.ApplicationProtocol.HTTPS, certificate: acm.Certificate.fromCertificateArn(this, "Cert", s.certificateArn!), redirectHTTP: true, sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS } : {}),
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(data.repo, s.release),
        containerPort: 8080,
        taskRole,
        environment: {
          AWS_REGION: this.region, WMS_STAGE: s.stage, PORT: "8080",
          DB_PROXY_HOST: data.proxy.endpoint,
          DB_CONNECTION_BUDGET: String(s.connectionBudget), DB_PER_TENANT_MAX: String(s.perTenantMax),
          APP_KEY_SECRET_ARN: data.appKey.secretArn,
          COOKIE_SECURE: https ? "1" : "0",
          STATIC_DIR: "/app/public",
          ECS_CLUSTER: data.cluster.clusterName, OPS_TASK_DEFINITION: data.opsTask.taskDefinitionArn,
          OPS_SUBNETS: Fn.join(",", data.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds),
          OPS_SECURITY_GROUP: data.opsSg.securityGroupId,
          ...(s.domain ? { OPS_HOST: `ops.${s.domain}`, SITE_HOST: s.domain } : {}),
          ...(s.productName ? { PRODUCT_NAME: s.productName } : {}),
          ...(s.visitEmail && s.mailFrom ? { VISIT_NOTIFY: s.visitEmail } : {}),
          ...(s.mailFrom ? { MAIL_FROM: s.mailFrom } : {}),
          ...(data.inboundQueue && s.domain ? { INBOUND_QUEUE_URL: data.inboundQueue.queueUrl, ORDERS_DOMAIN: `orders.${s.domain}` } : {}),
        },
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: "api", logRetention: logs.RetentionDays.ONE_YEAR }),
      },
    });
    svc.targetGroup.configureHealthCheck({ path: "/api/health", healthyHttpCodes: "200", interval: Duration.seconds(15) });
    svc.targetGroup.setAttribute("deregistration_delay.timeout_seconds", "20");
    const scaling = svc.service.autoScaleTaskCount({ minCapacity: s.apiTasks.min, maxCapacity: s.apiTasks.max });
    scaling.scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 60 });

    new CfnOutput(this, "ApiUrl", { value: `${https ? "https" : "http"}://${svc.loadBalancer.loadBalancerDnsName}` });
    // Worst case connections from the API to the proxy: tasks × budget (the proxy's own cap protects the database anyway)
    new CfnOutput(this, "MaxApiConnections", { value: String(s.apiTasks.max * s.connectionBudget) });
  }
}
