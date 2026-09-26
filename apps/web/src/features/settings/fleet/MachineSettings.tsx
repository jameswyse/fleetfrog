import { useActionState, useState, useTransition } from "react";

import { Link, useNavigate, useParams } from "@tanstack/react-router";

import { knownFleet, requestHub, useHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import {
  DetailList,
  DetailRow,
  SettingsFooter,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "../SettingsPage.tsx";
import { DiscoveryFolders } from "./DiscoveryFolders.tsx";
import { ActionsText, ConnectionStatus, repositoryCount } from "./MachineStatus.tsx";
import { describeDisk, describeLoad, formatMemory } from "./systemFormat.ts";

import type { HubResult } from "@/rpc/hubConnection.ts";
import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";

/** The last save or rescan, reported beside its controls. Its wording carries the outcome. */
type Notice =
  | { readonly _tag: "None" }
  | { readonly _tag: "Succeeded"; readonly message: string }
  | { readonly _tag: "Failed"; readonly message: string };

type Update = { readonly part: string; readonly result: HubResult<void> };

function sameRoots(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((root, index) => root === right[index]);
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);

  return value === null || value instanceof File ? "" : value;
}

/** Describes a save in which only some of the updates may have succeeded. */
function describeSave(updates: ReadonlyArray<Update>): Notice {
  const failures = updates.flatMap(({ part, result }) =>
    result._tag === "Failure" ? [{ part, message: result.message }] : [],
  );
  const [firstFailure] = failures;

  if (firstFailure === undefined) {
    return { _tag: "Succeeded", message: "Saved." };
  }

  const notSaved = failures.map(({ part }) => part).join(" or the ");
  const saved = updates
    .filter(({ result }) => result._tag === "Success")
    .map(({ part }) => part)
    .join(" and the ");

  return {
    _tag: "Failed",
    message:
      saved === ""
        ? `Couldn't save the ${notSaved}. ${firstFailure.message}`
        : `Saved the ${saved}, but not the ${notSaved}. ${firstFailure.message}`,
  };
}

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

function StatusSection({ fleet, machine }: { readonly fleet: Fleet; readonly machine: Machine }) {
  const [rescanning, startRescan] = useTransition();
  const [notice, setNotice] = useState<Notice>({ _tag: "None" });
  const repositories = repositoryCount(fleet, machine);

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
    <SettingsSection title="Status">
      <DetailList>
        <DetailRow term="Connection">
          <ConnectionStatus machine={machine} />
        </DetailRow>
        <DetailRow term="Repositories">
          {repositories} {repositories === 1 ? "repository" : "repositories"}
        </DetailRow>
        <DetailRow term="Last scan">
          {machine.lastStatusAt === null ? "Not yet" : <RelativeTime at={machine.lastStatusAt} />}
        </DetailRow>
        <DetailRow term="Last discovery walk">
          {machine.lastDiscoveryAt === null ? (
            "Not yet"
          ) : (
            <RelativeTime at={machine.lastDiscoveryAt} />
          )}
        </DetailRow>
        <DetailRow term="Actions">
          <ActionsText machine={machine} />
        </DetailRow>
        <DetailRow term="GitHub CLI">
          {machine.info.githubCli._tag === "Available"
            ? `Signed in as ${machine.info.githubCli.login}`
            : "Not available"}
        </DetailRow>
        <DetailRow term="Paired">
          <RelativeTime at={machine.pairedAt} />
        </DetailRow>
      </DetailList>
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
    </SettingsSection>
  );
}

