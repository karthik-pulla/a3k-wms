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
8. **First warehouses.** In the console (Warehouses → New warehouse), create a test warehouse first (id `sandbox`), then A3K (id `a3k`). Each gets its own database, key and address, and its first owner's invite (shown in the console; emailed once email is set up).
9. **The test warehouse.** Sign in to `sandbox.<domain>` as its owner, open **Team → Setup**, choose the made-up demo files from the repository (`app/public/tenants/demo/config.json`, `products.json`, `logos.json`) → Save. Use it to try every release before A3K sees it. Never put real data in it.
10. **A3K.** Sign in to `a3k.<domain>` as its owner, **Team → Setup**, choose `app/public/tenants/a3k/config.json`, `products.json` and `logos.json` → Save (480 products). Invite the team on Team → People. For go-live, run the 3-day count in **Inventory → Count** and apply it; that sets the opening stock (or fill in the `.xlsx` template from Team → Setup and load it).

To regenerate the template after changing `infra/lib/setup-stack.ts`: `npm --prefix infra run setup:template` (the tests check it's up to date). To change it in AWS later: CloudFormation → `wms-setup` → Update → upload the new file.

## Settings for deploys

The deploy reads these from the GitHub environment (`staging` or `prod` → Environment variables). Leave out what you don't have yet:

| Variable | What it is |
| --- | --- |
| `WMS_DOMAIN` | The product's domain. Warehouses at `<id>.<domain>`, the console at `ops.<domain>`, the public page at `<domain>`, order emails at `<id>@orders.<domain>`. |
| `WMS_CERTIFICATE_ARN` | The HTTPS certificate (below). |
| `WMS_MAIL_FROM` | The sender for invite emails, e.g. `no-reply@<domain>`. |
| `WMS_ALERT_EMAIL` | Who gets alarms (database busy, backup failed, an order email stuck). |
| `WMS_VISIT_EMAIL` | Who gets "Book a visit" requests (defaults to the alert email). |
| `WMS_PRODUCT_NAME` | The product's name on its public page ("WMS" until it's chosen). |
| `WMS_NAS_TENANTS` | Warehouses whose own NAS copies their backups, e.g. `a3k`. |

## Domain

Until there's a domain, the API answers at the load balancer's address over plain HTTP, which is fine for staging tests with made-up data only. Before any real data goes in:

- Choose the product's domain and get a certificate in AWS Certificate Manager for both `<domain>` and `*.<domain>`.
- Set `WMS_CERTIFICATE_ARN` and `WMS_DOMAIN`, and deploy. The load balancer then serves HTTPS only; the console answers at `ops.<domain>` and the public page ("Book a visit") at `<domain>` and `www.<domain>`.
- DNS: point `<domain>`, `www.<domain>` and `*.<domain>` at the load balancer. Each warehouse's address, like `a3k.<domain>`, is a row in the platform database's `domains` table, added when the warehouse is created.
- Email out: verify the domain in Amazon SES (and ask AWS to lift the SES sandbox), then set `WMS_MAIL_FROM`. Until then, invite and reset links aren't emailed; whoever makes one copies it from the screen.

## Order emails

Each warehouse's order address is `<id>@orders.<domain>` (A3K: `a3k@orders.<domain>`). With `WMS_DOMAIN` set, the deploy sets up the receiving side; three things are done by hand once:

1. DNS: an **MX** record for `orders.<domain>` → `10 inbound-smtp.us-east-1.amazonaws.com`.
2. SES → Identities: verify `orders.<domain>` (receiving needs it).
3. Turn the receiving rules on, in CloudShell: `aws ses set-active-receipt-rule-set --rule-set-name wms-prod-inbound` (or `wms-staging-inbound`).

Then A3K forwards `orders@a3kimports.com` to `a3k@orders.<domain>` (in its email provider). Emails appear in Out-bounds → Inbox within a minute; PDFs up to 1 MB come with them. To accept orders only from known senders, add them to A3K's settings: `"orders": { "inbox": "orders@a3kimports.com", "trustedSenders": ["@patelbrothers.example", "buyer@store.example"] }`; mail from anyone else arrives marked ignored. An email that can't be delivered after 5 tries emails the alert address.

## Nightly backups and A3K's NAS

Every night at 08:00 UTC each warehouse's database is dumped on its own (`pg_dump`, PostgreSQL's own format) into the files bucket at `tenants/<id>/backups/<date>.dump`, encrypted with that warehouse's own key, and kept 35 days; a night that fails emails the alert address. (The database also keeps its own 14-day snapshots.)

For A3K's NAS to keep its own copy:

1. Set `WMS_NAS_TENANTS` to `a3k` and deploy. This makes a user `wms-prod-nas-a3k` that may only read A3K's backups.
2. IAM → Users → `wms-prod-nas-a3k` → Security credentials → Create access key ("Third-party service"). Copy both values; they're shown once.
3. On the NAS, add an S3 backup or sync job (Synology: Hyper Backup or Cloud Sync, "Amazon S3"; QNAP: Hybrid Backup Sync): the access key, region `us-east-1`, the bucket from the deploy's **FilesBucket** output, folder `tenants/a3k/backups/`, download only, daily.

A backup is restored with `pg_restore` into a new database (docs/multi-tenant-design.md, section 9).
