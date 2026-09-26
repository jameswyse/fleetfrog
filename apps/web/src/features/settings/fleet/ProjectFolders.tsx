import { useState } from "react";

import { Button } from "@/ui/Button.tsx";
import { Chip } from "@/ui/Chip.tsx";
import { CloseIcon, FolderIcon } from "@/ui/icons.tsx";
import { expandHome, isWithin } from "@fleetfrog/protocol/domain/cloneDestination";

import type { DiscoveryRoot, FolderStatus } from "@fleetfrog/protocol/domain/fleet";

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
      repositories === 0
        ? "No repositories"
        : `${repositories} ${repositories === 1 ? "repository" : "repositories"}`;

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
 * A machine's project folders as a compact list, each with how many repositories it holds. The first is the default for clones, so making
 * another the default moves it to the top. Every change is handed to `onChange` straight away and
 * shown at once; the saved list replaces it when the hub reports it.
 */
export function ProjectFolders({
  machineId,
  homeDirectory,
  repositoryPaths,
  roots,
  onChange,
}: {
  readonly machineId: string;
  readonly homeDirectory: string;
  /**
   * The checkout folders of each repository on the machine, so several clones of one repository
   * count once.
   */
  readonly repositoryPaths: ReadonlyArray<ReadonlyArray<string>>;
  readonly roots: ReadonlyArray<DiscoveryRoot>;
  readonly onChange: (paths: ReadonlyArray<string>) => void;
}) {
  const savedPaths = roots.map(({ path }) => path);
  const savedKey = savedPaths.join("\n");
  const [paths, setPaths] = useState(savedPaths);
  const [adoptedKey, setAdoptedKey] = useState(savedKey);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const statuses = new Map(roots.map(({ path, status }) => [path, status]));
  const inputId = `new-folder-${machineId}`;

  // The hub reported a different saved list, so show it in place of the local copy.
  if (adoptedKey !== savedKey) {
    setAdoptedKey(savedKey);
    setPaths(savedPaths);
  }

  const update = (next: ReadonlyArray<string>) => {
    setPaths([...next]);
    onChange(next);
  };

  /** Removing or reordering takes away the button that had focus, so focus goes to the add field. */
  const updateFromRow = (next: ReadonlyArray<string>) => {
    update(next);
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
          const note = folderNote(
            status,
            repositoryPaths.filter((checkouts) =>
              checkouts.some((checkout) => isWithin(checkout, folder)),
            ).length,
          );

          return (
            <li key={path} className="flex min-h-11 items-center gap-3 px-3 py-1.5 text-sm">
              <FolderIcon className="size-4 text-ink-muted" />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={path}>
                {path}
              </span>
              <span
                className={`whitespace-nowrap ${note.problem ? "text-changes" : "text-ink-muted"}`}
              >
                {note.text}
              </span>
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
                <CloseIcon />
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
            update([...paths, path]);
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
