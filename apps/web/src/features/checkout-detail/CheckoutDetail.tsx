import { Chip } from "@/ui/Chip.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { CheckoutBadges } from "../overview/CheckoutBadges.tsx";
import { summariseCheckout } from "../overview/checkoutSummary.ts";

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

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function More({ shown, total }: { readonly shown: number; readonly total: number }) {
  return total > shown ? (
    <p className="mt-1 text-xs text-ink-muted">and {total - shown} more</p>
  ) : null;
}

function GitDetails({ git }: { readonly git: GitStatus }) {
  const { head } = git;

  return (
    <>
      <Section title="Branch">
        <p className="font-mono text-[13px]">
          {head._tag === "Detached" ? "Detached HEAD" : head.name}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {head._tag === "Branch" && describeUpstream(head.upstream)}
          {head._tag === "Unborn" && "No commits yet"}
          {head._tag === "Detached" && "Not on a branch"}
        </p>
        {git.lastCommit !== null && (
          <p className="mt-2 text-sm">
            <span className="font-mono text-xs text-ink-muted">
              {git.lastCommit.sha.slice(0, 7)}
            </span>{" "}
            {git.lastCommit.subject}{" "}
            <span className="text-ink-muted">
              · <RelativeTime at={git.lastCommit.committedAt} />
            </span>
          </p>
        )}
      </Section>
      {git.changed.total > 0 && (
        <Section title={`Changed files (${git.changed.total})`}>
          <ul className="space-y-1 text-sm">
            {git.changed.items.map((file) => (
              <li key={file.path} className="flex flex-wrap justify-between gap-x-4">
                <span className="font-mono text-[13px] break-all">
                  {file.originalPath === null ? file.path : `${file.originalPath} → ${file.path}`}
                </span>
                <span className="text-ink-muted">{describeChange(file)}</span>
              </li>
            ))}
          </ul>
          <More shown={git.changed.items.length} total={git.changed.total} />
        </Section>
      )}
      {git.untracked.total > 0 && (
        <Section title={`Untracked files (${git.untracked.total})`}>
          <ul className="space-y-1 font-mono text-[13px]">
            {git.untracked.items.map((path) => (
              <li key={path} className="break-all">
                {path}
              </li>
            ))}
          </ul>
          <More shown={git.untracked.items.length} total={git.untracked.total} />
        </Section>
      )}
      {git.stashes.total > 0 && (
        <Section title={`Stashes (${git.stashes.total})`}>
          <ol className="space-y-1 text-sm">
            {git.stashes.items.map((stash) => (
              <li key={stash.index}>
                <span className="font-mono text-xs text-ink-muted">stash@{`{${stash.index}}`}</span>{" "}
                {stash.message}
              </li>
            ))}
          </ol>
          <More shown={git.stashes.items.length} total={git.stashes.total} />
        </Section>
      )}
      <Section title={`Local branches (${git.branches.total})`}>
        <ul className="space-y-1 text-sm">
          {git.branches.items.map((branch) => (
            <li key={branch.name} className="flex flex-wrap justify-between gap-x-4">
              <span className="font-mono text-[13px]">{branch.name}</span>
              <span className="text-ink-muted">{describeUpstream(branch.upstream)}</span>
            </li>
          ))}
        </ul>
        <More shown={git.branches.items.length} total={git.branches.total} />
      </Section>
    </>
  );
}

function GithubDetails({ github }: { readonly github: NonNullable<Checkout["github"]> }) {
  return (
    <Section title="GitHub">
      <p className="text-sm">
        Default branch <span className="font-mono text-[13px]">{github.defaultBranch}</span>
        {github.trackingSha === null && " has not been fetched here"}
        {github.trackingSha !== null &&
          (github.trackingSha === github.remoteSha
            ? " matches the last fetch"
            : " has commits this checkout has not fetched")}
      </p>
      {github.pullRequests.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {github.pullRequests.map((pull) => (
            <li key={pull.number}>
              <a
                href={pull.url}
                target="_blank"
                rel="noreferrer"
                className="text-sync underline-offset-2 hover:underline"
              >
                #{pull.number} {pull.title}
              </a>{" "}
              <span className="text-ink-muted">
                from <span className="font-mono text-[13px]">{pull.branch}</span>
                {pull.draft && " (draft)"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-ink-muted">
        Checked <RelativeTime at={github.checkedAt} />
      </p>
    </Section>
  );
}

export function CheckoutDetail({
  repository,
  machine,
  checkout,
  onClose,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly onClose: () => void;
}) {
  const summary = summariseCheckout(checkout);

  return (
    <Dialog
      title={`${repository.name} on ${machineLabel(machine)}`}
      onClose={onClose}
      placement="side"
    >
      <div className="mb-4 space-y-2">
        <p className="font-mono text-[13px] break-all text-ink-muted">{checkout.path}</p>
        <div className="flex flex-wrap gap-1">
          {checkout.worktree._tag === "Linked" && (
            <Chip tone="neutral">Worktree of {checkout.worktree.mainPath}</Chip>
          )}
          <CheckoutBadges summary={summary} />
        </div>
        <p className="text-xs text-ink-muted">
          Scanned <RelativeTime at={checkout.scannedAt} />
          {checkout.status._tag === "Read" && (
            <>
              {" · "}
              {checkout.status.git.lastFetchedAt === null ? (
                "Never fetched"
              ) : (
                <>
                  Fetched <RelativeTime at={checkout.status.git.lastFetchedAt} />
                </>
              )}
            </>
          )}
          {machine.connection._tag === "Offline" && " · Machine offline, showing the last scan"}
        </p>
      </div>
      {checkout.status._tag === "Failed" ? (
        <Section title="Status unavailable">
          <p className="font-mono text-[13px] break-all text-danger">{checkout.status.message}</p>
        </Section>
      ) : (
        <GitDetails git={checkout.status.git} />
      )}
      {checkout.github !== null && <GithubDetails github={checkout.github} />}
    </Dialog>
  );
}
