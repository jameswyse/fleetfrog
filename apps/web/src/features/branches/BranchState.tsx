import { Chip } from "@/ui/Chip.tsx";
import { plural } from "@/ui/plural.ts";

import { Glyph } from "../projects/CellContent.tsx";
import { branchStanding } from "./branchTidying.ts";

import type { LocalBranch, MergedPullRequest, Upstream } from "@fleetfrog/protocol/domain/checkout";

export function SyncGlyphs({ ahead, behind }: { readonly ahead: number; readonly behind: number }) {
  return (
    <>
      {ahead > 0 && (
        <Glyph
          className="text-sync"
          symbol={`↑${ahead}`}
          meaning={`${plural(ahead, "commit")} to push`}
        />
      )}
      {behind > 0 && (
        <Glyph
          className="text-sync"
          symbol={`↓${behind}`}
          meaning={`${plural(behind, "commit")} to pull`}
        />
      )}
    </>
  );
}

export function UpstreamState({ upstream }: { readonly upstream: Upstream | null }) {
  if (upstream === null) {
    return <Chip tone="neutral">No upstream</Chip>;
  }

  if (upstream.gone) {
    return <Chip tone="changes">Remote deleted</Chip>;
  }

  if (upstream.ahead + upstream.behind === 0) {
    return (
      <Glyph
        className="text-xs text-clean"
        symbol="✓"
        meaning={`Up to date with ${upstream.name}`}
      />
    );
  }

  return (
    <span className="flex gap-1.5 text-xs font-medium tabular-nums">
      <SyncGlyphs ahead={upstream.ahead} behind={upstream.behind} />
    </span>
  );
}

export function BranchState({
  branch,
  merged,
}: {
  readonly branch: LocalBranch;
  readonly merged: ReadonlyArray<MergedPullRequest>;
}) {
  const standing =
    branch.tip === null ? null : branchStanding({ ...branch, tip: branch.tip }, merged);

  if (standing?._tag === "Merged") {
    return <Chip tone="clean">Merged</Chip>;
  }

  if (standing?._tag === "MergedPullRequest") {
    return <Chip tone="clean">Merged #{standing.pullRequest.number}</Chip>;
  }

  if (standing?._tag === "LocalOnly" && standing.commits > 0) {
    return <Chip tone="changes">{standing.commits} unpushed</Chip>;
  }

  return <UpstreamState upstream={branch.upstream} />;
}
