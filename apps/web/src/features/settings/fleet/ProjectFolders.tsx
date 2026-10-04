import { useState } from "react";

import { FolderIcon, XIcon } from "lucide-react";

import { Button } from "@/ui/Button.tsx";
import { Chip } from "@/ui/Chip.tsx";
import { plural } from "@/ui/plural.ts";
import { expandHome, isWithin } from "@fleetfrog/protocol/domain/cloneDestination";

import type { HubResult } from "@/rpc/hubConnection.ts";
import type { DiscoveryRoot, FolderOutcome, FolderStatus } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

/** A folder this list asked the machine to create. */
type Creation =
  | { readonly _tag: "Creating" }
  | { readonly _tag: "Created" }
  | { readonly _tag: "Failed"; readonly message: string };

/** What the agent found at a folder on its last search, and whether that is a problem. */
interface FolderNote {
  readonly text: string;
  readonly problem: boolean;
}

function folderNote(status: FolderStatus | null | undefined, repositories: number): FolderNote {
  if (status === undefined || status === null) {
    return { text: "Not checked yet", problem: false };
  }

  if (status === "Folder") {
    const text =
      repositories === 0 ? "No repositories" : plural(repositories, "repository", "repositories");

    return { text, problem: false };
  }

  return { text: status === "Missing" ? "Not found" : "Not a folder", problem: true };
}

/** Why a folder can't be added, or null when it can. */
function additionProblem(path: string, paths: ReadonlyArray<string>): string | null {
  if (!path.startsWith("/") && !path.startsWith("~")) {
    return "Enter a full path, or one starting with ~.";
  }

  return paths.includes(path) ? `${path} is already in the list.` : null;
}

/**
 * A machine's project folders as a compact list, each with how many repositories it holds. The
 * first is the default for clones, so making another the default moves it to the top. Every change
 * is handed to `onChange` straight away and shown at once; the saved list replaces it when the hub
 * reports it. A folder the machine lacks can be created, and one added here is, once it's saved.
 */
