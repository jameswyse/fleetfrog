import { useState } from "react";

import { GitBranchIcon, Trash2Icon } from "lucide-react";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { useMayRun } from "@/rpc/session.ts";

import { machineBlocker } from "../../actions/actionAvailability.ts";
import { BranchState } from "../../branches/BranchState.tsx";
import {
  branchesInOtherWorktrees,
  isPreselected,
  recentFirst,
  tidyCandidates,
} from "../../branches/branchTidying.ts";
import { TidyBranchesDialog } from "../../branches/TidyBranchesDialog.tsx";
import { ListSection, shortListInCard } from "./ListSection.tsx";
import { ShortList } from "./PanelSection.tsx";

import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

import type { CloneOutline } from "../workingTrees.ts";

function useBranchTidying({
  repository,
  machine,
  clone,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly clone: CloneOutline;
}) {
  const ignoredBranches = knownFleet(useHub())?.cleanup.ignoredBranches ?? [];
  const mayTidy = useMayRun("DeleteBranches");
  const { anchor } = clone;

  if (anchor === null || !mayTidy || machineBlocker(machine, "DeleteBranches") !== null) {
    return null;
  }

  const tidying = tidyCandidates({
    checkout: anchor.checkout,
    git: anchor.git,
    inOtherWorktrees: branchesInOtherWorktrees({
      repository,
      machineId: machine.id,
      checkout: anchor.checkout,
    }),
    ignoredBranches,
  });

  return {
    ...tidying,
    ...anchor,
    preselected: tidying.candidates.filter(isPreselected).map(({ name }) => name),
  };
}

export function ParkedBranches({
  repository,
  machine,
  clone,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly clone: CloneOutline;
}) {
  const [chosen, setChosen] = useState<ReadonlyArray<string> | null>(null);
  const tidying = useBranchTidying({ repository, machine, clone });
  const merged = clone.anchor?.checkout.github?.mergedPullRequests ?? [];
  const deletable = new Set(tidying?.candidates.map(({ name }) => name));

  if (clone.parked.length + clone.unreportedBranches === 0) {
    return null;
  }

  return (
    <ListSection
      title="Other branches"
      count={clone.parked.length + clone.unreportedBranches}
      action={
        tidying !== null &&
        tidying.candidates.length > 0 && (
          <button
            type="button"
            onClick={() => setChosen(tidying.preselected)}
            className="rounded px-1.5 py-0.5 text-xs font-medium text-accent-text hover:bg-fill"
          >
            Tidy branches…
          </button>
        )
      }
    >
      {(clone.main === null || clone.main.git === null) && (
        <p className="px-2 py-1.5 text-xs text-ink-muted">
          FleetFrog can't see which branch this clone's main checkout has, so one of these may be
          checked out there.
        </p>
      )}
      <ShortList
        items={clone.parked.toSorted(recentFirst)}
        total={clone.parked.length + clone.unreportedBranches}
        noun="branches"
        {...shortListInCard}
        render={(branch) => (
          <li
            key={branch.name}
            className="flex min-h-8 items-center gap-2.5 rounded-lg ps-2 pe-0.5 text-sm hover:bg-fill"
          >
            <GitBranchIcon aria-hidden="true" className="shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{branch.name}</span>
            <BranchState branch={branch} merged={merged} />
            {deletable.has(branch.name) ? (
              <button
                type="button"
                onClick={() => setChosen([branch.name])}
                aria-label={`Delete ${branch.name}…`}
                title="Delete…"
                className="grid size-7 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-surface hover:text-danger"
              >
                <Trash2Icon aria-hidden="true" className="size-3.5" />
              </button>
            ) : (
              <span aria-hidden="true" className="size-7 shrink-0" />
            )}
          </li>
        )}
      />
      {chosen !== null && tidying !== null && (
        <TidyBranchesDialog
          repository={repository}
          machine={machine}
          checkout={tidying.checkout}
          git={tidying.git}
          candidates={tidying.candidates}
          kept={tidying.kept}
          ignored={tidying.ignored}
          initiallyChosen={chosen}
          onClose={() => setChosen(null)}
        />
      )}
    </ListSection>
  );
}
