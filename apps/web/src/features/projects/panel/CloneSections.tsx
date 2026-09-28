import { useId, useState } from "react";

import { Link } from "@tanstack/react-router";
import { CircleDashedIcon, FolderDownIcon, TriangleAlertIcon } from "lucide-react";

import { useRuns } from "@/rpc/hubConnection.ts";
import { useRole } from "@/rpc/session.ts";
import { Button } from "@/ui/Button.tsx";
import { cloneSource, suggestCloneDestination } from "@fleetfrog/protocol/domain/cloneDestination";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { checkoutPaths, cloneBlocker } from "../../actions/actionAvailability.ts";
import { describeOutcome } from "../../actions/actionCopy.ts";
import {
  draftFromSuggestion,
  draftPath,
  draftProblem,
} from "../../actions/cloneDestinationDraft.ts";
import { CloneDestinationField } from "../../actions/CloneDestinationField.tsx";
import { RunActivity } from "../../actions/RunActivity.tsx";
import { activeCloneFor, latestCloneFor } from "../../actions/runLookup.ts";
import { useStartBatch } from "../../actions/useStartBatch.ts";
import { PersonalText } from "../../preferences/PersonalText.tsx";
import { PanelSection } from "./PanelSection.tsx";

import type { ActionRun } from "@fleetfrog/protocol/domain/activity";
import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

const names = new Intl.ListFormat("en", { type: "conjunction" });

/** Whether the machine has the repository, as far as its scans can tell. */
function Whereabouts({
  fleet,
  repository,
  machine,
}: {
  readonly fleet: Fleet;
  readonly repository: Repository;
  readonly machine: Machine;
}) {
  const label = machineLabel(machine);
  const holders = fleet.machines
    .filter(({ id }) => repository.checkouts.some(({ machineId }) => machineId === id))
    .map(machineLabel);
  let missing = `Not on ${label}.`;

  if (machine.lastDiscoveryAt === null) {
    missing = `${label} hasn't finished scanning its project folders, so it may have ${repository.label} already.`;
  } else if (machine.connection._tag === "Offline") {
    missing = `Not on ${label} at its last scan.`;
  }

  return (
    <p className="flex items-start gap-2.5 rounded-xl border border-line px-3 py-2.5 text-sm">
      <CircleDashedIcon className="mt-0.5 text-ink-muted" />
      <span>
        {missing}
        {holders.length > 0 && (
          <span className="text-ink-muted"> It's on {names.format(holders)}.</span>
        )}
      </span>
    </p>
  );
}

/** A clone underway: its progress, Git's own line, and where to follow it. */
function Cloning({ run }: { readonly run: ActionRun }) {
  return (
    <div
      // Takes focus if the button that started it went away with focus on it.
      ref={(node) => {
        const focused = document.activeElement;

        if (node !== null && (focused === null || focused === document.body)) {
          node.focus();
        }
      }}
      tabIndex={-1}
      className="space-y-2 text-sm outline-none"
    >
      <RunActivity run={run} layout="Stacked" align="Start" />
      {run.state._tag === "Running" && run.state.progress !== null && (
        <p className="font-mono text-xs break-words text-ink-muted">
          <PersonalText>{run.state.progress}</PersonalText>
        </p>
      )}
      <Link
        to="/activity"
        search={{ batch: run.batchId }}
        className="inline-block text-accent-text underline-offset-2 hover:underline"
      >
        View in Activity
      </Link>
    </div>
  );
}

