import { useId } from "react";

import {
  CircleDashedIcon,
  FolderGit2Icon,
  GitForkIcon,
  MessageCircleQuestionIcon,
} from "lucide-react";

import { folderName } from "@/ui/folderName.ts";
import { ProjectIcon } from "@/ui/ProjectIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";

import { byUrgency, projectsAt, threadsAt } from "../../t3Code/t3CodeLookup.ts";
import { threadStateWords } from "../../t3Code/T3CodeNotices.tsx";
import { workingTreesOf } from "../workingTrees.ts";
import { ShortList } from "./PanelSection.tsx";

import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeProject, T3CodeThread } from "@fleetfrog/protocol/domain/t3Code";

import type { CloneOutline, WorkingTree } from "../workingTrees.ts";

function ThreadStatus({ thread }: { readonly thread: T3CodeThread }) {
  switch (thread.state) {
    case "Working":
      return (
        <span className="flex shrink-0 items-center gap-1.5 font-medium text-sync">
          <CircleDashedIcon aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          {threadStateWords.Working}
        </span>
      );
    case "Waiting":
      return (
        <span className="flex shrink-0 items-center gap-1.5 font-medium text-sync">
          <MessageCircleQuestionIcon aria-hidden="true" className="size-4" />
          {threadStateWords.Waiting}
        </span>
      );
    case "Idle":
      return (
        <span className="shrink-0 text-ink-muted tabular-nums">
          <RelativeTime at={thread.updatedAt} format="age" />
        </span>
      );

    default: {
      const _exhaustive: never = thread.state;

      return _exhaustive;
    }
  }
}

function ThreadCard({
  thread,
  tree,
  folder,
  project,
  repository,
  onChoosePath,
}: {
  readonly thread: T3CodeThread;
  readonly tree: WorkingTree;
  readonly folder: string | null;
  readonly project: T3CodeProject | undefined;
  readonly repository: Repository;
  readonly onChoosePath: (path: string) => void;
}) {
  const icon = project?.icon ?? repository.icon;
  const FolderIcon = tree.kind === "Main" ? FolderGit2Icon : GitForkIcon;
  const id = useId();

  const content = (
    <>
      <span id={`${id}-status`} className="flex items-center gap-2 text-[13px]">
        <span className="flex min-w-0 flex-1 items-center gap-2 text-ink-muted">
          {icon !== null && <ProjectIcon icon={icon} />}
          <span className="truncate">{project?.title ?? repository.label}</span>
        </span>
        <ThreadStatus thread={thread} />
      </span>
      <span className="mt-1 line-clamp-2 font-medium text-ink">{thread.title}</span>
      <span id={`${id}-place`} className="mt-1 flex items-center gap-2 text-[13px] text-ink-muted">
        <span className="min-w-0 flex-1 truncate">{tree.branch ?? folderName(tree.path)}</span>
        {folder !== null && (
          <span className="flex max-w-36 shrink-0 items-center gap-1" title={tree.path}>
            <FolderIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{folder}</span>
          </span>
        )}
      </span>
    </>
  );

  const card = "block w-full rounded-xl bg-fill px-3 py-2.5 text-start";

  return (
    <li>
      {tree.entry === null ? (
        <div className={card}>{content}</div>
      ) : (
        <button
          type="button"
          onClick={() => onChoosePath(tree.path)}
          aria-label={`Show the working tree for ${thread.title}`}
          aria-describedby={`${id}-status ${id}-place`}
          className={`${card} hover:bg-fill-hover`}
        >
          {content}
        </button>
      )}
    </li>
  );
}

export function T3CodeTab({
  repository,
  machine,
  clones,
  onChoosePath,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly clones: ReadonlyArray<CloneOutline>;
  readonly onChoosePath: (path: string) => void;
}) {
  const trees = clones.flatMap(workingTreesOf);

  const projects = projectsAt(machine, [
    ...clones.map(({ path }) => path),
    ...trees.map(({ path }) => path),
  ]);

  const autoPulled = projects.filter(({ autoPull }) => autoPull);

  const cards = trees
    .flatMap((tree) => threadsAt(machine, tree.path).map((thread) => ({ thread, tree })))
    .toSorted((left, right) => byUrgency(left.thread, right.thread));

  const quiet = projects.filter(({ id }) => !cards.some(({ thread }) => thread.projectId === id));

  return (
    <div className="space-y-3">
      {autoPulled.map((project) => (
        <p key={project.id} className="px-1.5 text-[13px] text-ink-muted">
          T3 Code pulls {project.title} automatically.
        </p>
      ))}
      {cards.length > 0 && (
        <ShortList
          items={cards}
          total={cards.length}
          noun="threads"
          listClassName="space-y-2"
          footerClassName="px-1.5"
          render={({ thread, tree }) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              tree={tree}
              folder={tree.kind === "Linked" || clones.length > 1 ? folderName(tree.path) : null}
              project={projects.find(({ id }) => id === thread.projectId)}
              repository={repository}
              onChoosePath={onChoosePath}
            />
          )}
        />
      )}
      {(cards.length === 0 || quiet.length > 0) && (
        <p className="px-1.5 text-sm text-ink-muted">
          {quiet.length === 0
            ? "No T3 Code threads changed here in the last two weeks."
            : `No threads in T3 Code's ${quiet.map(({ title }) => title).join(" and ")} changed in the last two weeks.`}
        </p>
      )}
    </div>
  );
}
