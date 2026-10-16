// One-time account setup, uploaded by hand in the CloudFormation console (docs/aws-setup.md): lets the deploy
// workflow on GitHub sign in to AWS without any stored password (OIDC), with only the rights a deploy needs, and
// sets a monthly budget alert. Needs nothing else first (no CDK bootstrap, no files to upload).
// The file people upload is generated from this: `npm --prefix infra run setup:template`.
import { CfnCondition, CfnOutput, CfnParameter, DefaultStackSynthesizer, Fn, Stack, type StackProps } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export const DEPLOY_ROLE = "wms-github-deploy";
const GITHUB = "token.actions.githubusercontent.com";

export class SetupStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    // No bootstrap check: this runs before `cdk bootstrap`, from the console
    super(scope, id, { ...props, synthesizer: new DefaultStackSynthesizer({ generateBootstrapVersionRule: false }) });

    const repo = new CfnParameter(this, "GitHubRepo", {
      description: "The GitHub repository allowed to deploy (owner/name)", default: "karthik-pulla/a3k-wms", allowedPattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$",
    });
    const existing = new CfnParameter(this, "ExistingGitHubProviderArn", {
      description: "Leave empty, unless this AWS account already has GitHub's sign-in provider (IAM > Identity providers): then paste its ARN",
      default: "",
    });
    const email = new CfnParameter(this, "BudgetEmail", { description: "Who gets an email when the month's AWS bill is heading over budget (empty: no budget)", default: "" });
    const amount = new CfnParameter(this, "MonthlyBudgetUsd", { type: "Number", description: "Monthly budget in US dollars", default: 250, minValue: 1 });

    // ---------- GitHub's sign-in provider (an account can have only one) ----------
    const makeProvider = new CfnCondition(this, "MakeProvider", { expression: Fn.conditionEquals(existing.valueAsString, "") });
    // AWS checks GitHub's certificate itself now; the thumbprints are GitHub's published ones, for older checks
    const provider = new iam.CfnOIDCProvider(this, "GitHubProvider", {
      url: `https://${GITHUB}`, clientIdList: ["sts.amazonaws.com"],
      thumbprintList: ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"],
    });
    provider.cfnOptions.condition = makeProvider;
    const providerArn = Fn.conditionIf(makeProvider.logicalId, provider.attrArn, existing.valueAsString).toString();

    // ---------- The deploy role: only this repository, only its staging and prod environments ----------
    const role = new iam.Role(this, "DeployRole", {
      roleName: DEPLOY_ROLE,
      description: "GitHub Actions: Deploy to AWS (.github/workflows/deploy-aws.yml)",
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: { [`${GITHUB}:aud`]: "sts.amazonaws.com" },
        StringLike: { [`${GITHUB}:sub`]: ["staging", "prod"].map(env => `repo:${repo.valueAsString}:environment:${env}`) },
      }),
    });
    const arn = (service: string, resource: string) => `arn:${this.partition}:${service}:${this.region}:${this.account}:${resource}`;
    // CloudFormation changes go through the roles `cdk bootstrap` made; this role can only hand work to them
    role.addToPolicy(new iam.PolicyStatement({ actions: ["sts:AssumeRole"], resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*`] }));
    // The server image
    role.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:DescribeImages", "ecr:BatchGetImage"],
      resources: [arn("ecr", "repository/wms-server-*")],
    }));
    // The migration loop: start the task and wait for it
    role.addToPolicy(new iam.PolicyStatement({ actions: ["ecs:RunTask"], resources: [arn("ecs", "task-definition/WmsData*:*")] }));
    role.addToPolicy(new iam.PolicyStatement({ actions: ["ecs:DescribeTasks"], resources: [arn("ecs", "task/*")] }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["iam:PassRole"], resources: [`arn:${this.partition}:iam::${this.account}:role/WmsData-*`],
      conditions: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
    }));

    // ---------- A budget alert ----------
    const wantBudget = new CfnCondition(this, "WantBudget", { expression: Fn.conditionNot(Fn.conditionEquals(email.valueAsString, "")) });
    const budget = new budgets.CfnBudget(this, "Budget", {
      budget: { budgetName: "wms-monthly", budgetType: "COST", timeUnit: "MONTHLY", budgetLimit: { amount: amount.valueAsNumber, unit: "USD" } },
      notificationsWithSubscribers: [80, 100].map(threshold => ({
        notification: { notificationType: threshold === 80 ? "ACTUAL" : "FORECASTED", comparisonOperator: "GREATER_THAN", threshold, thresholdType: "PERCENTAGE" },
        subscribers: [{ subscriptionType: "EMAIL", address: email.valueAsString }],
      })),
    });
    budget.cfnOptions.condition = wantBudget;

    new CfnOutput(this, "DeployRoleArn", { value: role.roleArn, description: "Put this in GitHub: repository variable AWS_DEPLOY_ROLE_ARN" });
  }
}
