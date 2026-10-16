// The one-time setup template: GitHub may deploy only from this repository's staging and prod environments,
// with only what a deploy needs, and the template needs nothing else first (it's uploaded by hand).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { SetupStack } from "../lib/setup-stack.ts";

const t = Template.fromStack(new SetupStack(new App(), "WmsSetup"));
const json = t.toJSON();

test("only this repository's staging and prod environments can use the deploy role", () => {
  const role = Object.values(t.findResources("AWS::IAM::Role"))[0] as any;
  const st = role.Properties.AssumeRolePolicyDocument.Statement[0];
  assert.equal(st.Action, "sts:AssumeRoleWithWebIdentity");
  assert.deepEqual(st.Condition.StringEquals, { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" });
  const subs = JSON.stringify(st.Condition.StringLike["token.actions.githubusercontent.com:sub"]);
  assert.match(subs, /:environment:staging/);
  assert.match(subs, /:environment:prod/);
  assert.doesNotMatch(subs, /\*/, "no wildcard: branches and pull requests can't deploy");
});

test("the deploy role can hand work to CDK, push images and run the migration task, nothing more", () => {
  const statements = (Object.values(t.findResources("AWS::IAM::Policy")) as any[]).flatMap(p => p.Properties.PolicyDocument.Statement);
  const actions = statements.flatMap(s => [s.Action].flat());
  for (const a of actions) assert.match(a, /^(sts:AssumeRole|ecr:|ecs:RunTask|ecs:DescribeTasks|iam:PassRole)/, a);
  assert.ok(!actions.includes("*") && !actions.some(a => a.endsWith(":*")), "no wildcard actions");
  const pass = statements.find(s => s.Action === "iam:PassRole");
  assert.deepEqual(pass.Condition, { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } });
  const star = statements.filter(s => s.Resource === "*").flatMap(s => [s.Action].flat());
  assert.deepEqual(star, ["ecr:GetAuthorizationToken"], "only the ECR sign-in is account-wide (AWS requires it)");
});

test("it needs no bootstrap, Lambda or uploaded files, so it works from the console in a new account", () => {
  const text = JSON.stringify(json);
  assert.ok(!json.Parameters?.BootstrapVersion && !json.Rules, "no bootstrap check");
  assert.ok(!/AWS::Lambda|Custom::|AssetParameters|cdk-hnb659fds-assets/.test(text));
});

test("GitHub's provider and the budget are optional", () => {
  t.hasCondition("MakeProvider", {});
  t.hasCondition("WantBudget", {});
  assert.equal((Object.values(t.findResources("AWS::IAM::OIDCProvider"))[0] as any).Condition, "MakeProvider");
  assert.equal((Object.values(t.findResources("AWS::Budgets::Budget"))[0] as any).Condition, "WantBudget");
});

test("the file people upload is up to date with this code", () => {
  const file = readFileSync(new URL("../setup/wms-account-setup.yaml", import.meta.url), "utf8");
  for (const id of Object.keys(json.Resources)) assert.ok(file.includes(`${id}:`), `${id} is missing: run npm --prefix infra run setup:template`);
  assert.match(file, /6938fd4d98bab03faadb97b34396831e3780aea1/);
});
