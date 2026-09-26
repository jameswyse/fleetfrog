import { useActionState, useState, useTransition } from "react";

import { Link, useNavigate, useParams } from "@tanstack/react-router";

import { knownFleet, requestHub, useHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SideDetail,
  SidePanel,
} from "../SettingsPage.tsx";
import { SaveStatus, useAutoSave } from "../useAutoSave.tsx";
import { DiscoveryFolders } from "./DiscoveryFolders.tsx";
import { ActionsText, ConnectionStatus, repositoryCount } from "./MachineStatus.tsx";
import { describeDisk, describeLoad, formatMemory } from "./systemFormat.ts";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";

/** The last rescan request, reported beside its button. Its wording carries the outcome. */
type Notice =
  | { readonly _tag: "None" }
  | { readonly _tag: "Succeeded"; readonly message: string }
  | { readonly _tag: "Failed"; readonly message: string };

function NoticeText({ notice }: { readonly notice: Notice }) {
  return (
    <p role="status" className="text-sm">
      {notice._tag === "Succeeded" && <span className="text-clean">{notice.message}</span>}
      {notice._tag === "Failed" && <span className="text-danger">{notice.message}</span>}
    </p>
  );
}

function RemoveMachineDialog({
  machine,
  onClose,
  onRemoved,
}: {
  readonly machine: Machine;
  readonly onClose: () => void;
  readonly onRemoved: () => void;
}) {
  const [error, remove, removing] = useActionState(async (): Promise<string | null> => {
    const result = await requestHub((client) => client.RemoveMachine({ machineId: machine.id }));

    if (result._tag === "Failure") {
      return result.message;
    }

    onRemoved();

    return null;
  }, null);

  return (
    <Dialog title={`Remove ${machineLabel(machine)}?`} onClose={onClose}>
      <form action={remove} className="space-y-4 text-sm">
        <p>
          Its agent will be disconnected and its token will stop working. Its repositories disappear
          from the overview. To add it back, pair it again.
        </p>
        {error !== null && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="danger" type="submit" disabled={removing}>
            {removing ? "Removing…" : "Remove machine"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Where the machine stands now, for the side column. */
function StatusPanel({ fleet, machine }: { readonly fleet: Fleet; readonly machine: Machine }) {
  const repositories = repositoryCount(fleet, machine);

  return (
    <SidePanel title="Status">
      <SideDetail term="Connection">
        <ConnectionStatus machine={machine} />
      </SideDetail>
      <SideDetail term="Repositories">
        {repositories} {repositories === 1 ? "repository" : "repositories"}
      </SideDetail>
      <SideDetail term="Last scan">
        {machine.lastStatusAt === null ? "Not yet" : <RelativeTime at={machine.lastStatusAt} />}
      </SideDetail>
      <SideDetail term="Last discovery walk">
        {machine.lastDiscoveryAt === null ? (
          "Not yet"
        ) : (
          <RelativeTime at={machine.lastDiscoveryAt} />
        )}
      </SideDetail>
      <SideDetail term="Actions">
        <ActionsText machine={machine} />
      </SideDetail>
      <SideDetail term="GitHub CLI">
        {machine.info.githubCli._tag === "Available"
          ? `Signed in as ${machine.info.githubCli.login}`
          : "Not available"}
      </SideDetail>
      <SideDetail term="Paired">
        <RelativeTime at={machine.pairedAt} />
      </SideDetail>
    </SidePanel>
  );
}

/** Hardware, software and resources as the agent last reported them, for the side column. */
function SystemPanel({ machine }: { readonly machine: Machine }) {
  const { system } = machine.info;
  const { usage } = machine;

  if (system === null) {
    return (
      <SidePanel title="System">
        <SideDetail term="Not available">
          This machine's agent is too old to report its system. Update the agent to see its
          processor, memory, disk and versions.
        </SideDetail>
      </SidePanel>
    );
  }

  return (
    <SidePanel title="System">
      <SideDetail term="Operating system">
        {system.os} <span className="text-ink-muted">· {system.architecture}</span>
      </SideDetail>
      <SideDetail term="Kernel">{system.kernel}</SideDetail>
      <SideDetail term="Processor">
        {system.cpu.model}{" "}
        <span className="text-ink-muted">
          · {system.cpu.cores} {system.cpu.cores === 1 ? "core" : "cores"}
        </span>
      </SideDetail>
      <SideDetail term="Memory">{formatMemory(system.memoryBytes)}</SideDetail>
      <SideDetail term="Disk">
        {usage === null || usage.disk === null ? "Not reported yet" : describeDisk(usage.disk)}
      </SideDetail>
      <SideDetail term="Load average (1, 5 and 15 minutes)">
        {usage === null ? "Not reported yet" : describeLoad(usage.loadAverage)}
      </SideDetail>
      <SideDetail term="Last restarted">
        <RelativeTime at={system.bootedAt} />
      </SideDetail>
      <SideDetail term="Versions">
        Agent {machine.info.agentVersion} · Node {system.versions.node}
        {system.versions.git !== null && ` · Git ${system.versions.git}`}
      </SideDetail>
      {usage !== null && (
        <p className="text-xs text-ink-muted">
          {machine.connection._tag === "Offline"
            ? "Disk and load last measured"
            : "Disk and load measured"}{" "}
          <RelativeTime at={usage.sampledAt} />
        </p>
      )}
    </SidePanel>
  );
}

/** The machine's saved settings. Each one saves itself as it changes. */
function ConfigurationSection({ machine }: { readonly machine: Machine }) {
  const { state, save } = useAutoSave();
  const nameId = `name-${machine.id}`;
  const computerName = machine.info.prettyName ?? machine.info.hostname;

  const saveName = (input: HTMLInputElement) => {
    const typed = input.value.trim();
    const customName = typed === "" ? null : typed;

    if (customName !== machine.customName) {
      save(() =>
        requestHub((client) => client.RenameMachine({ machineId: machine.id, customName })),
      );
    }
  };

  return (
    <SettingsSection title="Configuration" status={<SaveStatus state={state} />}>
      {/* Keyed on the saved values, so a change from the hub replaces what is shown. */}
      <SettingsRow
        title="Display name"
        description={`Shown instead of the computer's own name, ${computerName}. Leave it empty to use that.`}
        htmlFor={nameId}
        control={
          <input
            key={machine.customName ?? ""}
            id={nameId}
            aria-describedby={`${nameId}-description`}
            defaultValue={machine.customName ?? ""}
            placeholder={computerName}
            autoComplete="off"
            onBlur={(event) => saveName(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            className="min-h-9 w-64 rounded-md border border-line bg-canvas px-2.5 text-sm"
          />
        }
      />
      <SettingsRow
        title="Discovery folders"
        description="The agent looks for repositories up to five folders deep. ~ means the home folder. Clones go into the default folder unless another machine keeps the repository somewhere these folders cover."
      >
        <DiscoveryFolders
          machineId={machine.id}
          roots={machine.discoveryRoots}
          onChange={(roots) =>
            save(() =>
              requestHub((client) =>
                client.SetDiscoveryRoots({ machineId: machine.id, roots: [...roots] }),
              ),
            )
          }
        />
      </SettingsRow>
    </SettingsSection>
  );
}

/** Things to do to the machine now, apart from its saved configuration. */
function ActionsSection({ machine }: { readonly machine: Machine }) {
  const [rescanning, startRescan] = useTransition();
  const [notice, setNotice] = useState<Notice>({ _tag: "None" });
  const [removing, setRemoving] = useState(false);
  const navigate = useNavigate();

  const rescan = () =>
    startRescan(async () => {
      const result = await requestHub((client) =>
        client.Refresh({ target: { _tag: "Machine", machineId: machine.id } }),
      );

      setNotice(
        result._tag === "Success"
          ? {
              _tag: "Succeeded",
              message: "Rescan requested. The overview updates when it finishes.",
            }
          : { _tag: "Failed", message: `Couldn't start a rescan. ${result.message}` },
      );
    });

  return (
    <SettingsSection title="Actions">
      <SettingsRow
        title="Rescan"
        description="Walk the discovery folders and read every checkout again now."
        control={
          <Button disabled={machine.connection._tag === "Offline" || rescanning} onClick={rescan}>
            {rescanning ? "Requesting rescan…" : "Rescan now"}
          </Button>
        }
      >
        {notice._tag === "None" ? undefined : <NoticeText notice={notice} />}
      </SettingsRow>
      <SettingsRow
        title="Activity"
        description="Actions and changes that involved this machine."
        control={
          <Link
            to="/activity"
            search={{ machine: machine.id }}
            className="inline-flex min-h-9 items-center rounded-md border border-line px-3 text-sm font-medium hover:bg-surface-raised"
          >
            View activity
          </Link>
        }
      />
      <SettingsRow
        title="Remove machine"
        description="Disconnects its agent and revokes its token. Its repositories leave the overview until it is paired again."
        control={
          <Button tone="danger" onClick={() => setRemoving(true)}>
            Remove machine…
          </Button>
        }
      />
      {removing && (
        <RemoveMachineDialog
          machine={machine}
          onClose={() => setRemoving(false)}
          onRemoved={() => {
            void navigate({ to: "/settings/fleet" });
          }}
        />
      )}
    </SettingsSection>
  );
}

/** One machine's configuration and actions, with its status and system beside them. */
export function MachineSettings() {
  const { machineId } = useParams({ from: "/_app/settings/fleet/$machineId" });
  const hub = useHub();
  const fleet = knownFleet(hub);
  const machine = fleet?.machines.find(({ id }) => id === machineId);

  if (fleet === null || machine === undefined) {
    return (
      <SettingsPage trail={[{ label: "Fleet", to: "/settings/fleet" }, { label: "Machine" }]}>
        {fleet === null ? (
          <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
        ) : (
          <div className="py-16 text-center text-sm">
            <p className="font-medium">This machine isn't paired</p>
            <p className="mt-1 text-ink-muted">It may have been removed.</p>
            <Link to="/settings/fleet" className="mt-4 inline-block text-sync hover:underline">
              See all machines
            </Link>
          </div>
        )}
      </SettingsPage>
    );
  }

  // Keyed on the machine so drafts and notices never carry over to another machine.
  return (
    <SettingsPage
      key={machine.id}
      trail={[{ label: "Fleet", to: "/settings/fleet" }, { label: machineLabel(machine) }]}
      action={<span className="font-mono text-[13px] text-ink-muted">{machine.info.hostname}</span>}
      aside={
        <>
          <StatusPanel fleet={fleet} machine={machine} />
          <SystemPanel machine={machine} />
        </>
      }
    >
      <ConfigurationSection machine={machine} />
      <ActionsSection machine={machine} />
    </SettingsPage>
  );
}
