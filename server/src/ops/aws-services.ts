// The server's AWS pieces: email through SES, creating a warehouse by starting the tenant-creation task on ECS, and
// the app key from Secrets Manager.
import { createHash } from "node:crypto";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { DescribeTasksCommand, ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { Mailer } from "../core/mail.ts";
import type { TenantCreator } from "../core/ops-api.ts";

/** Email from a verified SES address (MAIL_FROM). Until one is set up, nothing is sent and links are copied by hand. */
export function sesMailer(region: string, from: string): Mailer {
  const ses = new SESv2Client({ region });
  return {
    async send(m) {
      try {
        await ses.send(new SendEmailCommand({ FromEmailAddress: from, Destination: { ToAddresses: [m.to] }, Content: { Simple: { Subject: { Data: m.subject }, Body: { Text: { Data: m.text } } } } }));
        return true;
      } catch (e) {
        console.error(JSON.stringify({ level: "error", msg: "email not sent", err: (e as Error).message }));
        return false;
      }
    },
  };
}

/** "Create a warehouse" in the console starts the one-off task (it has the master login the API never gets) */
export function ecsCreator(o: { region: string; cluster: string; taskDefinition: string; subnets: string[]; securityGroups: string[] }): TenantCreator {
  const ecs = new ECSClient({ region: o.region });
  return {
    async start(t) {
      const command = ["node", "dist/src/ops/createTenant.js", "--id", t.id, "--name", t.name, ...t.hosts.flatMap(h => ["--host", h])];
      const r = await ecs.send(new RunTaskCommand({
        cluster: o.cluster, taskDefinition: o.taskDefinition, launchType: "FARGATE", count: 1,
        networkConfiguration: { awsvpcConfiguration: { subnets: o.subnets, securityGroups: o.securityGroups, assignPublicIp: "DISABLED" } },
        overrides: { containerOverrides: [{ name: "migrate", command }] },
        startedBy: `console-${t.id}`.slice(0, 36),
      }));
      const arn = r.tasks?.[0]?.taskArn;
      if (!arn) throw new Error(`The task didn't start: ${r.failures?.map(f => f.reason).join(", ") ?? "no reason given"}`);
      return { job: arn };
    },
    async status(job) {
      const r = await ecs.send(new DescribeTasksCommand({ cluster: o.cluster, tasks: [job] }));
      const t = r.tasks?.[0];
      if (!t) return { state: "failed", detail: "The task is gone" };
      if (t.lastStatus !== "STOPPED") return { state: "running", detail: t.lastStatus?.toLowerCase() };
      const code = t.containers?.[0]?.exitCode;
      return code === 0 ? { state: "done" } : { state: "failed", detail: `Exit code ${code ?? "?"}: ${t.stoppedReason ?? "see the task's log (prefix migrate)"}` };
    },
  };
}

/** 32 bytes for sealing authenticator secrets: the SHA-256 of the generated secret (it never leaves the server) */
export async function appKeyFrom(region: string, secretArn: string): Promise<Uint8Array> {
  const out = await new SecretsManagerClient({ region }).send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!out.SecretString || out.SecretString.length < 32) throw new Error("The app key secret is empty or too short");
  return new Uint8Array(createHash("sha256").update(out.SecretString).digest());
}
