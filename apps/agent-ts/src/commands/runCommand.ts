import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { runAgent } from "../scheduling/runAgent.ts";
import { logRotation } from "../service/agentService.ts";
import { reportFailure } from "./reportFailure.ts";

/*
 * Being unpaired or removed are finished states rather than crashes, so `run` stops with a zero
 * exit code and the installed service does not restart it every few seconds.
 */

export const runCommand = Command.make("run", {}, () =>
  runAgent.pipe(
    Effect.catchTags({
      ConfigUnavailable: ({ path, message }) =>
        reportFailure(`Could not read the pairing from ${path}: ${message}`),
      NotPaired: () =>
        Console.error(
          "This machine is not paired yet. Run `fleetfrog pair <pairing-string>` first.",
        ),
      MachineRemoved: () =>
        Console.error(
          "The hub no longer recognises this machine. Pair it again from the dashboard.",
        ),
    }),
    Effect.provide(logRotation),
  ),
).pipe(Command.withDescription("Connect to the hub and report this machine's repositories"));
