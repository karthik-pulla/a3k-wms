# Setting up AWS for the WMS

Everything runs on AWS. Nothing has to be installed on your computer: the one-off commands below run in **AWS CloudShell** (the terminal built into the AWS website), and deploys run on GitHub.

This is done once per AWS account. After that, every release is: GitHub → Actions → "Deploy to AWS" → Run workflow → pick `staging` or `prod`.

## What gets built

| Piece | What it is | Roughly per month (staging) |
| --- | --- | --- |
| PostgreSQL (RDS, `t4g.medium`) | One instance; a database per warehouse, plus the platform database | ~$50 |
| RDS Proxy | In front of PostgreSQL from day one, so connections can never run out | ~$22 (billed per database vCPU, 2 minimum) |
| NAT gateway | Lets the server reach AWS services from its private network | ~$33 + traffic |
| Load balancer | The public address of the API | ~$18 |
| ECS Fargate | The API (1 task in staging, 2–6 in prod) | ~$18 per task |
| S3, KMS, Secrets Manager, CloudWatch | Files, keys, logins, logs and alarms | a few dollars |

So about **$150–200 a month for staging**. Prod costs more: a bigger database with a standby copy in a second zone (Multi-AZ), and at least two API tasks. These are estimates; check the AWS pricing pages; the setup template (step 3) sets a budget alert.

## One-time setup

About 30 minutes, all in a web browser. Steps 1 and 5 are yours alone (creating accounts and signing in are things only you should do); everything else is clicking through what's prepared here.

1. **AWS account.** Create it at aws.amazon.com in the business owner's name, with a company email address. Then:
    - Turn on two-factor sign-in for the root user (Account menu → Security credentials).
    - Stop using root day to day: in **IAM Identity Center**, turn it on and create a user for yourself with the `AdministratorAccess` permission set. Sign in as that user from now on.
2. **Pick the region** `us-east-1` (N. Virginia) in the top-right corner of the console, and use it for every step below.
3. **Run the setup template.** It creates the role GitHub deploys with (no password stored anywhere; only this repository's `staging` and `prod` environments may use it) and a monthly budget alert.
    - Open **CloudFormation** → Create stack → With new resources → **Upload a template file** → choose `infra/setup/wms-account-setup.yaml` from this project folder.
    - Stack name: `wms-setup`. Fill in **BudgetEmail** (who gets cost warnings) and **MonthlyBudgetUsd** (e.g. 250). Leave the rest as it is.
    - Tick "I acknowledge that AWS CloudFormation might create IAM resources with custom names" → Submit.
    - When it says CREATE_COMPLETE, open its **Outputs** tab and copy **DeployRoleArn**.
    - If it fails on GitHubProvider because one already exists: IAM → Identity providers, copy that provider's ARN, and create the stack again with it pasted into **ExistingGitHubProviderArn**.
4. **Prepare the account for deploys** (once). Open **CloudShell** (the `>_` icon at the top of the console) and run:
   ```bash
   npx --yes aws-cdk@2.1145.0 bootstrap "aws://$(aws sts get-caller-identity --query Account --output text)/us-east-1"
   ```
   It takes a couple of minutes and ends with "Environment … bootstrapped".
5. **GitHub settings** for the repository (github.com → the repository → Settings):
    - Secrets and variables → Actions → **Variables** tab → New repository variable: `AWS_DEPLOY_ROLE_ARN` = the DeployRoleArn from step 3, and `AWS_REGION` = `us-east-1`.
    - **Environments** → New environment `staging`; New environment `prod` → tick "Required reviewers" and add yourself, so nothing reaches the real warehouse without your approval.
6. **First deploy.** The deploy workflow and the server code have to be on GitHub for this, so it needs a push first (your call). Then Actions → "Deploy to AWS" → Run workflow → `staging`. It builds everything, runs the migration loop and starts the API; the first run takes about 30 minutes (the database is the slow part). The API's address is printed at the end (ApiUrl).
7. **Your console account.** Once the domain is set up (the console lives at `ops.<domain>`), run the one-off task once in CloudShell, with the values the deploy printed:
   ```bash
   aws ecs run-task --cluster CLUSTER --task-definition MIGRATE_TASK --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[SUBNETS],securityGroups=[OPS_SG]}" --overrides '{"containerOverrides":[{"name":"migrate","command":["node","dist/src/ops/firstOperator.js","--name","Your Name","--username","you","--email","you@example.com","--ops-url","https://ops.example.com"]}]}'
   ```
   Its log (CloudWatch, prefix `migrate`) prints your invite link: choose a password and connect your authenticator app. Invite the rest of the team from the console after that.
8. **First warehouses.** Create a sandbox warehouse for testing, then A3K, with the tenant-creation task. The exact command comes with the next server step, which also loads A3K's settings, products and opening count into its database.

To regenerate the template after changing `infra/lib/setup-stack.ts`: `npm --prefix infra run setup:template` (the tests check it's up to date). To change it in AWS later: CloudFormation → `wms-setup` → Update → upload the new file.

## Domain

Until there's a domain, the API answers at the load balancer's address over plain HTTP, which is fine for staging tests with made-up data only. Before any real data goes in:

- Choose the product's domain and get a certificate for `*.<domain>` in AWS Certificate Manager.
- Deploy with `-c certificateArn=…`. The load balancer then serves HTTPS only and redirects HTTP to it.
- Deploy with `-c domain=<domain>` too: the console then answers at `ops.<domain>`.
- Email: verify the domain in Amazon SES (and ask AWS to lift the SES sandbox), then deploy with `-c mailFrom=no-reply@<domain>`. Until then, invite and reset links aren't emailed; whoever makes one copies it from the screen and sends it themselves.
- Point `*.<domain>` at the load balancer. Each warehouse's address, like `a3k.<domain>`, is a row in the platform database's `domains` table, added when the tenant is created.
