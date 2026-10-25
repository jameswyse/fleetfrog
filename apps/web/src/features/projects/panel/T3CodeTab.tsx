import { useId } from "react";

import { FolderGit2Icon, GitForkIcon } from "lucide-react";

import { folderName } from "@/ui/folderName.ts";
import { ProjectIcon } from "@/ui/ProjectIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";

import { projectsAt, threadsByUrgency, threadUrgency } from "../../t3Code/t3CodeLookup.ts";
import { threadStateWords } from "../../t3Code/T3CodeNotices.tsx";
import { workingTreesOf } from "../workingTrees.ts";
import { ShortList } from "./PanelSection.tsx";

import type { Machine } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeThread } from "@fleetfrog/protocol/domain/t3Code";

import type { CloneOutline, WorkingTree } from "../workingTrees.ts";

function ThreadGroup({
  tree,
  threads,
  onChoosePath,
}: {
  readonly tree: WorkingTree;
  readonly threads: ReadonlyArray<T3CodeThread>;
  readonly onChoosePath: (path: string) => void;
}) {
  const headingId = useId();
  const Icon = tree.kind === "Main" ? FolderGit2Icon : GitForkIcon;

  return (
    <section aria-labelledby={headingId} className="space-y-1.5">
      <div className="flex items-center gap-2 px-1.5">
        <h3 id={headingId} className="min-w-0 truncate font-mono text-[13px] font-medium">
          {tree.branch ?? folderName(tree.path)}
        </h3>
        <span className="flex-1" />
        {tree.entry !== null && (
          <button
            type="button"
            onClick={() => onChoosePath(tree.path)}
            title={tree.path}
            aria-label={`Show the working tree at ${tree.path}`}
            className="flex max-w-40 shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-accent-text hover:bg-canvas"
          >
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{folderName(tree.path)}</span>
          </button>
        )}
      </div>
      <ShortList
        items={threads}
        total={threads.length}
        noun="threads"
        listClassName="space-y-1 px-1.5"
        render={(thread) => {
          const state = threadStateWords[thread.state];

          return (
            <li key={thread.id} className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={thread.title}>
                {thread.title}
              </span>
              <span
                className={`shrink-0 text-xs ${state === null ? "text-ink-muted" : "font-medium text-sync"}`}
              >
                {state ?? <RelativeTime at={thread.updatedAt} />}
              </span>
            </li>
          );
        }}
      />
    </section>
  );
}

export function T3CodeTab({
  machine,
  clones,
  onChoosePath,
}: {
  readonly machine: Machine;
  readonly clones: ReadonlyArray<CloneOutline>;
  readonly onChoosePath: (path: string) => void;
}) {
  const projects = projectsAt(
    machine,
    clones.map(({ path }) => path),
  );

  const groups = clones
    .flatMap(workingTreesOf)
    .flatMap((tree) => {
      const threads = threadsByUrgency(machine, tree.path);
      const [first] = threads;

      return first === undefined ? [] : [{ tree, threads, urgency: threadUrgency[first.state] }];
    })
    .toSorted(
      (left, right) => left.urgency - right.urgency || right.tree.lastActive - left.tree.lastActive,
    );

  return (
    <div className="space-y-5">
      {projects.map((project) => (
        <p key={project.id} className="flex items-center gap-2 px-1.5 text-sm">
          {project.icon !== null && <ProjectIcon icon={project.icon} />}
          <span className="min-w-0 flex-1 truncate font-medium">{project.title}</span>
          {project.autoPull && (
            <span className="shrink-0 text-xs text-ink-muted">Pulls automatically</span>
          )}
        </p>
      ))}
      {groups.length === 0 && (
        <p className="px-1.5 text-sm text-ink-muted">
          No T3 Code threads changed here in the last two weeks.
        </p>
      )}
      {groups.map(({ tree, threads }) => (
        <ThreadGroup key={tree.path} tree={tree} threads={threads} onChoosePath={onChoosePath} />
      ))}
    </div>
  );
}
