import { Console, Effect, Option } from "effect";
import { Command } from "effect/cli";

import { auditLogPath } from "../audit/auditLog.ts";
import { configPath, loadAgentConfig } from "../config/agentConfig.ts";
import { loadPolicy, policyPath } from "../config/agentPolicy.ts";
import { agentVersion } from "../machine/machineInfo.ts";
import { reportFailure } from "./reportFailure.ts";

export const statusCommand = Command.make("status", {}, () =>
  Effect.all([loadAgentConfig, loadPolicy]).pipe(
    Effect.flatMap(([config, policy]) =>
      Console.log(
        Option.match(config, {
          onNone: () =>
            `FleetFrog agent ${agentVersion}\nNot paired. Run \`fleetfrog pair <pairing-string>\`.`,
          onSome: ({ agentUrl, machineId, certificatePem }) =>
            [
              `FleetFrog agent ${agentVersion}`,
              `Hub: ${agentUrl}`,
              `Machine: ${machineId}`,
              `Hub certificate: ${certificatePem === null ? "publicly trusted" : "pinned at pairing"}`,
              `Credentials: ${configPath()}`,
              `Allowed actions: ${policy.allowedTiers.length === 0 ? "none" : policy.allowedTiers.join(", ")} (${policyPath()})`,
              `Audit log: ${auditLogPath()}`,
            ].join("\n"),
        }),
      ),
    ),
    Effect.catchTag("ConfigUnavailable", ({ path, message }) =>
      reportFailure(`Could not read ${path}: ${message}`),
    ),
  ),
).pipe(Command.withDescription("Show how this agent is paired"));
