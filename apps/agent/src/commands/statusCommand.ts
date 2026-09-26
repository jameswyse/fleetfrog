import { Console, Effect, Option } from "effect";
import { Command } from "effect/unstable/cli";

import { configPath, loadAgentConfig } from "../config/agentConfig.ts";
import { agentVersion } from "../machine/machineInfo.ts";
import { reportFailure } from "./reportFailure.ts";

export const statusCommand = Command.make("status", {}, () =>
  loadAgentConfig.pipe(
    Effect.flatMap((config) =>
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
            ].join("\n"),
        }),
      ),
    ),
    Effect.catchTag("ConfigUnavailable", ({ path, message }) =>
      reportFailure(`Could not read the pairing from ${path}: ${message}`),
    ),
  ),
).pipe(Command.withDescription("Show how this agent is paired"));
