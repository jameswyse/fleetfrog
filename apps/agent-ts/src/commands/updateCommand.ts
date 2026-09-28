import { Command, Flag } from "effect/cli";

import { runsFromSource } from "../machine/machineInfo.ts";
import { reportFailure } from "./reportFailure.ts";

/** Only release builds of the Rust agent update themselves, so this explains how instead. */
export const updateCommand = Command.make(
  "update",
  {
    yes: Flag.Boolean("yes").pipe(
      Flag.withAlias("y"),
      Flag.withDescription("Update without asking first"),
      Flag.withDefault(false),
    ),
  },
  () => reportFailure(runsFromSource),
).pipe(Command.withDescription("Update this agent to the version its hub runs"));
