import { useState } from "react";

import { ArrowLeftRightIcon, GitBranchIcon, GitForkIcon } from "lucide-react";

import { useRuns } from "@/rpc/hubConnection.ts";
import { folderName } from "@/ui/folderName.ts";
import { Menu, MenuItem } from "@/ui/Menu.tsx";

import { hiddenTrashReason, switchSkipReason } from "../actions/actionAvailability.ts";
import { activeRunFor } from "../actions/runLookup.ts";
import { useStartBatch } from "../actions/useStartBatch.ts";
import { BusyCheckoutDialog } from "../t3Code/BusyCheckoutDialog.tsx";
import { busyThreads } from "../t3Code/t3CodeLookup.ts";
import { BranchState } from "./BranchState.tsx";
import { branchesInOtherWorktrees } from "./branchTidying.ts";
import { SwitchBranchDialog } from "./SwitchBranchDialog.tsx";

import type { Checkout, GitStatus, LocalBranch } from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

function recentFirst(left: LocalBranch, right: LocalBranch): number {
  return (
    (right.tip?.committedAt.epochMilliseconds ?? 0) - (left.tip?.committedAt.epochMilliseconds ?? 0)
  );
}

export function SwitchBranchMenu({
  repository,
  machine,
  checkout,
  git,
  onGoTo,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly git: GitStatus;
  readonly onGoTo: (path: string) => void;
}) {
  const runs = useRuns();
  const [switching, setSwitching] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { start, pending, failure } = useStartBatch();
  const agents = busyThreads(machine, [checkout.path]);
  const current = git.head._tag === "Detached" ? null : git.head.name;
  const elsewhere = branchesInOtherWorktrees({ repository, machineId: machine.id, checkout });
  const busy = pending || activeRunFor(runs, { machineId: machine.id, checkout }) !== undefined;
  const merged = checkout.github?.mergedPullRequests ?? [];
  const others = git.branches.items.filter(({ name }) => name !== current).toSorted(recentFirst);
  const free = others.filter(({ name }) => !elsewhere.has(name));
  const taken = others.filter(({ name }) => elsewhere.has(name));

  const reasons = new Map(
    free.map(({ name }) => [name, switchSkipReason(machine, checkout, name)]),
  );

  const [firstReason] = reasons.values();

  const sharedReason =
    firstReason !== undefined && [...reasons.values()].every((reason) => reason === firstReason)
      ? firstReason
      : null;

  const switchNow = (branch: string, onStarted?: () => void) =>
    start(
      {
        _tag: "Targeted",
        runs: [
          {
            machineId: machine.id,
            request: {
              _tag: "Switch",
              path: checkout.path,
              branch,
              stashChanges: false,
              discardChanges: false,
            },
          },
        ],
      },
      onStarted,
    );

  const switchTo = (branch: string) => {
    if (git.changed.total > 0) {
      setSwitching(branch);
    } else if (agents.length > 0) {
      setConfirming(branch);
    } else {
      switchNow(branch);
    }
  };

  if (others.length === 0) {
    return null;
  }

  return (
    <>
      <Menu
        label="Switch this working tree to another branch"
        trigger={{
          content: (
            <>
              <ArrowLeftRightIcon aria-hidden="true" className="size-4" />
              Switch branch
            </>
          ),
          className:
            "inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-raised",
        }}
      >
        {(close) => (
          <div className="max-h-80 overflow-y-auto">
            {free.length > 0 && (
              <p className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-muted">Switch to</p>
            )}
            {sharedReason !== null && (
              <p className="px-3 pb-2 text-xs text-ink-muted">
                Switching isn't available: {sharedReason}.
              </p>
            )}
            {free.map((branch) => {
              const reason = reasons.get(branch.name) ?? null;

              return (
                <MenuItem
                  key={branch.name}
                  icon={<GitBranchIcon />}
                  disabled={busy || reason !== null}
                  title={reason ?? undefined}
                  onClick={() => {
                    close();
                    switchTo(branch.name);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                    {branch.name}
                  </span>
                  <BranchState branch={branch} merged={merged} />
                </MenuItem>
              );
            })}
            {taken.length > 0 && (
              <p className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-muted">
                Checked out in another worktree
              </p>
            )}
            {taken.map((branch) => {
              const path = elsewhere.get(branch.name) ?? "";

              return (
                <MenuItem
                  key={branch.name}
                  icon={<GitForkIcon />}
                  onClick={() => {
                    close();
                    onGoTo(path);
                  }}
                  aria-label={`Show the worktree at ${path}, which has ${branch.name} checked out`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink-muted">
                    {branch.name}
                  </span>
                  <span className="max-w-24 shrink-0 truncate text-xs text-accent-text">
                    {folderName(path)}
                  </span>
                </MenuItem>
              );
            })}
          </div>
        )}
      </Menu>
      {failure !== null && (
        <p role="status" className="w-full text-sm text-danger">
          {failure}
        </p>
      )}
      {switching !== null && (
        <SwitchBranchDialog
          machine={machine}
          checkout={checkout}
          branch={switching}
          changedFiles={git.changed.total}
          discardUnavailable={hiddenTrashReason(repository, machine, checkout)}
          onClose={() => setSwitching(null)}
        />
      )}
      {confirming !== null && (
        <BusyCheckoutDialog
          title={`Switch to ${confirming} while T3 Code is working?`}
          threads={agents}
          consequence="Switching changes the files under it to another branch's, and its agent may carry on as if it hadn't."
          confirmLabel="Switch anyway"
          pending={pending}
          failure={failure}
          onConfirm={() => switchNow(confirming, () => setConfirming(null))}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  );
}
