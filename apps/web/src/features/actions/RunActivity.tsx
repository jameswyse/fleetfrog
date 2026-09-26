import { Spinner } from "@/ui/Spinner.tsx";

import { describeActiveRunBriefly } from "./actionCopy.ts";
import { progressFraction } from "./runProgress.ts";

import type { ActionRun } from "@fleetfrog/protocol/domain/activity";

/**
 * A queued or running run in a tight space: a word for what it is doing and a bar for how far Git
 * has got, with Git's own progress line in the tooltip. `Stacked` puts the bar under the words;
 * `Inline` puts it beside them, so a cell keeps its height while the run goes.
 */
export function RunActivity({
  run,
  layout,
  align,
}: {
  readonly run: ActionRun;
  readonly layout: "Stacked" | "Inline";
  /** Where the words sit when stacked. Inline, the bar fills the rest of the line either way. */
  readonly align: "Start" | "Center";
}) {
  const progress = run.state._tag === "Running" ? run.state.progress : null;
  const fraction = progressFraction(progress);

  return (
    <span
      title={progress ?? undefined}
      className={`min-w-0 text-sync ${layout === "Inline" ? "flex items-center gap-2" : "block"}`}
    >
      <span
        className={`flex min-w-0 items-center gap-1.5 ${align === "Center" ? "justify-center" : ""}`}
      >
        <Spinner />
        <span className="truncate">{describeActiveRunBriefly(run)}</span>
      </span>
      {fraction !== null && (
        <>
          <span
            aria-hidden="true"
            className={`block h-1 overflow-hidden rounded-full bg-sync-soft ${layout === "Inline" ? "min-w-8 flex-1" : "mt-1.5"}`}
          >
            <span
              className="block h-full rounded-full bg-sync motion-safe:transition-[width] motion-safe:duration-700"
              style={{ width: `${fraction * 100}%` }}
            />
          </span>
          <span className="sr-only">, {Math.round(fraction * 100)}% done</span>
        </>
      )}
    </span>
  );
}
