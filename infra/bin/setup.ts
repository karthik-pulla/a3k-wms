// The one-time account setup template (lib/setup-stack.ts). Region and account come from where it's uploaded.
import { App } from "aws-cdk-lib";
import { SetupStack } from "../lib/setup-stack.ts";

const app = new App();
new SetupStack(app, "WmsSetup", { description: "WMS one-time setup: GitHub deploy role (OIDC, no stored passwords) and a budget alert" });
