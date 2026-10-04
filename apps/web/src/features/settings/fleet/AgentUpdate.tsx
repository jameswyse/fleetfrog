import { useState, useTransition } from "react";

import { ArrowUpRightIcon } from "lucide-react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Chip } from "@/ui/Chip.tsx";
import { plural } from "@/ui/plural.ts";
import { agentBehindHub, canUpdateAgent } from "@fleetfrog/protocol/domain/agentUpdate";

import { SettingsRow } from "../SettingsSection.tsx";

import type { AgentUpdate } from "@fleetfrog/protocol/domain/agentUpdate";
import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";

function changelogUrl(hubVersion: string): string {
  return `https://github.com/jameswyse/fleetfrog/blob/v${hubVersion}/apps/agent-rs/CHANGELOG.md`;
}

function describeVersion(machine: Machine, hubVersion: string): string {
  const { agentVersion } = machine.info;

  if (machine.update?._tag === "Updating") {
    return `Installing ${machine.update.version}. The agent restarts on it and reconnects.`;
  }

  if (machine.connection._tag === "Offline") {
    return `Runs ${agentVersion}, older than the hub's ${hubVersion}. It can update once the machine is online.`;
  }

  if (!machine.connection.capabilities.updatesItself) {
    return `Runs ${agentVersion}, older than the hub's ${hubVersion}. This agent can't update itself. Run the install command on the machine, or pull and rebuild the agent if it runs from source.`;
  }

  if (!machine.connection.capabilities.allowedTiers.includes("update")) {
    return `Runs ${agentVersion}, older than the hub's ${hubVersion}. The machine's owner hasn't allowed updates from the hub. Run fleetfrog update on the machine, or fleetfrog allow update to let the hub update it.`;
  }

  return `Runs ${agentVersion}. The hub runs ${hubVersion}, which the agent should match.`;
}

function updateLabel({
  updating,
  failure,
  hubVersion,
}: {
  readonly updating: boolean;
  readonly failure: AgentUpdate | null;
  readonly hubVersion: string;
}): string {
  if (updating) {
    return "Updating…";
  }

  return failure === null ? `Update to ${hubVersion}` : "Try again";
}

export function AgentUpdateRow({
  fleet,
  machine,
}: {
  readonly fleet: Fleet;
  readonly machine: Machine;
}) {
  const [requesting, startRequest] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { hubVersion } = fleet;
  const { update } = machine;
  const failure = update?._tag === "Failed" ? update : null;

  const message =
    error ??
    (failure === null ? null : `Couldn't update to ${failure.version}. ${failure.message}`);

  const start = () =>
    startRequest(async () => {
      const result = await requestHub((client) => client.UpdateAgent({ machineId: machine.id }));

      setError(result._tag === "Failure" ? `Couldn't start the update. ${result.message}` : null);
    });

  if (!agentBehindHub(machine, hubVersion)) {
    return null;
  }

  return (
    <SettingsRow
      title="Update agent"
      description={describeVersion(machine, hubVersion)}
      control={
        <div className="flex items-center gap-4">
          <a
            href={changelogUrl(hubVersion)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-sm text-accent-text underline-offset-2 hover:underline"
          >
            What's new
            <ArrowUpRightIcon className="size-3.5" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <Button
            tone="primary"
            disabled={requesting || !canUpdateAgent(machine, hubVersion)}
            onClick={start}
          >
            {updateLabel({
              updating: requesting || update?._tag === "Updating",
              failure,
              hubVersion,
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

export function AgentUpdateChip({
  fleet,
  machine,
}: {
  readonly fleet: Fleet;
  readonly machine: Machine;
}) {
  if (!agentBehindHub(machine, fleet.hubVersion)) {
    return null;
  }

  if (machine.update === null) {
    return <Chip tone="changes">Agent update available</Chip>;
  }

  return machine.update._tag === "Updating" ? (
    <Chip tone="sync">Updating agent</Chip>
  ) : (
    <Chip tone="danger">Agent update failed</Chip>
  );
}

export function UpdateAllAgents({ fleet }: { readonly fleet: Fleet }) {
  const [requesting, startRequest] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const updatable = fleet.machines.filter((machine) => canUpdateAgent(machine, fleet.hubVersion));

  if (updatable.length === 0 && error === null) {
    return null;
  }

  const start = () =>
    startRequest(async () => {
      const results = await Promise.all(
        updatable.map((machine) =>
          requestHub((client) => client.UpdateAgent({ machineId: machine.id })),
        ),
      );

      const failed = results.filter((result) => result._tag === "Failure").length;

      setError(
        failed === 0
          ? null
          : `Couldn't start ${plural(failed, "update", "updates")}. Open the machine to try again.`,
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
          {requesting
            ? "Updating…"
            : `Update ${plural(updatable.length, "agent", "agents")} to ${fleet.hubVersion}`}
        </Button>
      )}
    </div>
  );
}
