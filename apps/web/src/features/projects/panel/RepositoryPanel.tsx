import { ExternalLinkIcon } from "lucide-react";

import { useRuns } from "@/rpc/hubConnection.ts";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { activeCloneFor, activeRunFor } from "../../actions/runLookup.ts";
import { RunStateText } from "../../actions/RunStateText.tsx";
import { CellContent } from "../CellContent.tsx";
import { summariseCell } from "../cellSummary.ts";
import { RepositoryActions } from "../RepositoryActions.tsx";
import { Section } from "./CheckoutSections.tsx";
import { PanelHeader } from "./PanelHeader.tsx";

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

/** The newest GitHub reading any machine has for the repository. */
function latestGithub(repository: Repository) {
  return repository.checkouts
    .flatMap(({ checkout }) => (checkout.github === null ? [] : [checkout.github]))
    .toSorted((left, right) => right.checkedAt.epochMilliseconds - left.checkedAt.epochMilliseconds)
    .at(0);
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
              className="inline-flex items-center gap-1 text-sync underline-offset-2 hover:underline"
            >
              {identity.host}/{identity.path}
              <ExternalLinkIcon className="size-3.5" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            "Local repository with no remote"
          )
        }
        actions={<RepositoryActions fleet={fleet} repository={repository} />}
        onClose={onClose}
      />
      {github !== undefined && (
        <Section title="GitHub">
          <p className="text-sm">
            Default branch <span className="font-mono text-[13px]">{github.defaultBranch}</span>
            <span className="text-ink-muted">
              {" · "}
              {github.pullRequests.length === 1
                ? "1 open pull request"
                : `${github.pullRequests.length} open pull requests`}
            </span>
          </p>
          {github.pullRequests.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {github.pullRequests.map((pull) => (
                <li key={pull.number} className="flex gap-2">
                  <a
                    href={pull.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 text-sync underline-offset-2 hover:underline"
                  >
                    #{pull.number} {pull.title}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <span className="shrink-0 font-mono text-xs text-ink-muted">
                    {pull.branch}
                    {pull.draft && " · draft"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-muted">
            Checked <RelativeTime at={github.checkedAt} />
          </p>
        </Section>
      )}
      <Section title="Machines">
        <ul className="space-y-2">
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
                <li
                  key={machine.id}
                  className="rounded-lg border border-dashed border-line px-3 py-2.5 text-ink-muted"
                >
                  <MachineLine machine={machine} />
                  <p className="mt-1 text-xs">
                    {cloning === undefined ? (
                      "Not on this machine"
                    ) : (
                      <RunStateText run={cloning} length="short" />
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
                  className={`block w-full rounded-lg border border-line px-3 py-2.5 text-start hover:bg-surface-raised ${cell.problem === null ? "" : "bg-danger-soft"}`}
                >
                  <MachineLine machine={machine} />
                  <span className="mt-1.5 block">
                    <CellContent
                      cell={cell}
                      activity={
                        active === undefined ? null : (
                          <span className="mt-0.5 flex text-xs">
                            <RunStateText run={active} length="short" />
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
      </Section>
    </>
  );
}
