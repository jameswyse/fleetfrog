import { GitPullRequestIcon, MonitorIcon } from "lucide-react";

import { useRuns } from "@/rpc/hubConnection.ts";
import { GitHubIcon } from "@/ui/HostIcon.tsx";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { RunActivity } from "../../actions/RunActivity.tsx";
import { activeCloneFor, activeRunOn } from "../../actions/runLookup.ts";
import { CellContent } from "../CellContent.tsx";
import { cellFor, latestGithub, openPullRequests } from "../cellSummary.ts";
import { RepositoryActions } from "../RepositoryActions.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import { Fact, Facts, PanelSection } from "./PanelSection.tsx";
import { RepositoryLink } from "./RepositoryLink.tsx";

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
  const pullRequests = openPullRequests(repository);

  return (
    <>
      <PanelHeader
        headingId={headingId}
        title={<span className="truncate">{repository.label}</span>}
        subtitle={<RepositoryLink identity={repository.identity} />}
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
                {pullRequests.length === 0 ? (
                  <span className="text-ink-muted">None open</span>
                ) : (
                  `${pullRequests.length} open`
                )}
              </Fact>
              <Fact term="Checked">
                <RelativeTime at={github.checkedAt} />
              </Fact>
            </Facts>
            {pullRequests.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {pullRequests.map((pull) => (
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
              const cell = cellFor(repository, machine.id);

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
                        <RunActivity run={cloning} layout="Stacked" align="Start" />
                      )}
                    </p>
                  </li>
                );
              }

              const git =
                cell.primary.checkout.status._tag === "Read"
                  ? cell.primary.checkout.status.git
                  : null;
              const active = activeRunOn(runs, cell.entries);

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
                        align="Start"
                        activity={
                          active === undefined ? null : (
                            <span className="mt-0.5 block text-xs">
                              <RunActivity run={active} layout="Inline" align="Start" />
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
