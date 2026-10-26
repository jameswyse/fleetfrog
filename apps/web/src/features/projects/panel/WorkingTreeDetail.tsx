import { BotIcon, GitPullRequestIcon, TriangleAlertIcon } from "lucide-react";

import { PathText } from "@/ui/PathText.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";

import { busyThreads } from "../../t3Code/t3CodeLookup.ts";
import { busyThreadsSentence } from "../../t3Code/T3CodeNotices.tsx";
import { CheckoutActions } from "./CheckoutActions.tsx";
import { CountPill, sectionTitleClass } from "./ListSection.tsx";
import { Fact, Facts, ShortList } from "./PanelSection.tsx";

import type {
  ChangedFile,
  Checkout,
  FileState,
  GitStatus,
  Upstream,
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

function UpstreamValue({
  upstream,
  merge,
}: {
  readonly upstream: Upstream | null;
  readonly merge: MergeProof | null;
}) {
  if (upstream === null) {
    return <span className="text-ink-muted">None</span>;
  }

  const name = <span className="font-mono text-[13px] break-all">{upstream.name}</span>;

  if (upstream.gone) {
    return merge !== null ? (
      <>
        {name} <span className="text-ink-muted">· deleted after merging</span>
      </>
    ) : (
      <>
        {name} <span className="text-changes">· deleted, and no merge was found</span>
      </>
    );
  }

  const counts = [
    upstream.ahead > 0 && `${upstream.ahead} to push`,
    upstream.behind > 0 && `${upstream.behind} to pull`,
  ].filter(Boolean);

  return (
    <>
      {name}{" "}
      <span className="text-ink-muted">
        · {counts.length === 0 ? "up to date" : counts.join(", ")}
      </span>
    </>
  );
}

function HeadFact({ git, merge }: { readonly git: GitStatus; readonly merge: MergeProof | null }) {
  const { head } = git;

  switch (head._tag) {
    case "Branch":
      return (
        <Fact term="Upstream">
          <UpstreamValue upstream={head.upstream} merge={merge} />
        </Fact>
      );
    case "Detached":
      return (
        <Fact term="HEAD">
          Detached{git.lastCommit !== null && ` at ${git.lastCommit.sha.slice(0, 7)}`}
        </Fact>
      );
    case "Unborn":
      return (
        <Fact term="Commits">
          <span className="text-ink-muted">None yet</span>
        </Fact>
      );

    default: {
      const _exhaustive: never = head;

      return _exhaustive;
    }
  }
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
  const threads = busyThreads(machine, [checkout.path]);

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
    <div id={id} className="divide-y divide-line border-t border-line">
      {problem !== null && (
        <p className="flex items-start gap-2 px-3 py-2 text-sm text-danger">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{problemText(problem)}</span>
        </p>
      )}
      {threads.length > 0 && (
        <p className="flex items-start gap-2 bg-sync-soft px-3 py-2 text-sm">
          <BotIcon aria-hidden="true" className="mt-0.5 shrink-0 text-sync" />
          <span className="min-w-0 break-words">
            {busyThreadsSentence({ threads, where: "here" })}
          </span>
        </p>
      )}
      <div className="px-3 py-2.5">
        <CheckoutActions
          repository={repository}
          machine={machine}
          checkout={checkout}
          onShowWorkingTree={onShowWorkingTree}
        />
      </div>
      <div className="px-3 py-2.5">
        <Facts>
          {git !== null && <HeadFact git={git} merge={tree.merge} />}
          {pullRequest !== null && (
            <Fact term="Pull request">
              <a
                href={pullRequest.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-start gap-1.5 text-accent-text hover:underline"
              >
                <GitPullRequestIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0">
                  #{pullRequest.number} {pullRequest.title}
                  {pullRequest.draft && <span className="text-ink-muted"> · draft</span>}
                </span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Fact>
          )}
          {git !== null && git.lastCommit !== null && (
            <Fact term="Last commit">
              <span className="block">{git.lastCommit.subject}</span>
              <span className="block text-xs text-ink-muted">
                <span className="font-mono">{git.lastCommit.sha.slice(0, 7)}</span> ·{" "}
                <RelativeTime at={git.lastCommit.committedAt} />
              </span>
            </Fact>
          )}
          <Fact term="Folder">
            <span className="font-mono text-[13px] text-ink-muted [overflow-wrap:anywhere]">
              <PathText path={checkout.path} />
            </span>
          </Fact>
        </Facts>
      </div>
      {changes > 0 && (
        <section aria-labelledby={`${id}-changes`} className="px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2">
            <h4 id={`${id}-changes`} className={sectionTitleClass}>
              Changes
            </h4>
            <CountPill count={changes} />
          </div>
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
        </section>
      )}
    </div>
  );
}
