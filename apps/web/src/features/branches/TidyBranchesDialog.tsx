import { useState } from "react";

import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { plural } from "@/ui/plural.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { useStartBatch } from "../actions/useStartBatch.ts";
import { isMerged } from "./branchTidying.ts";

import type { Checkout, GitStatus } from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

import type { TidyCandidate } from "./branchTidying.ts";

interface Group {
  readonly title: string;
  readonly description: string;
  readonly candidates: ReadonlyArray<TidyCandidate>;
  readonly tone: "normal" | "warning";
}

/** What the list says about a branch beyond its last commit, when there's more to say. */
function detail({ standing }: TidyCandidate): string | null {
  if (standing._tag === "MergedPullRequest") {
    return `Merged in #${standing.pullRequest.number}`;
  }

  return standing._tag === "LocalOnly" ? `${plural(standing.commits, "commit")} only here` : null;
}

/**
 * Chooses branches to move to the trash, grouped by what deleting them would lose. Merged branches
 * start selected; the rest must be chosen one by one.
 */
export function TidyBranchesDialog({
  repository,
  machine,
  checkout,
  git,
  candidates,
  onClose,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly git: GitStatus;
  readonly candidates: ReadonlyArray<TidyCandidate>;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(candidates.filter(isMerged).map(({ name }) => name)),
  );
  const defaultBranch = git.defaultBranch ?? checkout.github?.defaultBranch ?? "the default branch";
  const groups: ReadonlyArray<Group> = [
    {
      title: "Merged",
      description: `Their commits are in ${defaultBranch}.`,
      candidates: candidates.filter(({ standing }) => standing._tag === "Merged"),
      tone: "normal",
    },
    {
      title: "Merged pull request",
      description:
        "A pull request from each was merged, such as by squashing, and the branch hasn't changed since.",
      candidates: candidates.filter(({ standing }) => standing._tag === "MergedPullRequest"),
      tone: "normal",
    },
    {
      title: "Pushed, not merged",
      description: "Their commits are on the remote, so deleting them here loses nothing.",
      candidates: candidates.filter(({ standing }) => standing._tag === "Pushed"),
      tone: "normal",
    },
    {
      title: "Only on this machine",
      description: "Some of their commits exist nowhere else.",
      candidates: candidates.filter(({ standing }) => standing._tag === "LocalOnly"),
      tone: "warning",
    },
  ];
  const selected = candidates.filter(({ name }) => chosen.has(name));

  const toggle = (names: ReadonlyArray<string>, on: boolean) =>
    setChosen((previous) => {
      const next = new Set(previous);

      for (const name of names) {
        if (on) {
          next.add(name);
        } else {
          next.delete(name);
        }
      }

      return next;
    });

  return (
    <Dialog title={`Tidy branches in ${repository.label}`} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();

          const [first, ...rest] = selected.map(({ name, tip }) => ({ name, sha: tip.sha }));

          if (first !== undefined) {
            start(
              {
                _tag: "Targeted",
                runs: [
                  {
                    machineId: machine.id,
                    request: {
                      _tag: "DeleteBranches",
                      path: checkout.path,
                      branches: [first, ...rest],
                    },
                  },
                ],
              },
              onClose,
            );
          }
        }}
        className="space-y-4 text-sm"
      >
        <p>
          Deleted branches go to the Trash on {machineLabel(machine)}, where you can restore them
          until you empty it. A branch with new commits since the last scan, or one a worktree has
          checked out, is kept, and the rest are deleted.
        </p>
        {candidates.length === 0 && (
          <p className="rounded-md border border-line bg-canvas px-3 py-2 text-ink-muted">
            There are no branches to tidy. The current branch, the default branch and branches
            checked out in other worktrees can't be deleted.
          </p>
        )}
        <div className="max-h-[55vh] space-y-4 overflow-y-auto">
          {groups
            .filter(({ candidates: members }) => members.length > 0)
            .map((group) => {
              const names = group.candidates.map(({ name }) => name);
              const allChosen = names.every((name) => chosen.has(name));

              return (
                <fieldset key={group.title} className="min-w-0">
                  {/* The legend names the group for screen readers; the heading row shows it. */}
                  <legend className="sr-only">{group.title}</legend>
                  <div className="mb-2 flex items-baseline gap-2">
                    <span
                      aria-hidden="true"
                      className={`font-medium ${group.tone === "warning" ? "text-changes" : ""}`}
                    >
                      {group.title}
                    </span>
                    <span className="text-xs text-ink-muted tabular-nums">
                      {group.candidates.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggle(names, !allChosen)}
                      aria-label={`${allChosen ? "Select none" : "Select all"} in ${group.title}`}
                      className="ms-auto text-xs text-accent-text underline-offset-2 hover:underline"
                    >
                      {allChosen ? "Select none" : "Select all"}
                    </button>
                  </div>
                  <p className="mb-2 text-ink-muted">{group.description}</p>
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {group.candidates.map((candidate) => {
                      const extra = detail(candidate);

                      return (
                        <li key={candidate.name}>
                          <label className="flex items-start gap-2.5 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={chosen.has(candidate.name)}
                              onChange={(event) =>
                                toggle([candidate.name], event.currentTarget.checked)
                              }
                              className="mt-0.5 size-4 shrink-0 accent-accent"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-mono text-[13px] break-all">
                                {candidate.name}
                              </span>
                              <span className="block truncate text-xs text-ink-muted">
                                {extra !== null && (
                                  <span
                                    className={
                                      candidate.standing._tag === "LocalOnly" ? "text-changes" : ""
                                    }
                                  >
                                    {extra} ·{" "}
                                  </span>
                                )}
                                {candidate.tip.subject} ·{" "}
                                <RelativeTime at={candidate.tip.committedAt} />
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              );
            })}
        </div>
        {git.branches.total > git.branches.items.length && (
          <p className="text-ink-muted">
            {plural(git.branches.total - git.branches.items.length, "branch", "branches")} weren't
            listed by the agent and aren't shown.
          </p>
        )}
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          {candidates.length > 0 && (
            <Button type="submit" tone="danger" disabled={pending || selected.length === 0}>
              {pending ? "Starting…" : `Delete ${plural(selected.length, "branch", "branches")}`}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
