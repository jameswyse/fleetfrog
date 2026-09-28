#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { Command } from "effect/cli";

import { pairCommand } from "./commands/pairCommand.ts";
import { allowCommand, denyCommand } from "./commands/policyCommands.ts";
import { runCommand } from "./commands/runCommand.ts";
import { serviceCommand } from "./commands/serviceCommand.ts";
import { statusCommand } from "./commands/statusCommand.ts";
import { updateCommand } from "./commands/updateCommand.ts";
import { currentInstance, instanceVariable, isValidInstanceName } from "./config/agentInstance.ts";
import { agentVersion } from "./machine/machineInfo.ts";

const fleetfrog = Command.make("fleetfrog").pipe(
  Command.withDescription("Report this machine's repositories to a FleetFrog hub"),
  Command.withSubcommands([
    pairCommand,
    runCommand,
    statusCommand,
    serviceCommand,
    allowCommand,
    denyCommand,
    updateCommand,
  ]),
);

const instance = currentInstance();

if (instance !== undefined && !isValidInstanceName(instance)) {
  process.stderr.write(
    `${instanceVariable} is "${instance}", but an instance name can only use lowercase letters, digits and single hyphens, such as dev.\n`,
  );
  process.exitCode = 1;
} else {
  Command.run(fleetfrog, { version: agentVersion }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
