import { once } from "node:events";

import { runCommand } from "../e2e/environment.ts";
import { startDemoHub } from "./demoHub.ts";

const pnpmPath = process.env.npm_execpath;

if (pnpmPath === undefined) {
  throw new Error("Run this command through pnpm demo.");
}

const controller = new AbortController();
const interrupt = () => controller.abort("SIGINT");

process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

await runCommand(pnpmPath, ["build", "--filter=@fleetfrog/web"], process.env, controller.signal);

const hub = await startDemoHub({ signal: controller.signal });

process.stdout.write(`Demo dashboard: ${hub.url}\nPress Ctrl+C to stop it.\n`);

await once(controller.signal, "abort");
await hub.close();
