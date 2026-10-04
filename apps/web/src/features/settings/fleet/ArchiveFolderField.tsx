import { useState } from "react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { checkArchiveFolder } from "@fleetfrog/protocol/domain/archiveFolder";

import type { HubResult } from "@/rpc/hubConnection.ts";
import type { FolderOutcome, Machine } from "@fleetfrog/protocol/domain/fleet";

type Creation =
  | { readonly _tag: "Creating" }
  | { readonly _tag: "Created" }
  | { readonly _tag: "Failed"; readonly message: string };

function folderProblem(folder: string, machine: Machine): string | null {
  const check = checkArchiveFolder({
    folder,
    home: machine.info.homeDirectory,
    roots: machine.discoveryRoots.map(({ path }) => path),
  });

  if (check._tag === "NotAbsolute") {
    return "Enter a full path, or one starting with ~.";
  }

  if (check._tag === "Hidden") {
    return "Choose a folder that isn't hidden, so it stays easy to find.";
  }

  return check._tag === "ContainsProjectFolder"
    ? `It holds ${check.root}, one of this machine's project folders. Choose a folder inside it or elsewhere.`
    : null;
}

export function archiveFolderCreator(
  machine: Machine,
): ((path: string) => Promise<HubResult<FolderOutcome>>) | null {
  return machine.connection._tag === "Online" &&
    machine.connection.capabilities.createsFolders &&
    machine.connection.capabilities.allowedTiers.includes("cleanup")
    ? (path) => requestHub((client) => client.CreateProjectFolder({ machineId: machine.id, path }))
    : null;
}

export function saveArchiveFolder(machine: Machine, folder: string | null) {
  return requestHub((client) => client.SetArchiveFolder({ machineId: machine.id, folder }));
}

export function ArchiveFolderField({
  id,
  machine,
  onChange,
  createFolder,
}: {
  readonly id: string;
  readonly machine: Machine;
  readonly onChange: (folder: string | null) => Promise<HubResult<unknown>>;
  readonly createFolder: ((path: string) => Promise<HubResult<FolderOutcome>>) | null;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [creation, setCreation] = useState<Creation | null>(null);
  const folder = machine.archiveFolder;
  const status = machine.archiveFolderStatus;
  const savedProblem = folder === null ? null : folderProblem(folder, machine);

  const create = async (path: string) => {
    if (createFolder === null) {
      return;
    }

    setCreation({ _tag: "Creating" });

    const result = await createFolder(path);

    if (result._tag === "Failure") {
      setCreation({ _tag: "Failed", message: result.message });
    } else if (result.value._tag === "Failed") {
      setCreation({ _tag: "Failed", message: result.value.message });
    } else {
      setCreation({ _tag: "Created" });
    }
  };

  const commit = async (input: HTMLInputElement) => {
    const typed = input.value.trim();
    const found = typed === "" ? null : folderProblem(typed, machine);

    setProblem(found);

    if (found !== null || typed === (folder ?? "")) {
      return;
    }

    setCreation(null);

    const saved = await onChange(typed === "" ? null : typed);

    if (saved._tag === "Success" && typed !== "") {
      await create(typed);
    }
  };

  const pending = status !== "Folder" && creation !== null && creation._tag !== "Failed";
  const missing = folder !== null && status === "Missing" && !pending;

  return (
    <div className="w-full">
      <input
        key={folder ?? ""}
        id={id}
        type="text"
        spellCheck={false}
        autoComplete="off"
        placeholder="Archiving is off"
        aria-describedby={`${id}-description ${id}-status`}
        aria-invalid={problem === null ? undefined : true}
        defaultValue={folder ?? ""}
        onBlur={(event) => void commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        className="min-h-9 w-full max-w-md rounded-md border border-line bg-canvas px-2.5 font-mono text-sm aria-invalid:border-danger"
      />
      <div id={`${id}-status`} role="status" className="mt-2 text-sm empty:hidden">
        {problem !== null && <p className="text-danger">{problem}</p>}
        {problem === null && savedProblem !== null && (
          <p className="text-changes">
            {savedProblem} Until then the agent ignores it, and archived checkouts inside it show up
            as projects again.
          </p>
        )}
        {problem === null && creation?._tag === "Failed" && (
          <p className="text-danger">Couldn't create it. {creation.message}</p>
        )}
        {problem === null && pending && (
          <p className="text-ink-muted">
            {creation._tag === "Creating" ? "Creating the folder…" : "Created"}
          </p>
        )}
        {problem === null && missing && (
          <p className="flex flex-wrap items-center gap-x-2 text-changes">
            It doesn't exist on this machine yet.
            {createFolder !== null && (
              <button
                type="button"
                onClick={() => void create(folder)}
                className="rounded-md px-2 py-1 text-xs text-accent-text hover:bg-surface-raised"
              >
                Create it
              </button>
            )}
          </p>
        )}
        {problem === null && folder !== null && status === "NotFolder" && (
          <p className="text-changes">Something other than a folder is at this path.</p>
        )}
      </div>
    </div>
  );
}
