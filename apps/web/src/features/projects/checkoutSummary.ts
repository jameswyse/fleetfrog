import type { Checkout, PullRequest, Upstream } from "@fleetfrog/protocol/domain/checkout";
import type { MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";

export type CheckoutSummary =
  | { readonly _tag: "Unreadable"; readonly message: string }
  | {
      readonly _tag: "Read";
      readonly branch: string;
      readonly changed: number;
      readonly untracked: number;
      readonly stashes: number;
      readonly conflicts: boolean;
      readonly ahead: number;
      readonly behind: number;
      readonly upstream: "tracking" | "none" | "gone";
      /** GitHub's default branch has commits this checkout has not fetched. */
      readonly remoteMoved: boolean;
      readonly pullRequest: PullRequest | null;
      readonly hasChanges: boolean;
      readonly outOfSync: boolean;
    };

function trackingState(upstream: Upstream | null): "tracking" | "none" | "gone" {
  if (upstream === null) {
    return "none";
  }

  return upstream.gone ? "gone" : "tracking";
}

export function summariseCheckout(checkout: Checkout): CheckoutSummary {
  if (checkout.status._tag === "Failed") {
    return { _tag: "Unreadable", message: checkout.status.message };
  }

  const { git } = checkout.status;
  const { head } = git;
  const upstream = head._tag === "Branch" ? head.upstream : null;
  const branch =
    head._tag === "Detached"
      ? `detached at ${git.lastCommit?.sha.slice(0, 7) ?? "unknown"}`
      : head.name;
  const remoteMoved =
    checkout.github !== null &&
    checkout.github.trackingSha !== null &&
    checkout.github.remoteSha !== checkout.github.trackingSha;
  const ahead = upstream?.ahead ?? 0;
  const behind = upstream?.behind ?? 0;
  const changed = git.changed.total;
  const untracked = git.untracked.total;
  const stashes = git.stashes.total;
  const upstreamState = trackingState(upstream);

  return {
    _tag: "Read",
    branch,
    changed,
    untracked,
    stashes,
    conflicts: git.changed.items.some(({ staged, unstaged }) => staged === "U" || unstaged === "U"),
    ahead,
    behind,
    upstream: upstreamState,
    remoteMoved,
    pullRequest:
      head._tag === "Branch"
        ? (checkout.github?.pullRequests.find((pull) => pull.branch === head.name) ?? null)
        : null,
    hasChanges: changed + untracked + stashes > 0,
    outOfSync: ahead + behind > 0 || upstreamState === "gone" || remoteMoved,
  };
}

export type RepositoryFilter = "all" | "changes" | "out-of-sync";

export function repositoryMatches(options: {
  readonly repository: Repository;
  readonly filter: RepositoryFilter;
  readonly query: string;
}): boolean {
  const query = options.query.trim().toLowerCase();

  // The label may be T3 Code's name for the project, so the repository's own name matches too.
  if (
    query !== "" &&
    ![options.repository.label, options.repository.name].some((name) =>
      name.toLowerCase().includes(query),
    )
  ) {
    return false;
  }

  if (options.filter === "all") {
    return true;
  }

  return options.repository.checkouts.some(({ checkout }) => {
    const summary = summariseCheckout(checkout);

    // An unreadable checkout matches every filter because it needs attention either way.
    if (summary._tag === "Unreadable") {
      return true;
    }

    return options.filter === "changes" ? summary.hasChanges : summary.outOfSync;
  });
}

/** Identifies one checkout in the URL: `<machine id>:<path>`. */
export function checkoutKey({ machineId, checkout }: MachineCheckout): string {
  return `${machineId}:${checkout.path}`;
}
