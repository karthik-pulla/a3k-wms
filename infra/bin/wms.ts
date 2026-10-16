// The WMS on AWS: `cdk deploy -c stage=staging -c release=<git commit> WmsData-staging`, then the migration task,
// then `... WmsApi-staging`. The deploy workflow (.github/workflows/deploy-aws.yml) does exactly that, in that order.
import { App, Tags } from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack.ts";
import { DataStack } from "../lib/data-stack.ts";
import { settingsFor } from "../lib/settings.ts";

const app = new App();
const s = settingsFor(app.node.tryGetContext("stage") ?? "staging", key => app.node.tryGetContext(key));
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" };

const data = new DataStack(app, `WmsData-${s.stage}`, s, { env, description: `WMS ${s.stage}: network, PostgreSQL + RDS Proxy, files, migration task` });
// Uses the data stack's outputs, so CloudFormation always deploys the data stack first
const api = new ApiStack(app, `WmsApi-${s.stage}`, s, data, { env, description: `WMS ${s.stage}: the API on ECS Fargate` });
// RDS Proxy target groups can't carry tags
for (const st of [data, api]) Tags.of(st).add("wms:stage", s.stage, { excludeResourceTypes: ["AWS::RDS::DBProxyTargetGroup"] });
