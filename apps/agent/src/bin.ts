#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { pairCommand } from "./commands/pairCommand.ts";
import { allowCommand, denyCommand } from "./commands/policyCommands.ts";
import { runCommand } from "./commands/runCommand.ts";
import { serviceCommand } from "./commands/serviceCommand.ts";
import { statusCommand } from "./commands/statusCommand.ts";
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
  ]),
);

Command.run(fleetfrog, { version: agentVersion }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
