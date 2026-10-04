import {
  FilePenIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { GitHubIcon } from "@/ui/HostIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { busyThreads } from "../../t3Code/t3CodeLookup.ts";
import { BusyThreadsNotice } from "../../t3Code/T3CodeNotices.tsx";
import { BranchesSection } from "./BranchesSection.tsx";
import { CheckoutActions } from "./CheckoutActions.tsx";
import { Fact, Facts, PanelSection, ShortList } from "./PanelSection.tsx";
import { StashesSection } from "./StashesSection.tsx";
import { T3CodeSection } from "./T3CodeSection.tsx";
import { WorktreesSection } from "./WorktreesSection.tsx";

import type {
  ChangedFile,
  Checkout,
  FileState,
  GitStatus,
} from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

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

function Tile({
  value,
  label,
  tone,
}: {
  readonly value: number;
  readonly label: string;
  readonly tone: string;
}) {
  return (
    <div className="rounded-lg bg-canvas px-2 py-1.5 text-center">
      <p
        className={`text-lg leading-6 font-semibold tabular-nums ${value > 0 ? tone : "text-ink-muted"}`}
      >
        {value}
      </p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}

function problemOf(checkout: Checkout): string | null {
  if (checkout.status._tag === "Failed") {
    return `Couldn't read this checkout: ${checkout.status.message}`;
  }

  const { git } = checkout.status;

  const conflicted = git.changed.items.filter(
    ({ staged, unstaged }) => staged === "U" || unstaged === "U",
  ).length;

  if (conflicted > 0) {
    return conflicted === 1
      ? "1 file has merge conflicts"
      : `${conflicted} files have merge conflicts`;
  }

  return git.head._tag === "Branch" && git.head.upstream?.gone === true
    ? `Its upstream, ${git.head.upstream.name}, was deleted on the remote`
    : null;
}

function Overview({
  git,
  repository,
  machine,
  checkout,
}: {
  readonly git: GitStatus | null;
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
}) {
  const head = git?.head ?? null;
  const upstream = head?._tag === "Branch" ? head.upstream : null;

  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      {git !== null && head !== null && (
        <>
          <p className="flex items-center gap-2 text-sm">
            <GitBranchIcon className="text-sync" />
            <span className="min-w-0 font-mono font-medium break-all">
              {head._tag === "Detached" ? "Detached HEAD" : head.name}
            </span>
            {upstream !== null && (
              <span className="min-w-0 truncate text-ink-muted">
                → <span className="font-mono">{upstream.name}</span>
              </span>
            )}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {upstream === null || upstream.gone ? (
              <div className="col-span-2 grid place-items-center rounded-lg bg-canvas px-2 py-1.5 text-center text-xs text-ink-muted">
                {head._tag !== "Branch" && "Not on a branch"}
                {head._tag === "Branch" && upstream === null && "No upstream branch"}
                {upstream?.gone === true && <span className="text-danger">Upstream deleted</span>}
              </div>
            ) : (
              <>
                <Tile value={upstream.ahead} label="to push" tone="text-sync" />
                <Tile value={upstream.behind} label="to pull" tone="text-sync" />
              </>
            )}
            <Tile
              value={git.changed.total + git.untracked.total}
              label="changed"
              tone="text-changes"
            />
            <Tile
              value={git.stashes.total}
              label={git.stashes.total === 1 ? "stash" : "stashes"}
              tone="text-ink"
            />
          </div>
        </>
      )}
      <CheckoutActions repository={repository} machine={machine} checkout={checkout} />
    </div>
  );
}

function GitSections({
  git,
  repository,
  machine,
  checkout,
}: {
  readonly git: GitStatus;
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
}) {
  const { head } = git;

  const pullRequest =
    head._tag === "Branch"
      ? (checkout.github?.pullRequests.find(({ branch }) => branch === head.name) ?? null)
      : null;

  const changes = git.changed.total + git.untracked.total;

  const files: ReadonlyArray<{ readonly path: string; readonly file: ChangedFile | null }> = [
    ...git.changed.items.map((file) => ({
      path: file.originalPath === null ? file.path : `${file.originalPath} → ${file.path}`,
      file,
    })),
    ...git.untracked.items.map((path) => ({ path, file: null })),
  ];

  return (
    <>
      {changes > 0 && (
        <PanelSection title="Uncommitted changes" icon={FilePenIcon} tone="changes" count={changes}>
          <ShortList
            items={files}
            total={changes}
            noun="files"
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
        </PanelSection>
      )}
      {git.lastCommit !== null && (
        <PanelSection title="Latest commit" icon={GitCommitHorizontalIcon} tone="neutral">
          <p className="text-sm">{git.lastCommit.subject}</p>
          <p className="mt-1.5 flex items-center gap-2 text-xs text-ink-muted">
            <span className="rounded bg-canvas px-1.5 py-0.5 font-mono">
              {git.lastCommit.sha.slice(0, 7)}
            </span>
            <RelativeTime at={git.lastCommit.committedAt} />
          </p>
          {pullRequest !== null && (
            <a
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex items-start gap-2 rounded-lg bg-canvas px-2.5 py-2 text-sm text-accent-text hover:underline"
            >
              <GitPullRequestIcon className="mt-0.5" />
              <span className="min-w-0">
                #{pullRequest.number} {pullRequest.title}
                {pullRequest.draft && <span className="text-ink-muted"> · draft</span>}
              </span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </PanelSection>
      )}
      <BranchesSection repository={repository} machine={machine} checkout={checkout} git={git} />
      {git.worktrees.length > 0 && (
        <WorktreesSection machine={machine} checkout={checkout} git={git} />
      )}
      {git.stashes.total > 0 && <StashesSection machine={machine} checkout={checkout} git={git} />}
    </>
  );
}

export function CheckoutSections({
  repository,
  machine,
  checkout,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
}) {
  const git = checkout.status._tag === "Read" ? checkout.status.git : null;
  const problem = problemOf(checkout);

  const onGithub =
    repository.identity._tag === "Remote" && repository.identity.host === "github.com";

  return (
    <div className="space-y-3">
      {problem !== null && (
        <p className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
          <TriangleAlertIcon className="mt-0.5" />
          <span className="min-w-0 break-words">{problem}</span>
        </p>
      )}
      <BusyThreadsNotice
        threads={busyThreads(machine, [checkout.path])}
        where="in this checkout"
        consequence="Pulling, switching branch or stashing here asks first."
      />
      <Overview git={git} repository={repository} machine={machine} checkout={checkout} />
      {git !== null && (
        <GitSections git={git} repository={repository} machine={machine} checkout={checkout} />
      )}
      <T3CodeSection machine={machine} checkout={checkout} />
      {(checkout.github !== null || onGithub) && (
        <PanelSection title="GitHub" icon={GitHubIcon} tone="neutral">
          {checkout.github === null ? (
            <p className="text-sm text-ink-muted">
              {machine.info.githubCli._tag === "Unavailable"
                ? `Not available: the GitHub CLI (gh) isn't installed or signed in on ${machineLabel(machine)}.`
                : "Not available: GitHub couldn't be reached on the last check."}
            </p>
          ) : (
            <Facts>
              <Fact term="Default branch">
                <span className="font-mono text-[13px]">{checkout.github.defaultBranch}</span>
              </Fact>
              <Fact term="Remote">
                {checkout.github.trackingSha === null && (
                  <span className="text-ink-muted">Not fetched here yet</span>
                )}
                {checkout.github.trackingSha !== null &&
                  (checkout.github.trackingSha === checkout.github.remoteSha ? (
                    <span className="text-clean">Matches the last fetch</span>
                  ) : (
                    <span className="text-sync">Has commits not fetched yet</span>
                  ))}
              </Fact>
              <Fact term="Checked">
                <RelativeTime at={checkout.github.checkedAt} />
              </Fact>
            </Facts>
          )}
        </PanelSection>
      )}
      <PanelSection title="Location" icon={FolderOpenIcon} tone="neutral">
        <Facts>
          <Fact term="Path">
            <span className="font-mono text-[13px] break-all">{checkout.path}</span>
          </Fact>
          {checkout.worktree._tag === "Linked" && (
            <Fact term="Worktree of">
              <span className="font-mono text-[13px] break-all">{checkout.worktree.mainPath}</span>
            </Fact>
          )}
          <Fact term="Fetched">
            {git === null || git.lastFetchedAt === null ? (
              <span className="text-ink-muted">Never</span>
            ) : (
              <RelativeTime at={git.lastFetchedAt} />
            )}
          </Fact>
          <Fact term="Scanned">
            <RelativeTime at={checkout.scannedAt} />
          </Fact>
        </Facts>
      </PanelSection>
    </div>
  );
}
