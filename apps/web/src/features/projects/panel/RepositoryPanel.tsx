import { ExternalLinkIcon, GitPullRequestIcon, MonitorIcon } from "lucide-react";

import { useRuns } from "@/rpc/hubConnection.ts";
import { GitHubIcon, gitHost, HostIcon } from "@/ui/HostIcon.tsx";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { RunActivity } from "../../actions/RunActivity.tsx";
import { activeCloneFor, activeRunFor } from "../../actions/runLookup.ts";
import { CellContent } from "../CellContent.tsx";
import { latestGithub, summariseCell } from "../cellSummary.ts";
import { RepositoryActions } from "../RepositoryActions.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import { Fact, Facts, PanelSection } from "./PanelSection.tsx";

import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

import type { ProjectSelection, SelectionHistory } from "../ProjectGrid.tsx";

function MachineLine({ machine }: { readonly machine: Machine }) {
  const online = machine.connection._tag === "Online";

  return (
    <span className="flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${online ? "bg-clean" : "bg-ink-muted"}`}
      />
      <MachineKindIcon kind={machineKind(machine)} className="text-ink-muted" />
      <span className="min-w-0 truncate font-medium">{machineLabel(machine)}</span>
      <span className={online ? "sr-only" : "text-xs text-ink-muted"}>
        {online ? ", online" : "offline"}
      </span>
    </span>
  );
}

/** One repository across the fleet: where it lives, then a card for each machine. */
export function RepositoryPanel({
  fleet,
  repository,
  headingId,
  onSelect,
  onClose,
}: {
  readonly fleet: Fleet;
  readonly repository: Repository;
  readonly headingId: string;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
  readonly onClose: () => void;
}) {
  const runs = useRuns();
  const github = latestGithub(repository);
  const { identity } = repository;

  return (
    <>
      <PanelHeader
        headingId={headingId}
        title={repository.name}
        subtitle={
          identity._tag === "Remote" ? (
            <a
              href={`https://${identity.host}/${identity.path}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-accent-text underline-offset-2 hover:underline"
            >
              <HostIcon host={gitHost(identity)} />
              {identity.host}/{identity.path}
              <ExternalLinkIcon className="size-3.5" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <HostIcon host={gitHost(identity)} />
              Local repository with no remote
            </span>
          )
        }
        actions={<RepositoryActions fleet={fleet} repository={repository} />}
        onClose={onClose}
      />
      <div className="space-y-3 px-4 pb-6">
        {github !== undefined && (
          <PanelSection title="GitHub" icon={GitHubIcon} tone="neutral">
            <Facts>
              <Fact term="Default branch">
                <span className="font-mono text-[13px]">{github.defaultBranch}</span>
              </Fact>
              <Fact term="Pull requests">
                {github.pullRequests.length === 0 ? (
                  <span className="text-ink-muted">None open</span>
                ) : (
                  `${github.pullRequests.length} open`
                )}
              </Fact>
              <Fact term="Checked">
                <RelativeTime at={github.checkedAt} />
              </Fact>
            </Facts>
            {github.pullRequests.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {github.pullRequests.map((pull) => (
                  <li key={pull.number}>
                    <a
                      href={pull.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-2 rounded-lg bg-canvas px-2.5 py-2 text-sm text-accent-text hover:underline"
                    >
                      <GitPullRequestIcon className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        #{pull.number} {pull.title}
                        <span className="block font-mono text-xs text-ink-muted">
                          {pull.branch}
                          {pull.draft && " · draft"}
                        </span>
                      </span>
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </PanelSection>
        )}
        <PanelSection
          title="Machines"
          icon={MonitorIcon}
          tone="sync"
          count={`${fleet.machines.filter((machine) => repository.checkouts.some(({ machineId }) => machineId === machine.id)).length} of ${fleet.machines.length}`}
        >
          <ul className="-mx-3 -my-3 divide-y divide-line">
            {fleet.machines.map((machine) => {
              const cell = summariseCell(
                repository.checkouts.filter(({ machineId }) => machineId === machine.id),
              );

              if (cell === null) {
                const cloning = activeCloneFor(runs, {
                  machineId: machine.id,
                  repositoryKey: repository.key,
                });

                return (
                  <li key={machine.id} className="px-3 py-2.5 text-ink-muted">
                    <MachineLine machine={machine} />
                    <p className="mt-1 text-xs">
                      {cloning === undefined ? (
                        "Not on this machine"
                      ) : (
                        <RunActivity run={cloning} layout="Stacked" />
                      )}
                    </p>
                  </li>
                );
              }

              const git =
                cell.primary.checkout.status._tag === "Read"
                  ? cell.primary.checkout.status.git
                  : null;
              const active = cell.entries
                .map(({ checkout }) => activeRunFor(runs, { machineId: machine.id, checkout }))
                .find((run) => run !== undefined);

              return (
                <li key={machine.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onSelect({ repository: repository.key, machine: machine.id }, "Push")
                    }
                    className={`block w-full px-3 py-2.5 text-start hover:bg-canvas ${cell.problem === null ? "" : "bg-danger-soft"}`}
                  >
                    <MachineLine machine={machine} />
                    <span className="mt-1.5 block">
                      <CellContent
                        cell={cell}
                        activity={
                          active === undefined ? null : (
                            <span className="mt-0.5 block text-xs">
                              <RunActivity run={active} layout="Inline" />
                            </span>
                          )
                        }
                      />
                    </span>
                    {git !== null && git.lastCommit !== null && (
                      <span className="mt-1 flex gap-2 text-xs text-ink-muted">
                        <span className="min-w-0 flex-1 truncate">{git.lastCommit.subject}</span>
                        <span className="shrink-0">
                          <RelativeTime at={git.lastCommit.committedAt} />
                        </span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </PanelSection>
      </div>
    </>
  );
}
