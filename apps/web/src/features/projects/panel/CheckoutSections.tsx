import { GitBranchIcon } from "lucide-react";

import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import type { ReactNode } from "react";

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

/** Git's two status letters, staged then unstaged, with a space for no change. */
function statusLetters(file: ChangedFile): string {
  return `${file.staged === "." ? " " : file.staged}${file.unstaged === "." ? " " : file.unstaged}`;
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

/** An upstream's state in a few characters: a tick, arrows with counts, or a word. */
function UpstreamMark({ upstream }: { readonly upstream: Upstream | null }) {
  if (upstream === null) {
    return <span className="text-ink-muted">no upstream</span>;
  }

  if (upstream.gone) {
    return <span className="text-danger">deleted</span>;
  }

  if (upstream.ahead + upstream.behind === 0) {
    return <span className="text-clean">✓</span>;
  }

  return (
    <span className="text-sync tabular-nums">
      {upstream.ahead > 0 && `↑${upstream.ahead} `}
      {upstream.behind > 0 && `↓${upstream.behind}`}
    </span>
  );
}

/** A part of the panel: a small heading over its content. */
export function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="border-t border-line px-5 py-4">
      <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function More({ shown, total }: { readonly shown: number; readonly total: number }) {
  return total > shown ? (
    <p className="mt-1.5 text-xs text-ink-muted">and {total - shown} more</p>
  ) : null;
}

function GitSections({ git, checkout }: { readonly git: GitStatus; readonly checkout: Checkout }) {
  const { head } = git;
  const pullRequest =
    head._tag === "Branch"
      ? (checkout.github?.pullRequests.find(({ branch }) => branch === head.name) ?? null)
      : null;
  const changes = git.changed.total + git.untracked.total;

  return (
    <>
      <Section title="Branch">
        <p className="flex items-center gap-2 text-sm">
          <GitBranchIcon className="text-ink-muted" />
          <span className="min-w-0 font-mono break-all">
            {head._tag === "Detached" ? "Detached HEAD" : head.name}
          </span>
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {head._tag === "Branch" && describeUpstream(head.upstream)}
          {head._tag === "Unborn" && "No commits yet"}
          {head._tag === "Detached" && "Not on a branch"}
        </p>
        {git.lastCommit !== null && (
          <p className="mt-2 flex items-baseline gap-2 text-sm">
            <span className="font-mono text-xs text-ink-muted">
              {git.lastCommit.sha.slice(0, 7)}
            </span>
            <span className="min-w-0 flex-1">{git.lastCommit.subject}</span>
            <span className="shrink-0 text-xs text-ink-muted">
              <RelativeTime at={git.lastCommit.committedAt} />
            </span>
          </p>
        )}
        {pullRequest !== null && (
          <a
            href={pullRequest.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-sm text-sync underline-offset-2 hover:underline"
          >
            Pull request #{pullRequest.number}: {pullRequest.title}
            {pullRequest.draft && " (draft)"}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </Section>
      {changes > 0 && (
        <Section title={`Changes (${changes})`}>
          <ul className="space-y-1 text-[13px]">
            {git.changed.items.map((file) => (
              <li key={file.path} className="flex gap-2" title={describeChange(file)}>
                <span
                  aria-hidden="true"
                  className={`w-5 shrink-0 font-mono whitespace-pre ${file.staged === "U" || file.unstaged === "U" ? "text-danger" : "text-changes"}`}
                >
                  {statusLetters(file)}
                </span>
                <span className="min-w-0 font-mono break-all">
                  {file.originalPath === null ? file.path : `${file.originalPath} → ${file.path}`}
                </span>
                <span className="sr-only">, {describeChange(file)}</span>
              </li>
            ))}
            {git.untracked.items.map((path) => (
              <li key={path} className="flex gap-2" title="untracked">
                <span aria-hidden="true" className="w-5 shrink-0 font-mono text-ink-muted">
                  ??
                </span>
                <span className="min-w-0 font-mono break-all">{path}</span>
                <span className="sr-only">, untracked</span>
              </li>
            ))}
          </ul>
          <More shown={git.changed.items.length + git.untracked.items.length} total={changes} />
        </Section>
      )}
      {git.stashes.total > 0 && (
        <Section title={`Stashes (${git.stashes.total})`}>
          <ol className="space-y-1 text-sm">
            {git.stashes.items.map((stash) => (
              <li key={stash.index} className="flex gap-2">
                <span className="shrink-0 font-mono text-xs text-ink-muted">{stash.index}</span>
                <span className="min-w-0">{stash.message}</span>
              </li>
            ))}
          </ol>
          <More shown={git.stashes.items.length} total={git.stashes.total} />
        </Section>
      )}
      <Section title={`Local branches (${git.branches.total})`}>
        <ul className="space-y-1 text-sm">
          {git.branches.items.map((branch) => (
            <li
              key={branch.name}
              className="flex items-baseline gap-3"
              title={describeUpstream(branch.upstream)}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                {branch.name}
                {head._tag !== "Detached" && branch.name === head.name && (
                  <span className="ms-2 font-sans text-xs text-ink-muted">current</span>
                )}
              </span>
              <span className="shrink-0 text-xs">
                <UpstreamMark upstream={branch.upstream} />
              </span>
              <span className="sr-only">, {describeUpstream(branch.upstream)}</span>
            </li>
          ))}
        </ul>
        <More shown={git.branches.items.length} total={git.branches.total} />
      </Section>
    </>
  );
}

function GithubSection({ github }: { readonly github: NonNullable<Checkout["github"]> }) {
  return (
    <Section title="GitHub">
      <p className="text-sm">
        Default branch <span className="font-mono text-[13px]">{github.defaultBranch}</span>
        {github.trackingSha === null && " hasn't been fetched here"}
        {github.trackingSha !== null &&
          (github.trackingSha === github.remoteSha
            ? " matches the last fetch"
            : " has commits this checkout hasn't fetched")}
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Checked <RelativeTime at={github.checkedAt} />
      </p>
    </Section>
  );
}

/** Everything known about one checkout, section by section. */
export function CheckoutSections({
  repository,
  machine,
  checkout,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
}) {
  const onGithub =
    repository.identity._tag === "Remote" && repository.identity.host === "github.com";

  return (
    <>
      {checkout.status._tag === "Failed" ? (
        <Section title="Status unavailable">
          <p className="font-mono text-[13px] break-all text-danger">{checkout.status.message}</p>
        </Section>
      ) : (
        <GitSections git={checkout.status.git} checkout={checkout} />
      )}
      {checkout.github !== null && <GithubSection github={checkout.github} />}
      {checkout.github === null && onGithub && (
        <Section title="GitHub">
          <p className="text-sm text-ink-muted">
            {machine.info.githubCli._tag === "Unavailable"
              ? `Pull requests and the default branch aren't available because the GitHub CLI (gh) isn't installed or signed in on ${machineLabel(machine)}.`
              : "Pull requests and the default branch aren't available because GitHub couldn't be reached on the last check."}
          </p>
        </Section>
      )}
    </>
  );
}