/** Hardware, software and resources, as the agent last reported them. */
function SystemSection({ machine }: { readonly machine: Machine }) {
  const { system } = machine.info;
  const { usage } = machine;
  const offline = machine.connection._tag === "Offline";
  const measured =
    usage === null ? undefined : (
      <>
        {offline ? "Last measured" : "Measured"} <RelativeTime at={usage.sampledAt} />
      </>
    );

  if (system === null) {
    return (
      <SettingsSection title="System">
        <SettingsRow
          title="System details aren't available"
          description="This machine's agent is too old to report them. Update the agent to see its processor, memory, disk and versions."
        />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="System">
      <DetailList>
        <DetailRow term="Operating system">
          {system.os} <span className="text-ink-muted">· {system.architecture}</span>
        </DetailRow>
        <DetailRow term="Kernel">{system.kernel}</DetailRow>
        <DetailRow term="Processor">
          {system.cpu.model}{" "}
          <span className="text-ink-muted">
            · {system.cpu.cores} {system.cpu.cores === 1 ? "core" : "cores"}
          </span>
        </DetailRow>
        <DetailRow term="Memory">{formatMemory(system.memoryBytes)}</DetailRow>
        <DetailRow term="Disk" note={measured}>
          {usage === null || usage.disk === null ? "Not reported yet" : describeDisk(usage.disk)}
        </DetailRow>
        <DetailRow term="Load average" note="Over 1, 5 and 15 minutes">
          {usage === null ? "Not reported yet" : describeLoad(usage.loadAverage)}
        </DetailRow>
        <DetailRow term="Last restarted">
          <RelativeTime at={system.bootedAt} />
        </DetailRow>
        <DetailRow term="Versions">
          Agent {machine.info.agentVersion} · Node {system.versions.node}
          {system.versions.git !== null && ` · Git ${system.versions.git}`}
        </DetailRow>
      </DetailList>
    </SettingsSection>
  );
}

function ConfigurationSection({ machine }: { readonly machine: Machine }) {
  const [saving, startSaving] = useTransition();
  const [notice, setNotice] = useState<Notice>({ _tag: "None" });
  const nameId = `name-${machine.id}`;

  const save = (form: FormData) =>
    startSaving(async () => {
      const typedName = formText(form, "name").trim();
      const customName = typedName === "" ? null : typedName;
      const roots = form
        .getAll("root")
        .map((root) => (root instanceof File ? "" : root.trim()))
        .filter((root) => root !== "");
      const updates: Array<Update> = [];

      if (customName !== machine.customName) {
        updates.push({
          part: "display name",
          result: await requestHub((client) =>
            client.RenameMachine({ machineId: machine.id, customName }),
          ),
        });
      }

      if (
        !sameRoots(
          roots,
          machine.discoveryRoots.map(({ path }) => path),
        )
      ) {
        updates.push({
          part: "discovery folders",
          result: await requestHub((client) =>
            client.SetDiscoveryRoots({ machineId: machine.id, roots }),
          ),
        });
      }

      setNotice(
        updates.length === 0
          ? { _tag: "Succeeded", message: "No changes to save." }
          : describeSave(updates),
      );
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save(new FormData(event.currentTarget));
      }}
    >
      <SettingsSection title="Configuration">
        {/* Drafts are keyed on the saved values, so a change from the hub replaces the draft. */}
        <SettingsRow
          title="Display name"
          description={`Shown instead of the computer's own name, ${machine.info.prettyName ?? machine.info.hostname}.`}
          htmlFor={nameId}
          control={
            <input
              key={machine.customName ?? ""}
              id={nameId}
              name="name"
              aria-describedby={`${nameId}-description`}
              defaultValue={machine.customName ?? ""}
              placeholder={machine.info.prettyName ?? machine.info.hostname}
              autoComplete="off"
              className="min-h-9 w-64 rounded-md border border-line bg-canvas px-2.5 text-sm"
            />
          }
        />
        <div className="px-5 py-4">
          <DiscoveryFolders
            key={machine.discoveryRoots.map(({ path }) => path).join("\n")}
            machineId={machine.id}
            roots={machine.discoveryRoots}
          />
        </div>
        <SettingsFooter>
          <div className="me-auto">
            <NoticeText notice={notice} />
          </div>
          <Button tone="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </SettingsFooter>
      </SettingsSection>
    </form>
  );
}

function RemoveSection({ machine }: { readonly machine: Machine }) {
  const [removing, setRemoving] = useState(false);
  const navigate = useNavigate();

  return (
    <SettingsSection title="Removal">
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

/** One machine's status, system, configuration and removal. */
export function MachineSettings() {
  const { machineId } = useParams({ from: "/settings/fleet/$machineId" });
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
    >
      <StatusSection fleet={fleet} machine={machine} />
      <SystemSection machine={machine} />
      <ConfigurationSection machine={machine} />
      <RemoveSection machine={machine} />
    </SettingsPage>
  );
}
