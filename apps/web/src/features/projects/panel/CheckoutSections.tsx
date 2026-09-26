import {
  ArchiveIcon,
  FilePenIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { CheckoutActions } from "./CheckoutActions.tsx";
import { Fact, Facts, PanelSection, ShortList } from "./PanelSection.tsx";

import type {
  ChangedFile,
  Checkout,
  FileState,
  GitStatus,
  Upstream,
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

/** Conflicts and deletions in red, additions in green, and other edits in amber. */
const letterTones = new Map([
  ["??", "bg-canvas text-ink-muted"],
  ["U", "bg-danger-soft text-danger"],
  ["D", "bg-danger-soft text-danger"],
  ["A", "bg-clean/15 text-clean"],
]);

/** The letter that matters for a change: the unstaged one when there is one, or ?? when untracked. */
function changeLetter(file: ChangedFile | null): string {
  if (file === null) {
    return "??";
  }

  return file.unstaged === "." ? file.staged : file.unstaged;
}

/** A file's change as one short, coloured code. */
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

/** A small stat: a number over what it counts, coloured when it asks for attention. */
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

/** The problem with a checkout that needs fixing by hand, if there is one. */
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

/** The branch, how it stands against its upstream, and the actions for it. */
function Overview({
  git,
  machine,
  checkout,
}: {
  readonly git: GitStatus | null;
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
      <CheckoutActions machine={machine} checkout={checkout} />
    </div>
  );
}

function GitSections({ git, checkout }: { readonly git: GitStatus; readonly checkout: Checkout }) {
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
              className="mt-3 flex items-start gap-2 rounded-lg bg-sync-soft px-2.5 py-2 text-sm text-sync hover:underline"
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
              className="flex items-center gap-2 text-sm"
              title={describeUpstream(branch.upstream)}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{branch.name}</span>
              {head._tag !== "Detached" && branch.name === head.name && (
                <span className="rounded-full bg-sync-soft px-2 text-xs text-sync">current</span>
              )}
              <span className="shrink-0 text-xs tabular-nums">
                {branch.upstream === null && <span className="text-ink-muted">no upstream</span>}
                {branch.upstream?.gone === true && <span className="text-danger">deleted</span>}
                {branch.upstream !== null &&
                  !branch.upstream.gone &&
                  (branch.upstream.ahead + branch.upstream.behind === 0 ? (
                    <span className="text-clean">✓</span>
                  ) : (
                    <span className="text-sync">
                      {branch.upstream.ahead > 0 && `↑${branch.upstream.ahead} `}
                      {branch.upstream.behind > 0 && `↓${branch.upstream.behind}`}
                    </span>
                  ))}
              </span>
              <span className="sr-only">, {describeUpstream(branch.upstream)}</span>
            </li>
          )}
        />
      </PanelSection>
      {git.stashes.total > 0 && (
        <PanelSection title="Stashes" icon={ArchiveIcon} tone="neutral" count={git.stashes.total}>
          <ShortList
            items={git.stashes.items}
            total={git.stashes.total}
            noun="stashes"
            render={(stash) => (
              <li key={stash.index} className="flex gap-2 text-sm">
                <span className="shrink-0 rounded bg-canvas px-1.5 font-mono text-xs text-ink-muted">
                  {stash.index}
                </span>
                <span className="min-w-0">{stash.message}</span>
              </li>
            )}
          />
        </PanelSection>
      )}
    </>
  );
}

/**
 * Everything known about one checkout: any problem first, then an overview with its actions,
 * then a card for each part, and finally where it lives.
 */
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
      <Overview git={git} machine={machine} checkout={checkout} />
      {git !== null && <GitSections git={git} checkout={checkout} />}
      {(checkout.github !== null || onGithub) && (
        <PanelSection title="GitHub" icon={GitPullRequestIcon} tone="neutral">
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