export function ProjectFolders({
  machineId,
  homeDirectory,
  repositoryPaths,
  roots,
  onChange,
  createFolder,
}: {
  readonly machineId: MachineId;
  readonly homeDirectory: string;
  /**
   * The checkout folders of each repository on the machine, so several clones of one repository
   * count once.
   */
  readonly repositoryPaths: ReadonlyArray<ReadonlyArray<string>>;
  readonly roots: ReadonlyArray<DiscoveryRoot>;
  readonly onChange: (paths: ReadonlyArray<string>) => Promise<HubResult<unknown>>;
  /** Asks the machine to create a folder, or null when it can't now. */
  readonly createFolder: ((path: string) => Promise<HubResult<FolderOutcome>>) | null;
}) {
  const savedPaths = roots.map(({ path }) => path);
  const savedKey = savedPaths.join("\n");
  const [paths, setPaths] = useState(savedPaths);
  const [adoptedKey, setAdoptedKey] = useState(savedKey);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [creations, setCreations] = useState<ReadonlyMap<string, Creation>>(() => new Map());
  const statuses = new Map(roots.map(({ path, status }) => [path, status]));
  const inputId = `new-folder-${machineId}`;

  // The hub reported a different saved list, so show it in place of the local copy.
  if (adoptedKey !== savedKey) {
    setAdoptedKey(savedKey);
    setPaths(savedPaths);
  }

  const update = (next: ReadonlyArray<string>) => {
    setPaths([...next]);

    return onChange(next);
  };

  const setCreation = (path: string, creation: Creation) =>
    setCreations((current) => new Map(current).set(path, creation));

  const create = async (path: string) => {
    if (createFolder === null) {
      return;
    }

    setCreation(path, { _tag: "Creating" });

    const result = await createFolder(path);

    if (result._tag === "Failure") {
      setCreation(path, { _tag: "Failed", message: result.message });

      return;
    }

    setCreation(
      path,
      result.value._tag === "Failed"
        ? { _tag: "Failed", message: result.value.message }
        : { _tag: "Created" },
    );
  };

  /** Once saved, the machine creates the folder if it lacks it, and leaves it alone otherwise. */
  const add = async (path: string) => {
    const saved = await update([...paths, path]);

    if (saved._tag === "Success") {
      await create(path);
    }
  };

  /** Removing or reordering takes away the button that had focus, so focus goes to the add field. */
  const updateFromRow = (next: ReadonlyArray<string>) => {
    void update(next);
    document.getElementById(inputId)?.focus();
  };

  return (
    <div className="rounded-lg border border-line">
      <ul className="divide-y divide-line">
        {paths.length === 0 && (
          <li className="px-3 py-2.5 text-sm text-ink-muted">
            No folders yet, so the agent finds no repositories.
          </li>
        )}
        {paths.map((path, index) => {
          const status = statuses.get(path);
          const folder = expandHome(path, homeDirectory);
          const creation = creations.get(path);

          let note = folderNote(
            status,
            repositoryPaths.filter((checkouts) =>
              checkouts.some((checkout) => isWithin(checkout, folder)),
            ).length,
          );

          // Until the agent looks again, say what the request did rather than what it last saw.
          if (status !== "Folder" && creation?._tag === "Creating") {
            note = { text: "Creating…", problem: false };
          } else if (status !== "Folder" && creation?._tag === "Created") {
            note = { text: "Created", problem: false };
          }

          return (
            <li key={path} className="flex min-h-11 items-center gap-3 px-3 py-1.5 text-sm">
              <FolderIcon className="size-4 text-ink-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px]" title={path}>
                  {path}
                </span>
                {creation?._tag === "Failed" && (
                  <span className="block text-xs text-danger">
                    Couldn't create it. {creation.message}
                  </span>
                )}
              </span>
              <span
                className={`whitespace-nowrap ${note.problem ? "text-changes" : "text-ink-muted"}`}
              >
                {note.text}
              </span>
              {status === "Missing" &&
                createFolder !== null &&
                creation?._tag !== "Creating" &&
                creation?._tag !== "Created" && (
                  <button
                    type="button"
                    onClick={() => void create(path)}
                    aria-label={`Create ${path}`}
                    className="rounded-md px-2 py-1 text-xs text-accent-text hover:bg-surface-raised"
                  >
                    Create
                  </button>
                )}
              {index === 0 ? (
                <Chip tone="neutral">Default</Chip>
              ) : (
                <button
                  type="button"
                  onClick={() => updateFromRow([path, ...paths.filter((other) => other !== path)])}
                  aria-label={`Make ${path} the default`}
                  className="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink"
                >
                  Make default
                </button>
              )}
              <button
                type="button"
                onClick={() => updateFromRow(paths.filter((other) => other !== path))}
                aria-label={`Remove ${path}`}
                title="Remove"
                className="grid size-8 place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-danger"
              >
                <XIcon />
              </button>
            </li>
          );
        })}
      </ul>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();

          const path = draft.trim();
          const found = path === "" ? "Enter a folder to add." : additionProblem(path, paths);

          setProblem(found);

          if (found === null) {
            setDraft("");
            void add(path);
          }
        }}
        className="border-t border-line px-3 py-2"
      >
        <div className="flex items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            New project folder
          </label>
          <input
            id={inputId}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder="Add a folder, such as ~/Code"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={problem === null ? undefined : true}
            aria-describedby={problem === null ? undefined : `${inputId}-error`}
            className="min-h-9 min-w-0 flex-1 rounded-md border border-line bg-canvas px-2.5 font-mono text-[13px] aria-invalid:border-danger"
          />
          <Button type="submit">Add</Button>
        </div>
        {problem !== null && (
          <p id={`${inputId}-error`} className="mt-1.5 text-sm text-danger">
            {problem}
          </p>
        )}
      </form>
    </div>
  );
}
