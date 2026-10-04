import { Effect } from "effect";

import { ActionOutcome } from "@fleetfrog/protocol/domain/action";

import type { ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";

import type { CommandFailed } from "../process/runTool.ts";

export const failed = (message: string) => ActionOutcome.cases.Failed.make({ message });

export const skipped = (reason: SkipReason) => ActionOutcome.cases.Skipped.make({ reason });

export const succeeded = (result: ActionResult) => ActionOutcome.cases.Succeeded.make({ result });

export const failedWith = ({ message }: CommandFailed) => Effect.succeed(failed(message));
