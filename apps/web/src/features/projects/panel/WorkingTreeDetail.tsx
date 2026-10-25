import { GitPullRequestIcon, TriangleAlertIcon } from "lucide-react";

import { PathText } from "@/ui/PathText.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";

import { busyThreads } from "../../t3Code/t3CodeLookup.ts";
import { BusyThreadsNotice } from "../../t3Code/T3CodeNotices.tsx";
import { CheckoutActions } from "./CheckoutActions.tsx";
import { ShortList } from "./PanelSection.tsx";

import type {
  ChangedFile,
  Checkout,
  FileState,
  GitStatus,
} from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

import type { MergeProof } from "../../branches/branchTidying.ts";
import type { WorkingTree, WorkingTreeProblem } from "../workingTrees.ts";

const stateWords = {
  ".": "",
  M: "modified",
  T: "type changed",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "conflicted",
} satisfies Record<FileState, string>;

function describeChange(file: ChangedFile): string {
  const staged = stateWords[file.staged];
  const unstaged = stateWords[file.unstaged];

  return [staged && `${staged}, staged`, unstaged].filter(Boolean).join("; ");
}

const letterTones = new Map([
  ["??", "bg-canvas text-ink-muted"],
  ["U", "bg-danger-soft text-danger"],
  ["D", "bg-danger-soft text-danger"],
  ["A", "bg-clean/15 text-clean"],
]);

function changeLetter(file: ChangedFile | null): string {
  if (file === null) {
    return "??";
  }

  return file.unstaged === "." ? file.staged : file.unstaged;
}

function ChangeCode({ file }: { readonly file: ChangedFile | null }) {
  const letter = changeLetter(file);

  return (
    <span
      aria-hidden="true"
      className={`inline-grid h-5 w-6 shrink-0 place-items-center rounded font-mono text-[11px] font-semibold ${letterTones.get(letter) ?? "bg-changes-soft text-changes"}`}
    >
      {letter}
    </span>
  );
}

function problemText(problem: WorkingTreeProblem): string {
  switch (problem._tag) {
    case "Unreadable":
      return `Couldn't read this checkout: ${problem.message}`;
    case "Conflicts":
      return problem.files === 1
        ? "1 file has merge conflicts"
        : `${problem.files} files have merge conflicts`;
    case "Operation":
      return `A ${problem.operation} is in progress`;

    default: {
      const _exhaustive: never = problem;

      return _exhaustive;
    }
  }
}

function UpstreamLine({
  git,
  merge,
}: {
  readonly git: GitStatus;
  readonly merge: MergeProof | null;
}) {
  const { head } = git;

  if (head._tag === "Detached") {
    return <>Detached HEAD{git.lastCommit !== null && ` at ${git.lastCommit.sha.slice(0, 7)}`}</>;
  }

  if (head._tag === "Unborn") {
    return <>No commits yet</>;
  }

  const { upstream } = head;

  if (upstream === null) {
    return <>No upstream branch</>;
  }

  if (upstream.gone) {
    return merge !== null ? (
      <>
        Merged. <span className="font-mono">{upstream.name}</span> was deleted on the remote.
      </>
    ) : (
      <span className="text-changes">
        <span className="font-mono">{upstream.name}</span> was deleted on the remote, and no merge
        was found.
      </span>
    );
  }

  const counts = [
    upstream.ahead > 0 && `${upstream.ahead} to push`,
    upstream.behind > 0 && `${upstream.behind} to pull`,
  ].filter(Boolean);

  return (
    <>
      Tracks <span className="font-mono">{upstream.name}</span>
      {counts.length === 0 ? ", up to date" : `, ${counts.join(", ")}`}
    </>
  );
}

export function WorkingTreeDetail({
  id,
  repository,
  machine,
  tree,
  checkout,
  onShowWorkingTree,
}: {
  readonly id: string;
  readonly repository: Repository;
  readonly machine: Machine;
  readonly tree: WorkingTree;
  readonly checkout: Checkout;
  readonly onShowWorkingTree: (path: string) => void;
}) {
  const { git, problem } = tree;
  const head = git?.head ?? null;

  const pullRequest =
    head?._tag === "Branch"
      ? (checkout.github?.pullRequests.find(({ branch }) => branch === head.name) ?? null)
      : null;

  const files: ReadonlyArray<{ readonly path: string; readonly file: ChangedFile | null }> =
    git === null
      ? []
      : [
          ...git.changed.items.map((file) => ({
            path: file.originalPath === null ? file.path : `${file.originalPath} → ${file.path}`,
            file,
          })),
          ...git.untracked.items.map((path) => ({ path, file: null })),
        ];

  const changes = git === null ? 0 : git.changed.total + git.untracked.total;

  return (
    <div id={id} className="mt-1 mb-2 ms-7 space-y-3 rounded-lg border border-line p-3">
      {problem !== null && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <TriangleAlertIcon className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{problemText(problem)}</span>
        </p>
      )}
      <BusyThreadsNotice
        threads={busyThreads(machine, [checkout.path])}
        where="in this working tree"
        consequence="Pulling, switching branch or stashing here asks first."
      />
      {git !== null && (
        <p className="text-sm text-ink-muted">
          <UpstreamLine git={git} merge={tree.merge} />
        </p>
      )}
      {pullRequest !== null && (
        <a
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-2 text-sm text-accent-text hover:underline"
        >
          <GitPullRequestIcon className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            #{pullRequest.number} {pullRequest.title}
            {pullRequest.draft && <span className="text-ink-muted"> · draft</span>}
          </span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
      <CheckoutActions
        repository={repository}
        machine={machine}
        checkout={checkout}
        onShowWorkingTree={onShowWorkingTree}
      />
      {changes > 0 && (
        <ShortList
          items={files}
          total={changes}
          noun="changed files"
          render={({ path, file }) => (
            <li
              key={path}
              className="flex items-start gap-2 text-[13px]"
              title={file === null ? "untracked" : describeChange(file)}
            >
              <ChangeCode file={file} />
              <span className="min-w-0 font-mono break-all">{path}</span>
              <span className="sr-only">
                , {file === null ? "untracked" : describeChange(file)}
              </span>
            </li>
          )}
        />
      )}
      {git !== null && git.lastCommit !== null && (
        <p className="text-sm text-ink-muted">
          Last commit <span className="text-ink">{git.lastCommit.subject}</span> ·{" "}
          <span className="font-mono">{git.lastCommit.sha.slice(0, 7)}</span> ·{" "}
          <RelativeTime at={git.lastCommit.committedAt} />
        </p>
      )}
      <p className="font-mono text-xs text-ink-muted [overflow-wrap:anywhere]">
        <PathText path={checkout.path} />
      </p>
    </div>
  );
}