/** Where the clone comes from and goes, prefilled with the folder the clone dialog suggests. */
function CloneForm({
  fleet,
  repository,
  machine,
  source,
  lastFailure,
}: {
  readonly fleet: Fleet;
  readonly repository: Repository;
  readonly machine: Machine;
  readonly source: string;
  /** Why the last clone here failed, if it did. */
  readonly lastFailure: string | null;
}) {
  const suggestion = suggestCloneDestination({
    repository,
    target: machine,
    machines: fleet.machines,
    occupied: checkoutPaths(fleet.repositories, machine.id),
  });
  const [draft, setDraft] = useState(() =>
    draftFromSuggestion({ machine, suggestion, repositoryName: repository.name }),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const { start, pending, failure } = useStartBatch();
  const inputId = useId();
  const label = machineLabel(machine);
  const root = machine.discoveryRoots.find(({ path }) => path === draft.root);
  const rootMissing = root?.status === "Missing" || root?.status === "NotFolder";
  let submitLabel = lastFailure === null ? `Clone to ${label}` : "Clone again";

  if (pending) {
    submitLabel = "Starting…";
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();

        const found = draftProblem({ draft, machine, repositories: fleet.repositories });

        setProblem(found);

        if (found !== null) {
          document.getElementById(inputId)?.focus();

          return;
        }

        start({
          _tag: "Clone",
          repositoryKey: repository.key,
          targets: [{ machineId: machine.id, destination: draftPath(draft) }],
        });
      }}
      className="space-y-3 text-sm"
    >
      {lastFailure !== null && (
        <p className="flex items-start gap-2 rounded-lg bg-danger-soft px-2.5 py-2 text-danger">
          <TriangleAlertIcon className="mt-0.5" />
          <span className="min-w-0 break-words">
            The last clone failed: <PersonalText>{lastFailure}</PersonalText>
          </span>
        </p>
      )}
      <div>
        <p className="text-ink-muted">From</p>
        <p className="mt-1 font-mono text-[13px] break-all">
          <PersonalText>{source}</PersonalText>
        </p>
      </div>
      <div>
        <CloneDestinationField
          id={inputId}
          label="Into"
          machine={machine}
          value={draft}
          invalid={problem !== null}
          describedBy={`${inputId}-help`}
          onChange={setDraft}
        />
        <p
          id={`${inputId}-help`}
          className={`mt-1 ${problem === null ? "text-ink-muted" : "text-danger"}`}
        >
          {problem ?? "A new folder for the clone to create."}
        </p>
        {problem === null && rootMissing && (
          <p className="mt-1 text-changes">
            {draft.root} doesn't exist on {label}. Choose another project folder, or fix it on the
            Machines page.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button tone="primary" type="submit" disabled={pending}>
          <FolderDownIcon />
          {submitLabel}
        </Button>
        <p role="status" className="text-danger">
          {failure}
        </p>
      </div>
    </form>
  );
}

/**
 * A repository on a machine that doesn't have it: whether that's certain, then its clone, which
 * can start from here, is under way, or can't happen and why.
 */
export function CloneSections({
  fleet,
  repository,
  machine,
}: {
  readonly fleet: Fleet;
  readonly repository: Repository;
  readonly machine: Machine;
}) {
  const runs = useRuns();
  const role = useRole();
  const target = { machineId: machine.id, repositoryKey: repository.key };
  const cloning = activeCloneFor(runs, target);
  const last = latestCloneFor(runs, target);
  const lastOutcome =
    last?.state._tag === "Finished" && last.state.outcome._tag !== "Succeeded"
      ? describeOutcome(last.state.outcome)
      : null;
  const source = cloneSource(repository);
  const blocker = cloneBlocker(machine);
  let clone = (
    <p className="text-sm text-ink-muted">
      No machine has a remote for it, so there's nothing to clone it from.
    </p>
  );

  if (cloning !== undefined) {
    clone = <Cloning run={cloning} />;
  } else if (blocker !== null) {
    clone = (
      <div className="space-y-2 text-sm">
        <p className="text-ink-muted">
          It can't be cloned onto {machineLabel(machine)} now: {blocker}.
        </p>
        {machine.discoveryRoots.length === 0 && role === "admin" && (
          <Link
            to="/settings/fleet/$machineId"
            params={{ machineId: machine.id }}
            className="inline-block text-accent-text underline-offset-2 hover:underline"
          >
            Set its project folders
          </Link>
        )}
      </div>
    );
  } else if (source !== undefined) {
    clone = (
      <CloneForm
        fleet={fleet}
        repository={repository}
        machine={machine}
        source={source}
        lastFailure={lastOutcome === null ? null : (lastOutcome.detail ?? lastOutcome.summary)}
      />
    );
  }

  return (
    <>
      <Whereabouts fleet={fleet} repository={repository} machine={machine} />
      <PanelSection title="Clone" icon={FolderDownIcon} tone="neutral">
        {clone}
      </PanelSection>
    </>
  );
}
