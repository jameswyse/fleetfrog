import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { Spinner } from "@/ui/Spinner.tsx";

import { PersonalText } from "../preferences/PersonalText.tsx";
import { describeActiveRun, describeOutcome } from "./actionCopy.ts";

import type { OutcomeKind } from "@fleetfrog/protocol/domain/action";
import type { ActionRun } from "@fleetfrog/protocol/domain/activity";

const outcomeTones = {
  Succeeded: "text-clean",
  Failed: "text-danger",
  Skipped: "text-changes",
  Cancelled: "text-ink-muted",
  Interrupted: "text-changes",
  MachineOffline: "text-ink-muted",
} satisfies Record<OutcomeKind, string>;

/**
 * A run's state in one line: what it is doing now, or how it ended, why and when. `RunActivity`
 * shows a running one where there is less room.
 */
export function RunStateText({ run }: { readonly run: ActionRun }) {
  const { state } = run;

  if (state._tag !== "Finished") {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-sync">
        <Spinner />
        <span className="truncate">
          <PersonalText>{describeActiveRun(run)}</PersonalText>
        </span>
      </span>
    );
  }

  const { summary, detail } = describeOutcome(state.outcome);

  return (
    <span className="min-w-0">
      <span className={`font-medium ${outcomeTones[state.outcome._tag]}`}>{summary}</span>
      {detail !== null && (
        <span className="break-words">
          : <PersonalText>{detail}</PersonalText>
        </span>
      )}
      <span className="text-ink-muted">
        {" · "}
        <RelativeTime at={state.finishedAt} />
      </span>
    </span>
  );
}
