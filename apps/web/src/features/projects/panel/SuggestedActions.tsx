import { CloudOffIcon, GitMergeIcon, TriangleAlertIcon } from "lucide-react";

import { useRuns } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { folderName } from "@/ui/folderName.ts";
import { plural } from "@/ui/plural.ts";

import { pullSkipReason } from "../../actions/actionAvailability.ts";
import { activeRunFor } from "../../actions/runLookup.ts";
import { useStartBatch } from "../../actions/useStartBatch.ts";
import { busyThreads } from "../../t3Code/t3CodeLookup.ts";
import { workingTreesOf } from "../workingTrees.ts";

import type { ReactNode } from "react";

import type { Machine } from "@fleetfrog/protocol/domain/fleet";

import type { CloneOutline, WorkingTree } from "../workingTrees.ts";

function problemOf(tree: WorkingTree): string | null {
  if (tree.entry?.checkout.status._tag === "Failed") {
    return "couldn't be read";
  }

  if (tree.git === null) {
    return null;
  }

  if (tree.git.changed.items.some(({ staged, unstaged }) => staged === "U" || unstaged === "U")) {
    return "has merge conflicts";
  }

  return tree.git.operation === null ? null : `has a ${tree.git.operation} in progress`;
}

function Suggestion({
  icon,
  tone = "",
  children,
  action,
}: {
  readonly icon: ReactNode;
  readonly tone?: string;
  readonly children: ReactNode;
  readonly action: ReactNode;
}) {
  return (
    <li className={`flex items-center gap-2.5 px-3 py-2 text-sm ${tone}`}>
      <span aria-hidden="true" className="flex shrink-0">
        {icon}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </li>
  );
}

function treeName(tree: WorkingTree): ReactNode {
  return tree.branch === null ? (
    folderName(tree.path)
  ) : (
    <span className="font-mono text-[13px] font-medium">{tree.branch}</span>
  );
}

export function SuggestedActions({
  machine,
  clones,
  onChoosePath,
  onCleanUp,
}: {
  readonly machine: Machine;
  readonly clones: ReadonlyArray<CloneOutline>;
  readonly onChoosePath: (path: string) => void;
  readonly onCleanUp: (() => void) | null;
}) {
  const runs = useRuns();
  const { start, pending, failure } = useStartBatch();
  const trees = clones.flatMap(workingTreesOf);
  const finished = trees.filter(({ lifecycle }) => lifecycle._tag === "Finished");

  const remoteGone = trees.filter(
    ({ git, lifecycle }) =>
      lifecycle._tag !== "Finished" &&
      git?.head._tag === "Branch" &&
      git.head.upstream?.gone === true,
  );

  const problems = trees.flatMap((tree) => {
    const problem = problemOf(tree);

    return problem === null ? [] : [{ tree, problem }];
  });

  const behind = trees.flatMap((tree) => {
    const checkout = tree.entry?.checkout;
    const upstream = tree.git?.head._tag === "Branch" ? tree.git.head.upstream : null;

    return checkout === undefined ||
      upstream === null ||
      upstream.gone ||
      upstream.behind === 0 ||
      pullSkipReason(machine, checkout) !== null ||
      busyThreads(machine, [checkout.path]).length > 0
      ? []
      : [{ tree, checkout, behind: upstream.behind }];
  });

  if (
    problems.length + behind.length + remoteGone.length === 0 &&
    (finished.length === 0 || onCleanUp === null)
  ) {
    return null;
  }

  return (
    <section aria-label="Suggested actions" className="rounded-xl border border-line">
      <ul className="divide-y divide-line">
        {problems.map(({ tree, problem }) => (
          <Suggestion
            key={`problem:${tree.path}`}
            icon={<TriangleAlertIcon />}
            tone="text-danger"
            action={
              <Button tone="quiet" className="min-h-7 px-2" onClick={() => onChoosePath(tree.path)}>
                Show
              </Button>
            }
          >
            {treeName(tree)} {problem}
          </Suggestion>
        ))}
        {behind.map(({ tree, checkout, behind: commits }) => (
          <Suggestion
            key={`behind:${tree.path}`}
            icon={<span className="text-xs font-semibold text-sync tabular-nums">↓{commits}</span>}
            action={
              <Button
                className="min-h-7 px-2"
                disabled={
                  pending || activeRunFor(runs, { machineId: machine.id, checkout }) !== undefined
                }
                onClick={() =>
                  start({
                    _tag: "Pull",
                    scope: { _tag: "Checkout", machineId: machine.id, path: checkout.path },
                  })
                }
              >
                Pull
              </Button>
            }
          >
            {treeName(tree)} is {plural(commits, "commit")} behind
          </Suggestion>
        ))}
        {remoteGone.map((tree) => (
          <Suggestion
            key={`gone:${tree.path}`}
            icon={<CloudOffIcon />}
            tone="text-changes"
            action={
              <Button tone="quiet" className="min-h-7 px-2" onClick={() => onChoosePath(tree.path)}>
                Show
              </Button>
            }
          >
            {treeName(tree)}'s remote branch was deleted, and no merge was found
          </Suggestion>
        ))}
        {finished.length > 0 && onCleanUp !== null && (
          <Suggestion
            icon={<GitMergeIcon className="text-clean" />}
            action={
              <Button className="min-h-7 px-2" onClick={onCleanUp}>
                Clean up…
              </Button>
            }
          >
            {plural(finished.length, "worktree")} merged and clean
          </Suggestion>
        )}
      </ul>
      {failure !== null && (
        <p role="status" className="border-t border-line px-3 py-2 text-sm text-danger">
          {failure}
        </p>
      )}
    </section>
  );
}
