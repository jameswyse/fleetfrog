import { ActionKind, ActionOutcome, SkipReason, actionTiers } from "./action.ts";

import type { AgentCapabilities, Tier } from "./action.ts";
import type { Machine } from "./fleet.ts";

export function agentOutdated(capabilities: AgentCapabilities): boolean {
  return ActionKind.literals.some((kind) => !capabilities.actions.includes(kind));
}

export function actionBlocker(
  machine: Machine,
  kind: ActionKind,
  tier: Tier = actionTiers[kind],
): ActionOutcome | null {
  if (machine.connection._tag === "Offline") {
    return ActionOutcome.cases.MachineOffline.make({});
  }

  const { capabilities } = machine.connection;

  if (!capabilities.actions.includes(kind)) {
    return ActionOutcome.cases.Skipped.make({ reason: SkipReason.cases.AgentOutdated.make({}) });
  }

  return capabilities.allowedTiers.includes(tier)
    ? null
    : ActionOutcome.cases.Skipped.make({ reason: SkipReason.cases.NotAllowed.make({ tier }) });
}
