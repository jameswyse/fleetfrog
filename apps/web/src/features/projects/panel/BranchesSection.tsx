import { GitBranchIcon } from "lucide-react";

import { useRuns } from "@/rpc/hubConnection.ts";
import { clonePath } from "@fleetfrog/protocol/domain/checkout";

import { switchSkipReason } from "../../actions/actionAvailability.ts";
import { activeRunFor } from "../../actions/runLookup.ts";
import { useStartBatch } from "../../actions/useStartBatch.ts";
import { PanelSection, ShortList } from "./PanelSection.tsx";

import type { Checkout, GitStatus, Upstream } from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

function describeUpstream(upstream: Upstream | null): string {
  if (upstream === null) {
    return "No upstream branch";
  }

  if (upstream.gone) {
    return `${upstream.name} was deleted on the remote`;
  }

  const parts = [
    upstream.ahead > 0 && `${upstream.ahead} to push`,
    upstream.behind > 0 && `${upstream.behind} to pull`,
  ].filter(Boolean);

  return `Tracks ${upstream.name}${parts.length > 0 ? `, ${parts.join(", ")}` : ", up to date"}`;
}

function UpstreamState({ upstream }: { readonly upstream: Upstream | null }) {
  if (upstream === null) {
    return <span className="text-ink-muted">no upstream</span>;
  }

  if (upstream.gone) {
    return <span className="text-danger">deleted</span>;
  }

  return upstream.ahead + upstream.behind === 0 ? (
    <span className="text-clean">✓</span>
  ) : (
    <span className="text-sync">
      {upstream.ahead > 0 && `↑${upstream.ahead} `}
      {upstream.behind > 0 && `↓${upstream.behind}`}
    </span>
  );
}

/** The branches the clone's other worktrees on this machine have checked out. */
function branchesInOtherWorktrees(
  repository: Repository,
  machine: Machine,
  checkout: Checkout,
): ReadonlySet<string> {
  return new Set(
    repository.checkouts
      .filter(
        (entry) =>
          entry.machineId === machine.id &&
          entry.checkout.path !== checkout.path &&
          clonePath(entry.checkout) === clonePath(checkout),
      )
      .flatMap(({ checkout: other }) =>
        other.status._tag === "Read" && other.status.git.head._tag === "Branch"
          ? [other.status.git.head.name]
          : [],
      ),
  );
}

/** The checkout's local branches, each with its upstream and a way to switch to it. */
export function BranchesSection({
  repository,
  machine,
  checkout,
  git,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly git: GitStatus;
}) {
  const runs = useRuns();
  const { start, pending, failure } = useStartBatch();
  const { head } = git;
  const current = head._tag === "Detached" ? null : head.name;
  const elsewhere = branchesInOtherWorktrees(repository, machine, checkout);
  const busy = pending || activeRunFor(runs, { machineId: machine.id, checkout }) !== undefined;
  const others = git.branches.items.filter(({ name }) => name !== current && !elsewhere.has(name));
  const reasons = new Map(
    others.map(({ name }) => [name, switchSkipReason(machine, checkout, name)]),
  );
  // When nothing can be switched to, one reason covers every branch.
  const sharedReason = others.every(({ name }) => reasons.get(name) !== null)
    ? (reasons.get(others[0]?.name ?? "") ?? null)
    : null;

  const switchTo = (branch: string) =>
    start({
      _tag: "Targeted",
      runs: [{ machineId: machine.id, request: { _tag: "Switch", path: checkout.path, branch } }],
    });

  return (
    <PanelSection
      title="Local branches"
      icon={GitBranchIcon}
      tone="sync"
      count={git.branches.total}
    >
      <ShortList
        items={git.branches.items}
        total={git.branches.total}
        noun="branches"
        render={(branch) => (
          <li
            key={branch.name}
            className="flex min-h-7 items-center gap-2 text-sm"
            title={describeUpstream(branch.upstream)}
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{branch.name}</span>
            {branch.name === current && (
              <span className="rounded-full bg-sync-soft px-2 text-xs text-sync">current</span>
            )}
            {elsewhere.has(branch.name) && (
              <span className="rounded-full bg-canvas px-2 text-xs text-ink-muted">
                in another worktree
              </span>
            )}
            <span className="shrink-0 text-xs tabular-nums">
              <UpstreamState upstream={branch.upstream} />
            </span>
            <span className="sr-only">, {describeUpstream(branch.upstream)}</span>
            {reasons.get(branch.name) === null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => switchTo(branch.name)}
                aria-label={`Switch to ${branch.name}`}
                className="shrink-0 rounded px-1.5 py-0.5 text-xs text-accent-text hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
              >
                Switch
              </button>
            )}
          </li>
        )}
      />
      {sharedReason !== null && (
        <p className="mt-2 text-xs text-ink-muted">Switching isn't available: {sharedReason}.</p>
      )}
      {failure !== null && (
        <p role="status" className="mt-2 text-sm text-danger">
          {failure}
        </p>
      )}
    </PanelSection>
  );
}
