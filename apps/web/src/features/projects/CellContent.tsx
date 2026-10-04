import { plural } from "@/ui/plural.ts";

import type { ReactNode } from "react";

import type { CellProblem, CellSummary } from "./cellSummary.ts";

export const problemWords = {
  Unreadable: "A checkout couldn't be read",
  Conflicts: "Merge conflicts",
  UpstreamGone: "The upstream branch was deleted",
} satisfies Record<CellProblem, string>;

export function Glyph({
  className,
  symbol,
  meaning,
}: {
  readonly className: string;
  readonly symbol: string;
  readonly meaning: string;
}) {
  return (
    <span className={className} title={meaning}>
      <span aria-hidden="true">{symbol}</span>
      <span className="sr-only">{meaning}</span>
    </span>
  );
}

export function CellState({ cell }: { readonly cell: CellSummary }) {
  const glyphs = [
    cell.problem !== null && (
      <Glyph
        key="problem"
        className="text-danger"
        symbol="!"
        meaning={problemWords[cell.problem]}
      />
    ),
    cell.changes > 0 && (
      <Glyph
        key="changes"
        className="text-changes"
        symbol={`●${cell.changes}`}
        meaning={plural(cell.changes, "changed file")}
      />
    ),
    cell.ahead > 0 && (
      <Glyph
        key="ahead"
        className="text-sync"
        symbol={`↑${cell.ahead}`}
        meaning={`${plural(cell.ahead, "commit")} to push`}
      />
    ),
    cell.behind > 0 && (
      <Glyph
        key="behind"
        className="text-sync"
        symbol={`↓${cell.behind}`}
        meaning={`${plural(cell.behind, "commit")} to pull`}
      />
    ),
    cell.remoteMoved && cell.behind === 0 && (
      <Glyph
        key="remote"
        className="text-sync"
        symbol="↓"
        meaning="New commits on GitHub, not fetched yet"
      />
    ),
  ].filter(Boolean);

  return glyphs.length === 0 ? (
    <Glyph className="text-clean" symbol="✓" meaning="Clean and up to date" />
  ) : (
    <>{glyphs}</>
  );
}

export function describeHoldings(cell: CellSummary): string {
  return [
    cell.branches > 1 && plural(cell.branches, "branch", "branches"),
    cell.worktrees > 0 && plural(cell.worktrees, "worktree"),
    cell.clones > 1 && plural(cell.clones, "clone"),
    cell.stashes > 0 && plural(cell.stashes, "stash", "stashes"),
    cell.pullRequests > 0 && plural(cell.pullRequests, "pull request"),
  ]
    .filter((part) => part !== false)
    .join(" · ");
}

export function CellContent({
  cell,
  activity,
  align,
}: {
  readonly cell: CellSummary;
  readonly activity: ReactNode;
  readonly align: "Start" | "Center";
}) {
  const holdings = describeHoldings(cell);
  const branch = cell.branch ?? "Unreadable";

  return (
    <>
      <span
        className={`flex min-w-0 items-baseline gap-2 ${align === "Center" ? "justify-center" : ""}`}
      >
        <span
          className={`min-w-0 truncate font-mono text-[13px] ${cell.offDefault ? "font-medium text-ink" : "text-ink-muted"}`}
          title={cell.offDefault ? `${branch}, not the default branch` : branch}
        >
          {branch}
        </span>
        {cell.offDefault && <span className="sr-only">, not the default branch,</span>}
        <span className="flex shrink-0 items-baseline gap-1.5 text-xs font-medium tabular-nums">
          <CellState cell={cell} />
        </span>
      </span>
      {activity ??
        (holdings !== "" && (
          <span className="mt-0.5 block truncate text-xs text-ink-muted" title={holdings}>
            {holdings}
          </span>
        ))}
    </>
  );
}
