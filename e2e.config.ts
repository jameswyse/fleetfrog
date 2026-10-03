import path from "node:path";

import { web } from "@e2e-dev/web";
import { chatgpt } from "e2e/oauth/chatgpt";

import { sandboxDirectory } from "./tools/e2e/repositories.ts";

import type { E2EConfig } from "e2e";

const url = process.env.FLEETFROG_E2E_URL;

if (url === undefined) {
  throw new Error("Run pnpm test:e2e to start the isolated hub and agent.");
}

export default {
  projectId: "fleetfrog-local",
  tests: ["tests/e2e/**/*.e2e.ts"],
  workers: 1,
  retries: 0,
  timeout: 120_000,
  assertionTimeout: 15_000,
  output: `.e2e/runs/${path.basename(sandboxDirectory())}`,
  cache: { mode: "read-write", dir: ".e2e/cache" },
  trace: "retain-on-failure",
  reporters: ["list", "markdown"],
  agents: {
    default: {
      model: chatgpt("gpt-6.1-sol"),
      maxSteps: 20,
      maxModelCalls: 20,
      context:
        "FleetFrog manages Git checkouts. This isolated test fleet has E2E machine and E2E clone machine. Only act on the repository named in the test, on E2E machine. Use the Projects grid to open its checkout panel. Local branches has Switch buttons. More actions for this checkout contains Archive. Cleanup > Archive contains Unarchive. You may view machine settings when asked. Never delete checkouts, empty trash, change machine settings or update the agent.",
    },
  },
  targets: [
    {
      name: "chromium",
      engine: web({ browser: "chromium", viewport: { width: 1440, height: 1000 } }),
      app: { url, identity: "fleetfrog-local-sandbox" },
    },
  ],
} satisfies E2EConfig;
