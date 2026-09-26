import { useActionState, useState, useTransition } from "react";

import { Link, useNavigate, useParams } from "@tanstack/react-router";

import { knownFleet, requestHub, useHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { SettingsHeading } from "../SettingsHeading.tsx";
import { DiscoveryFolders } from "./DiscoveryFolders.tsx";
import {
  ActionsText,
  ConnectionStatus,
  describePlatform,
  repositoryCount,
} from "./MachineStatus.tsx";

import type { ReactNode } from "react";

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

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="mb-5 rounded-lg border border-line bg-surface px-5 py-5">
      <h2 className="mb-4 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Detail({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div>
      <dt className="text-ink-muted">{term}</dt>
      <dd>{children}</dd>
    </div>
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
    <Section title="Status">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Detail term="Repositories">
          {repositories} {repositories === 1 ? "repository" : "repositories"}
        </Detail>
        <Detail term="Last scan">
          {machine.lastStatusAt === null ? "Not yet" : <RelativeTime at={machine.lastStatusAt} />}
        </Detail>
        <Detail term="Last discovery walk">
          {machine.lastDiscoveryAt === null ? (
            "Not yet"
          ) : (
            <RelativeTime at={machine.lastDiscoveryAt} />
          )}
        </Detail>
        <Detail term="GitHub CLI">
          {machine.info.githubCli._tag === "Available"
            ? `Signed in as ${machine.info.githubCli.login}`
            : "Not available"}
        </Detail>
        <Detail term="Actions">
          <ActionsText machine={machine} />
        </Detail>
        <Detail term="Paired">
          <RelativeTime at={machine.pairedAt} />
        </Detail>
      </dl>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button disabled={machine.connection._tag === "Offline" || rescanning} onClick={rescan}>
          {rescanning ? "Requesting rescan…" : "Rescan now"}
        </Button>
        <Link
          to="/activity"
          search={{ machine: machine.id }}
          className="text-sm text-sync underline-offset-2 hover:underline"
        >
          View this machine's activity
        </Link>
        <div className="basis-full">
          <NoticeText notice={notice} />
        </div>
      </div>
    </Section>
  );
}

function ConfigurationSection({ machine }: { readonly machine: Machine }) {
  const [saving, startSaving] = useTransition();
  const [notice, setNotice] = useState<Notice>({ _tag: "None" });

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
    <Section title="Configuration">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(new FormData(event.currentTarget));
        }}
        className="space-y-5"
      >
        {/* Drafts are keyed on the saved values, so a change from the hub replaces the draft. */}
        <label className="block text-sm">
          <span className="font-medium">Display name</span>
          <input
            key={machine.customName ?? ""}
            name="name"
            defaultValue={machine.customName ?? ""}
            placeholder={machine.info.prettyName ?? machine.info.hostname}
            autoComplete="off"
            className="mt-1 block min-h-9 w-full max-w-sm rounded-md border border-line bg-canvas px-2.5"
          />
        </label>
        <DiscoveryFolders
          key={machine.discoveryRoots.map(({ path }) => path).join("\n")}
          machineId={machine.id}
          roots={machine.discoveryRoots}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <NoticeText notice={notice} />
        </div>
      </form>
    </Section>
  );
}

function RemoveSection({ machine }: { readonly machine: Machine }) {
  const [removing, setRemoving] = useState(false);
  const navigate = useNavigate();

  return (
    <Section title="Remove machine">
      <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
        <p className="max-w-md text-ink-muted">
          Disconnects its agent and revokes its token. Its repositories leave the overview until it
          is paired again.
        </p>
        <Button tone="danger" onClick={() => setRemoving(true)}>
          Remove machine…
        </Button>
      </div>
      {removing && (
        <RemoveMachineDialog
          machine={machine}
          onClose={() => setRemoving(false)}
          onRemoved={() => {
            void navigate({ to: "/settings/fleet" });
          }}
        />
      )}
    </Section>
  );
}

/** One machine's status, configuration and removal. */
export function MachineSettings() {
  const { machineId } = useParams({ from: "/settings/fleet/$machineId" });
  const hub = useHub();
  const fleet = knownFleet(hub);
  const machine = fleet?.machines.find(({ id }) => id === machineId);

  if (fleet === null) {
    return <p className="py-24 text-center text-sm text-ink-muted">Waiting for the hub…</p>;
  }

  if (machine === undefined) {
    return (
      <div className="py-24 text-center text-sm">
        <p className="font-medium">This machine isn't paired</p>
        <p className="mt-1 text-ink-muted">It may have been removed.</p>
        <Link to="/settings/fleet" className="mt-4 inline-block text-sync hover:underline">
          See all machines
        </Link>
      </div>
    );
  }

  // Keyed on the machine so drafts and notices never carry over to another machine.
  return (
    <div key={machine.id}>
      <SettingsHeading
        title={machineLabel(machine)}
        action={
          <span className="text-sm">
            <ConnectionStatus machine={machine} />
          </span>
        }
      >
        <span className="font-mono text-[13px]">{machine.info.hostname}</span> ·{" "}
        {describePlatform(machine)} · agent {machine.info.agentVersion}
      </SettingsHeading>
      <StatusSection fleet={fleet} machine={machine} />
      <ConfigurationSection machine={machine} />
      <RemoveSection machine={machine} />
    </div>
  );
}
