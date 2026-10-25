import { useId } from "react";

import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { ProjectIcon } from "@/ui/ProjectIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { TabList, TabPanel } from "@/ui/Tabs.tsx";
import { clonePath } from "@fleetfrog/protocol/domain/checkout";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { busyThreads } from "../../t3Code/t3CodeLookup.ts";
import { cellFor } from "../cellSummary.ts";
import { RepositoryActions } from "../RepositoryActions.tsx";
import { outlineCell, workingTreesOf } from "../workingTrees.ts";
import { AboutTab } from "./AboutTab.tsx";
import { CloneSections } from "./CloneSections.tsx";
import { FocusHeading } from "./FocusHeading.tsx";
import { Crumb, PanelHeader } from "./PanelHeader.tsx";
import { RepositoryLink } from "./RepositoryLink.tsx";
import { T3CodeTab } from "./T3CodeTab.tsx";
import { WorkingTreesTab } from "./WorkingTreesTab.tsx";

import type { Tab } from "@/ui/Tabs.tsx";
import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

import type { ProjectSelection, SelectionHistory } from "../ProjectGrid.tsx";

export type CellTab = "working-trees" | "t3-code" | "about";

export function CellPanel({
  fleet,
  repository,
  machine,
  path,
  tab,
  headingId,
  onSelect,
  onChoosePath,
  onChooseTab,
  onClose,
}: {
  readonly fleet: Fleet;
  readonly repository: Repository;
  readonly machine: Machine;
  readonly path: string | null;
  readonly tab: CellTab;
  readonly headingId: string;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
  readonly onChoosePath: (path: string) => void;
  readonly onChooseTab: (tab: CellTab) => void;
  readonly onClose: () => void;
}) {
  const tabsId = useId();
  const cell = cellFor(repository, machine.id);
  const entry = cell?.entries.find(({ checkout }) => checkout.path === path) ?? cell?.primary;
  const offline = machine.connection._tag === "Offline";

  const clones =
    cell === null
      ? []
      : outlineCell({
          machine,
          entries: cell.entries,
          ignoredBranches: fleet.cleanup.ignoredBranches,
        });

  const hasT3Code = machine.t3Code !== null;
  const current = tab === "t3-code" && !hasT3Code ? "working-trees" : tab;

  const busy = busyThreads(
    machine,
    clones.flatMap(workingTreesOf).map((tree) => tree.path),
  ).length;

  const selectedClone =
    entry === undefined
      ? undefined
      : clones.find((clone) => clone.path === clonePath(entry.checkout));

  const fetchedAt = selectedClone?.anchor?.git.lastFetchedAt ?? null;

  const tabs: ReadonlyArray<Tab<CellTab>> = [
    { id: "working-trees", label: "Working trees" },
    ...(hasT3Code
      ? [
          {
            id: "t3-code" as const,
            label: (
              <>
                T3 Code
                {busy > 0 && (
                  <span className="rounded-full bg-sync-soft px-1.5 text-xs text-sync tabular-nums">
                    {busy}
                    <span className="sr-only"> busy</span>
                  </span>
                )}
              </>
            ),
          },
        ]
      : []),
    { id: "about", label: "About" },
  ];

  return (
    <>
      <PanelHeader
        headingId={headingId}
        title={
          <>
            <Crumb>
              <button
                type="button"
                onClick={() => onSelect({ repository: repository.key, machine: null }, "Push")}
                title="Show it on every machine"
                className="flex min-w-0 items-center gap-1.5 rounded underline-offset-2 hover:text-ink hover:underline"
              >
                {repository.icon !== null && <ProjectIcon icon={repository.icon} />}
                <span className="truncate">{repository.label}</span>
              </button>
            </Crumb>
            <Crumb last>
              <MachineKindIcon kind={machineKind(machine)} />
              <span className="truncate">{machineLabel(machine)}</span>
              {offline && <span className="font-normal text-ink-muted">(offline)</span>}
            </Crumb>
          </>
        }
        subtitle={
          <span className="flex min-w-0 items-center gap-1.5">
            <RepositoryLink identity={repository.identity} />
            {fetchedAt !== null && (
              <span className="shrink-0">
                · Fetched <RelativeTime at={fetchedAt} />
              </span>
            )}
          </span>
        }
        actions={<RepositoryActions fleet={fleet} repository={repository} />}
        tabs={
          cell === null ? undefined : (
            <TabList
              base={tabsId}
              label="Repository on this machine"
              tabs={tabs}
              current={current}
              onChoose={onChooseTab}
            />
          )
        }
        onClose={onClose}
      />
      <FocusHeading key={cell === null ? "missing" : "present"} targetId={headingId} />
      {cell === null || entry === undefined ? (
        <div className="space-y-3 px-4 pb-6">
          <CloneSections fleet={fleet} repository={repository} machine={machine} />
        </div>
      ) : (
        <TabPanel base={tabsId} current={current}>
          <div className="px-4 pb-6">
            {current === "working-trees" && (
              <WorkingTreesTab
                repository={repository}
                machine={machine}
                clones={clones}
                selectedPath={entry.checkout.path}
                onChoosePath={onChoosePath}
              />
            )}
            {current === "t3-code" && (
              <T3CodeTab machine={machine} clones={clones} onChoosePath={onChoosePath} />
            )}
            {current === "about" && (
              <AboutTab repository={repository} machine={machine} clones={clones} />
            )}
          </div>
        </TabPanel>
      )}
    </>
  );
}
