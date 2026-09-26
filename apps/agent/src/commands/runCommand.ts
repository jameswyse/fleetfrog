import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { runAgent } from "../scheduling/runAgent.ts";
import { reportFailure } from "./reportFailure.ts";

export const runCommand = Command.make("run", {}, () =>
  runAgent.pipe(
    Effect.catchTags({
      NotPaired: () =>
        reportFailure(
          "This machine is not paired yet. Run `fleetfrog pair <pairing-string>` first.",
        ),
      MachineRemoved: () =>
        reportFailure(
          "The hub no longer recognises this machine. Pair it again from the dashboard.",
        ),
    }),
  ),
).pipe(Command.withDescription("Connect to the hub and report this machine's repositories"));
