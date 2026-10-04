import { BotIcon, FolderXIcon } from "lucide-react";

import type { ReactNode } from "react";

import type { T3CodeProject, T3CodeThread } from "@fleetfrog/protocol/domain/t3Code";

function Notice({ icon, children }: { readonly icon: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-sync/30 bg-sync-soft px-3 py-2.5 text-sm">
      {icon}
      <div className="min-w-0 space-y-1 break-words">{children}</div>
    </div>
  );
}

function quoted(threads: ReadonlyArray<{ readonly title: string }>): string {
  const titles = threads.map(({ title }) => `“${title}”`);

  return titles.length < 3
    ? titles.join(" and ")
    : `${titles.slice(0, 2).join(", ")} and ${threads.length - 2} more`;
}

export function threadDoing(thread: T3CodeThread): string {
  return thread.state === "Waiting" ? "is waiting for you" : "is working";
}

export function BusyThreadsNotice({
  threads,
  where,
  consequence,
}: {
  readonly threads: ReadonlyArray<T3CodeThread>;
  readonly where: string;
  readonly consequence: string;
}) {
  const [first] = threads;

  if (first === undefined) {
    return null;
  }

  return (
    <Notice icon={<BotIcon aria-hidden="true" className="mt-0.5 text-sync" />}>
      <p>
        {threads.length === 1
          ? `T3 Code ${threadDoing(first)} ${where}, on ${quoted(threads)}.`
          : `T3 Code has ${threads.length} threads in progress ${where}: ${quoted(threads)}.`}
      </p>
      <p className="text-ink-muted">{consequence}</p>
    </Notice>
  );
}

export function ProjectFolderNotice({
  projects,
  consequence,
}: {
  readonly projects: ReadonlyArray<T3CodeProject>;
  readonly consequence: string;
}) {
  if (projects.length === 0) {
    return null;
  }

  return (
    <Notice icon={<FolderXIcon aria-hidden="true" className="mt-0.5 text-sync" />}>
      <p>
        {projects.length === 1
          ? `T3 Code's project ${quoted(projects)} opens this folder.`
          : `T3 Code's projects ${quoted(projects)} open these folders.`}{" "}
        {consequence}
      </p>
    </Notice>
  );
}

export function WorktreeThreadNote({ thread }: { readonly thread: T3CodeThread | undefined }) {
  if (thread === undefined) {
    return null;
  }

  return (
    <p className="flex items-start gap-2 text-ink-muted">
      <BotIcon aria-hidden="true" className="mt-0.5" />
      <span>
        T3 Code made this worktree for its thread “{thread.title}”
        {thread.archived ? ", which is archived." : "."}
      </span>
    </p>
  );
}
