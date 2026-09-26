import { Chip } from "@/ui/Chip.tsx";

import { countParts } from "../actions/actionCopy.ts";

import type { ChipTone } from "@/ui/Chip.tsx";
import type { RunCounts, RunStatus } from "@fleetfrog/protocol/domain/activity";

/** Problems in the danger colour, work in progress in the sync colour and quiet endings in grey. */
const statusTones = {
  Running: "sync",
  Queued: "sync",
  Succeeded: "clean",
  Failed: "danger",
  Interrupted: "danger",
  Skipped: "changes",
  Cancelled: "neutral",
  MachineOffline: "neutral",
} satisfies Record<RunStatus, ChipTone>;

const dotClasses = {
  neutral: "bg-ink-muted/60",
  changes: "bg-changes",
  sync: "bg-sync",
  danger: "bg-danger",
  clean: "bg-clean",
} satisfies Record<ChipTone, string>;

/** The colour a state has in a batch's result, as a decorative dot beside its name. */
export function StatusDot({ status }: { readonly status: RunStatus }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 shrink-0 rounded-full ${dotClasses[statusTones[status]]}`}
    />
  );
}

/** A batch's runs by state, such as "3 succeeded" beside "1 failed". */
export function RunCountChips({ counts }: { readonly counts: RunCounts }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {countParts(counts).map(({ status, text }) => (
        <Chip key={status} tone={statusTones[status]}>
          {text}
        </Chip>
      ))}
    </span>
  );
}
