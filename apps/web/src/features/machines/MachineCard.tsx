import { useActionState, useState, useTransition } from "react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import type { Machine } from "@fleetfrog/protocol/domain/fleet";

type SaveState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Saved" }
  | { readonly _tag: "Failed"; readonly message: string };

function RemoveMachineDialog({
  machine,
  onClose,
}: {
  readonly machine: Machine;
  readonly onClose: () => void;
}) {
  const [error, remove, removing] = useActionState(async (): Promise<string | null> => {
    const result = await requestHub((client) => client.RemoveMachine({ machineId: machine.id }));

    return result._tag === "Failure" ? result.message : null;
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

function ConnectionText({ connection }: { readonly connection: Machine["connection"] }) {
  if (connection._tag === "Online") {
    return (
      <>
        Online since <RelativeTime at={connection.since} />
      </>
    );
  }

  if (connection.lastSeenAt === null) {
    return <>Never connected</>;
  }

  return (
    <>
      Offline, last seen <RelativeTime at={connection.lastSeenAt} />
    </>
  );
}

export function MachineCard({ machine }: { readonly machine: Machine }) {
  const [removing, setRemoving] = useState(false);
  const online = machine.connection._tag === "Online";
  const [name, setName] = useState(machine.customName ?? "");
  const [roots, setRoots] = useState(machine.discoveryRoots.join("\n"));
  const [saveState, setSaveState] = useState<SaveState>({ _tag: "Idle" });
  const [saving, startSaving] = useTransition();

  const save = () =>
    startSaving(async () => {
      const customName = name.trim();
      const discoveryRoots = roots
        .split("\n")
        .map((root) => root.trim())
        .filter((root) => root !== "");
      const renamed = await requestHub((client) =>
        client.RenameMachine({
          machineId: machine.id,
          customName: customName === "" ? null : customName,
        }),
      );
      const rooted =
        renamed._tag === "Failure"
          ? renamed
          : await requestHub((client) =>
              client.SetDiscoveryRoots({ machineId: machine.id, roots: discoveryRoots }),
            );

      setSaveState(
        rooted._tag === "Failure" ? { _tag: "Failed", message: rooted.message } : { _tag: "Saved" },
      );
    });

  return (
    <article
      aria-labelledby={`machine-${machine.id}`}
      className="rounded-lg border border-line bg-surface"
    >
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id={`machine-${machine.id}`} className="truncate font-semibold">
            {machineLabel(machine)}
          </h2>
          <p className="text-sm text-ink-muted">
            <span className="font-mono text-[13px]">{machine.info.hostname}</span> ·{" "}
            {machine.info.platform === "darwin" ? "macOS" : "Linux"} · agent{" "}
            {machine.info.agentVersion}
          </p>
        </div>
        <p
          className={`ms-auto flex items-center gap-2 text-sm ${online ? "text-clean" : "text-ink-muted"}`}
        >
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${online ? "bg-clean" : "bg-ink-muted"}`}
          />
          <ConnectionText connection={machine.connection} />
        </p>
      </header>
      <dl className="grid gap-x-6 gap-y-1 border-b border-line px-5 py-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-ink-muted">Last scan</dt>
          <dd>
            {machine.lastStatusAt === null ? "Not yet" : <RelativeTime at={machine.lastStatusAt} />}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">GitHub CLI</dt>
          <dd>
            {machine.info.githubCli._tag === "Available"
              ? `Signed in as ${machine.info.githubCli.login}`
              : "Not available"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Paired</dt>
          <dd>
            <RelativeTime at={machine.pairedAt} />
          </dd>
        </div>
      </dl>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="space-y-4 px-5 py-4"
      >
        <label className="block text-sm">
          <span className="font-medium">Display name</span>
          <input
            name="name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder={machine.info.prettyName ?? machine.info.hostname}
            autoComplete="off"
            className="mt-1 block min-h-9 w-full max-w-sm rounded-md border border-line bg-canvas px-2.5"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Discovery folders</span>
          <span id={`roots-hint-${machine.id}`} className="block text-ink-muted">
            One per line. The agent looks for repositories up to five folders deep. <code>~</code>{" "}
            means the home folder.
          </span>
          <textarea
            name="roots"
            aria-describedby={`roots-hint-${machine.id}`}
            value={roots}
            onChange={(event) => setRoots(event.currentTarget.value)}
            rows={Math.max(2, machine.discoveryRoots.length + 1)}
            spellCheck={false}
            className="mt-1 block w-full max-w-xl rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-[13px]"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            disabled={!online}
            onClick={() => {
              void requestHub((client) =>
                client.Refresh({ target: { _tag: "Machine", machineId: machine.id } }),
              );
            }}
          >
            Rescan now
          </Button>
          <Button tone="quiet" className="ms-auto text-danger" onClick={() => setRemoving(true)}>
            Remove machine
          </Button>
          <p role="status" className="basis-full text-sm">
            {saveState._tag === "Saved" && <span className="text-clean">Saved.</span>}
            {saveState._tag === "Failed" && (
              <span className="text-danger">{saveState.message}</span>
            )}
          </p>
        </div>
      </form>
      {removing && <RemoveMachineDialog machine={machine} onClose={() => setRemoving(false)} />}
    </article>
  );
}
