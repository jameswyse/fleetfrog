import { ActionKind, ActionOutcome, SkipReason, actionTiers } from "./action.ts";

import type { AgentCapabilities } from "./action.ts";
import type { Machine } from "./fleet.ts";

export function agentOutdated(capabilities: AgentCapabilities): boolean {
  return ActionKind.literals.some((kind) => !capabilities.actions.includes(kind));
}

export function actionBlocker(machine: Machine, kind: ActionKind): ActionOutcome | null {
  if (machine.connection._tag === "Offline") {
    return ActionOutcome.cases.MachineOffline.make({});
  }

  const { capabilities } = machine.connection;

  if (!capabilities.actions.includes(kind)) {
    return ActionOutcome.cases.Skipped.make({ reason: SkipReason.cases.AgentOutdated.make({}) });
  }

  const tier = actionTiers[kind];

  return capabilities.allowedTiers.includes(tier)
    ? null
    : ActionOutcome.cases.Skipped.make({ reason: SkipReason.cases.NotAllowed.make({ tier }) });
}
