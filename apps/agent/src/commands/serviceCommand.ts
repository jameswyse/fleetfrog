import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { installService, uninstallService } from "../service/agentService.ts";
import { reportFailure } from "./reportFailure.ts";

const install = Command.make("install", {}, () =>
  installService.pipe(
    Effect.flatMap((definition) =>
      Console.log(
        process.platform === "linux"
          ? `Installed and started ${definition}.\nTo keep it running while you are logged out, run \`loginctl enable-linger\`.`
          : `Installed and started ${definition}.`,
      ),
    ),
    Effect.catchTag("CommandFailed", ({ message }) =>
      reportFailure(`Could not start the service: ${message}`),
    ),
  ),
).pipe(Command.withDescription("Run the agent in the background whenever you are logged in"));

const uninstall = Command.make("uninstall", {}, () =>
  uninstallService.pipe(
    Effect.flatMap((definition) => Console.log(`Stopped the agent and removed ${definition}.`)),
    Effect.catchTag("CommandFailed", ({ message }) =>
      reportFailure(`Could not remove the service: ${message}`),
    ),
  ),
).pipe(Command.withDescription("Stop the background agent and remove its service"));

export const serviceCommand = Command.make("service").pipe(
  Command.withDescription("Manage the background agent service"),
  Command.withSubcommands([install, uninstall]),
);
