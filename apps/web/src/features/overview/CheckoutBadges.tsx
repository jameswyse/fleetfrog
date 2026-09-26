import { Chip } from "@/ui/Chip.tsx";

import type { CheckoutSummary } from "./checkoutSummary.ts";

function count(value: number, singular: string, plural = singular) {
  return `${value} ${value === 1 ? singular : plural}`;
}

/** Every notable fact about a checkout as a labelled chip, or "Clean" when there is none. */
export function CheckoutBadges({ summary }: { readonly summary: CheckoutSummary }) {
  if (summary._tag === "Unreadable") {
    return <Chip tone="danger">Unreadable</Chip>;
  }

  const chips = [
    summary.conflicts && (
      <Chip key="conflicts" tone="danger">
        Conflicts
      </Chip>
    ),
    summary.changed > 0 && (
      <Chip key="changed" tone="changes">
        {count(summary.changed, "changed")}
      </Chip>
    ),
    summary.untracked > 0 && (
      <Chip key="untracked" tone="changes">
        {count(summary.untracked, "untracked")}
      </Chip>
    ),
    summary.stashes > 0 && (
      <Chip key="stashes" tone="neutral">
        {count(summary.stashes, "stash", "stashes")}
      </Chip>
    ),
    summary.ahead > 0 && (
      <Chip key="ahead" tone="sync">
        {summary.ahead} to push
      </Chip>
    ),
    summary.behind > 0 && (
      <Chip key="behind" tone="sync">
        {summary.behind} to pull
      </Chip>
    ),
    summary.upstream === "gone" && (
      <Chip key="gone" tone="danger">
        Upstream deleted
      </Chip>
    ),
    summary.remoteMoved && (
      <Chip key="remote" tone="sync">
        Remote updated
      </Chip>
    ),
    summary.pullRequest !== null && (
      <Chip key="pull" tone="neutral">
        PR #{summary.pullRequest.number}
        {summary.pullRequest.draft ? " draft" : ""}
      </Chip>
    ),
  ].filter(Boolean);

  return chips.length === 0 ? <Chip tone="clean">Clean</Chip> : <>{chips}</>;
}
