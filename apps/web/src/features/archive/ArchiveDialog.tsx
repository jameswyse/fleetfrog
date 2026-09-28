import { useId } from "react";

import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { plural } from "@/ui/plural.ts";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { useStartBatch } from "../actions/useStartBatch.ts";
import { PersonalText } from "../preferences/PersonalText.tsx";
import {
  ArchiveFolderField,
  archiveFolderCreator,
  saveArchiveFolder,
} from "../settings/fleet/ArchiveFolderField.tsx";
import { busyThreads, cloneFolders, projectsAt } from "../t3Code/t3CodeLookup.ts";
import { BusyThreadsNotice, ProjectFolderNotice } from "../t3Code/T3CodeNotices.tsx";
import { planArchive } from "./archiveAvailability.ts";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

import type { ArchivePlan } from "./archiveAvailability.ts";

/** Asks for the machine's Archive folder, after which the dialog shows where the checkout goes. */
function ChooseArchiveFolder({
  machine,
  problem,
}: {
  readonly machine: Machine;
  readonly problem: string | null;
}) {
  const id = useId();

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block font-medium">
        Archive folder on {machineLabel(machine)}
      </label>
      <p id={`${id}-description`} className="text-ink-muted">
        {problem === null
          ? "This machine has no Archive folder yet. Choose where archived checkouts go, such as ~/Archive."
          : `${problem}. Choose another folder.`}
      </p>
      <ArchiveFolderField
        id={id}
        machine={machine}
        onChange={(folder) => saveArchiveFolder(machine, folder)}
        createFolder={archiveFolderCreator(machine)}
      />
    </div>
  );
}

function ArchiveMoves({
  checkout,
  plan,
}: {
  readonly checkout: Checkout;
  readonly plan: Extract<ArchivePlan, { _tag: "Ready" }>;
}) {
  const { destination, worktrees } = plan;

  return (
    <>
      <p>The whole folder moves, with its changes, stashes and ignored files:</p>
      <dl className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-line bg-canvas px-3 py-2">
        <dt className="text-ink-muted">From</dt>
        <dd className="font-mono text-[13px] break-all">
          <PersonalText>{checkout.path}</PersonalText>
        </dd>
        <dt className="text-ink-muted">To</dt>
        <dd className="font-mono text-[13px] break-all">
          <PersonalText>{destination}</PersonalText>
        </dd>
      </dl>
      {worktrees.length > 0 && (
        <div>
          <p>
            Its {plural(worktrees.length, "linked worktree")}{" "}
            {worktrees.length === 1 ? "moves" : "move"} too, and Git repairs{" "}
            {worktrees.length === 1 ? "its link" : "their links"}:
          </p>
          <ul className="mt-2 space-y-1 rounded-md border border-line bg-canvas px-3 py-2">
            {worktrees.map(({ from, to }) => (
              <li key={from} className="font-mono text-[13px] break-all">
                <PersonalText>{from}</PersonalText> <span className="text-ink-muted">→</span>{" "}
                <PersonalText>{to}</PersonalText>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-ink-muted">
        If something is already at a destination, a number is added to it, such as -2.
      </p>
    </>
  );
}

/**
 * Confirms moving a checkout into the Archive folder, showing where it will go, or first asks for
 * the machine's Archive folder when it has none it can use.
 */
export function ArchiveDialog({
  repository,
  machine,
  checkout,
  fromWorktree,
  onClose,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  /** The main checkout to archive. */
  readonly checkout: Checkout;
  /** The linked worktree the developer chose to archive, which goes with its main checkout. */
  readonly fromWorktree: string | null;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const plan = planArchive({ machine, checkout });
  const folders = cloneFolders(checkout);

  return (
    <Dialog title={`Archive ${repository.label} on ${machineLabel(machine)}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        {fromWorktree !== null && (
          <p>
            <span className="font-mono break-all">
              <PersonalText>{fromWorktree}</PersonalText>
            </span>{" "}
            is a linked worktree, so it moves with its main checkout. This archives the main
            checkout and all its worktrees.
          </p>
        )}
        <BusyThreadsNotice
          threads={busyThreads(machine, folders)}
          where={folders.length > 1 ? "in this checkout or its worktrees" : "in this checkout"}
          consequence="Archiving moves the files it's working on to another folder."
        />
        <ProjectFolderNotice
          projects={projectsAt(machine, folders)}
          consequence="After archiving, T3 Code won't find it where it was."
        />
        {plan._tag === "NeedsFolder" && (
          <ChooseArchiveFolder machine={machine} problem={plan.problem} />
        )}
        {plan._tag === "Blocked" && <p className="text-danger">{plan.reason}.</p>}
        {plan._tag === "Ready" && <ArchiveMoves checkout={checkout} plan={plan} />}
        <p className="text-ink-muted">
          It leaves the Projects page and is listed under Cleanup, where you can move it back. Close
          it in any editor or terminal on {machineLabel(machine)} first.
        </p>
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            disabled={pending || plan._tag !== "Ready"}
            onClick={() =>
              start(
                {
                  _tag: "Targeted",
                  runs: [
                    { machineId: machine.id, request: { _tag: "Archive", path: checkout.path } },
                  ],
                },
                onClose,
              )
            }
          >
            {pending ? "Starting…" : "Archive"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
