import { useActionState, useState, useTransition } from "react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import type { HubResult } from "@/rpc/hubConnection.ts";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";

/** The last save or rescan, reported in the card's status line. Its wording carries the outcome. */
type Notice =
  | { readonly _tag: "None" }
  | { readonly _tag: "Succeeded"; readonly message: string }
  | { readonly _tag: "Failed"; readonly message: string };

type Update = { readonly part: string; readonly result: HubResult<void> };

function parseRoots(text: string): ReadonlyArray<string> {
  return text
    .split("\n")
    .map((root) => root.trim())
    .filter((root) => root !== "");
}

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

/** Keeps its own draft so the box grows with the list. Remount it to discard the draft. */
function RootsField({
  id,
  hintId,
  roots,
}: {
  readonly id: string;
  readonly hintId: string;
  readonly roots: ReadonlyArray<string>;
}) {
  const [draft, setDraft] = useState(roots.join("\n"));

  return (
    <textarea
      id={id}
      name="roots"
      aria-describedby={hintId}
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      rows={Math.max(2, draft.split("\n").length + 1)}
      spellCheck={false}
      className="mt-1 block w-full max-w-xl rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-[13px]"
    />
  );
}

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
  const [notice, setNotice] = useState<Notice>({ _tag: "None" });
  const [saving, startSaving] = useTransition();
  const [rescanning, startRescan] = useTransition();
  const rootsId = `roots-${machine.id}`;
  const hintId = `roots-hint-${machine.id}`;

  const save = (form: FormData) =>
    startSaving(async () => {
      const typedName = formText(form, "name").trim();
      const customName = typedName === "" ? null : typedName;
      const roots = parseRoots(formText(form, "roots"));
      const updates: Array<Update> = [];

      if (customName !== machine.customName) {
        updates.push({
          part: "display name",
          result: await requestHub((client) =>
            client.RenameMachine({ machineId: machine.id, customName }),
          ),
        });
      }

      if (!sameRoots(roots, machine.discoveryRoots)) {
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
          save(new FormData(event.currentTarget));
        }}
        className="space-y-4 px-5 py-4"
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
        <div className="text-sm">
          <label htmlFor={rootsId} className="font-medium">
            Discovery folders
          </label>
          <p id={hintId} className="text-ink-muted">
            One per line. The agent looks for repositories up to five folders deep. <code>~</code>{" "}
            means the home folder.
          </p>
          <RootsField
            key={machine.discoveryRoots.join("\n")}
            id={rootsId}
            hintId={hintId}
            roots={machine.discoveryRoots}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button disabled={!online || rescanning} onClick={rescan}>
            {rescanning ? "Requesting rescan…" : "Rescan now"}
          </Button>
          <Button tone="quiet" className="ms-auto text-danger" onClick={() => setRemoving(true)}>
            Remove machine
          </Button>
          <p role="status" className="basis-full text-sm">
            {notice._tag === "Succeeded" && <span className="text-clean">{notice.message}</span>}
            {notice._tag === "Failed" && <span className="text-danger">{notice.message}</span>}
          </p>
        </div>
      </form>
      {removing && <RemoveMachineDialog machine={machine} onClose={() => setRemoving(false)} />}
    </article>
  );
}
