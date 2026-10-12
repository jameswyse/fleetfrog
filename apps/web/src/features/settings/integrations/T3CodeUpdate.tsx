import { useState, useTransition } from "react";

import { ArrowUpRightIcon } from "lucide-react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { plural } from "@/ui/plural.ts";
import {
  availableT3CodeVersion,
  canUpdateT3Code,
  workingT3CodeThreads,
} from "@fleetfrog/protocol/domain/t3CodeUpdate";

import { SettingsRow } from "../SettingsSection.tsx";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeUpdate } from "@fleetfrog/protocol/domain/t3CodeUpdate";

function releaseUrl(version: string): string {
  return `https://github.com/pingdotgg/t3code/releases/tag/v${version}`;
}

function describeVersion(machine: Machine, running: string, available: string): string {
  const runs = `Runs ${running}. ${available} is available.`;
  const working = workingT3CodeThreads(machine.t3Code);

  if (machine.t3CodeUpdate?._tag === "Updating") {
    return `Installing ${machine.t3CodeUpdate.version}. T3 Code will restart when the update finishes.`;
  }

  if (machine.connection._tag === "Offline") {
    return `${runs} It can update once the machine is online.`;
  }

  if (!machine.connection.capabilities.updatesT3Code) {
    return `${runs} This machine's agent is too old to update T3 Code. Update the agent first.`;
  }

  if (machine.t3Code?.server?.serviceManaged !== true) {
    return `${runs} T3 Code runs in its desktop app here, which updates itself.`;
  }

  if (machine.t3Code.reading._tag !== "Read" || machine.t3Code.reading.unreadRecords > 0) {
    return `${runs} FleetFrog can't read all of T3 Code's database here, so it can't tell whether a thread is running. Update T3 Code on the machine itself.`;
  }

  if (!machine.connection.capabilities.allowedTiers.includes("t3code")) {
    return `${runs} The machine's owner hasn't allowed T3 Code updates from the hub. Run fleetfrog allow t3code on the machine to allow them.`;
  }

  if (working > 0) {
    return `${runs} T3 Code is running ${plural(working, "thread")}, so it can update once ${working === 1 ? "it finishes" : "they finish"}.`;
  }

  return `${runs} Updating restarts T3 Code.`;
}

function updateLabel({
  updating,
  failure,
  version,
}: {
  readonly updating: boolean;
  readonly failure: T3CodeUpdate | null;
  readonly version: string;
}): string {
  if (updating) {
    return "Updating…";
  }

  return failure === null ? `Update to ${version}` : "Try again";
}

export function T3CodeUpdateRow({
  fleet,
  machine,
}: {
  readonly fleet: Fleet;
  readonly machine: Machine;
}) {
  const [requesting, startRequest] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const running = machine.t3Code?.server?.version ?? null;
  const available = availableT3CodeVersion(machine.t3Code, fleet.t3CodeReleases);
  const update = machine.t3CodeUpdate;
  const failure = update?._tag === "Failed" ? update : null;

  const message =
    error ??
    (failure === null ? null : `Couldn't update to ${failure.version}. ${failure.message}`);

  const start = () =>
    startRequest(async () => {
      const result = await requestHub((client) => client.UpdateT3Code({ machineId: machine.id }));

      setError(result._tag === "Failure" ? `Couldn't start the update. ${result.message}` : null);
    });

  if (running === null || available === null || !fleet.integrations.t3Code.enabled) {
    return null;
  }

  return (
    <SettingsRow
      title="Update T3 Code"
      description={describeVersion(machine, running, available)}
      control={
        <div className="flex items-center gap-4">
          <a
            href={releaseUrl(available)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-sm text-accent-text underline-offset-2 hover:underline"
          >
            What's new
            <ArrowUpRightIcon className="size-3.5" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <span role="status" className="sr-only">
            {update?._tag === "Updating" ? `Updating T3 Code to ${update.version}` : ""}
          </span>
          <Button
            tone="primary"
            disabled={requesting || !canUpdateT3Code(machine, fleet.t3CodeReleases)}
            onClick={start}
          >
            {updateLabel({
              updating: requesting || update?._tag === "Updating",
              failure,
              version: available,
            })}
          </Button>
        </div>
      }
    >
      {message !== null && (
        <p role="status" className="text-sm text-danger">
          {message}
        </p>
      )}
    </SettingsRow>
  );
}

function updateState(machine: Machine, available: string) {
  if (machine.t3CodeUpdate?._tag === "Updating") {
    return <span className="text-sync">Updating to {available}</span>;
  }

  if (machine.t3CodeUpdate?._tag === "Failed") {
    return <span className="text-danger">Update to {machine.t3CodeUpdate.version} failed</span>;
  }

  return <span className="text-changes">{available} available</span>;
}

export function T3CodeUpdateDetail({
  fleet,
  machine,
}: {
  readonly fleet: Fleet;
  readonly machine: Machine;
}) {
  const available = availableT3CodeVersion(machine.t3Code, fleet.t3CodeReleases);

  if (available === null) {
    return null;
  }

  return (
    <>
      <dt className="sr-only">Update</dt>
      <dd>{updateState(machine, available)}</dd>
    </>
  );
}

export function UpdateAllT3Code({ fleet }: { readonly fleet: Fleet }) {
  const [requesting, startRequest] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const updatable = fleet.integrations.t3Code.enabled
    ? fleet.machines.filter((machine) => canUpdateT3Code(machine, fleet.t3CodeReleases))
    : [];

  if (updatable.length === 0 && error === null) {
    return null;
  }

  const start = () =>
    startRequest(async () => {
      const results = await Promise.all(
        updatable.map((machine) =>
          requestHub((client) => client.UpdateT3Code({ machineId: machine.id })),
        ),
      );

      const failed = results.filter((result) => result._tag === "Failure").length;

      setError(
        failed === 0
          ? null
          : `Couldn't start ${plural(failed, "update")}. Open the machine to try again.`,
      );
    });

  return (
    <div className="flex items-center gap-3">
      {error !== null && (
        <p role="status" className="text-sm text-danger">
          {error}
        </p>
      )}
      {updatable.length > 0 && (
        <Button disabled={requesting} onClick={start}>
          {requesting ? "Updating…" : `Update T3 Code on ${plural(updatable.length, "machine")}`}
        </Button>
      )}
    </div>
  );
}
