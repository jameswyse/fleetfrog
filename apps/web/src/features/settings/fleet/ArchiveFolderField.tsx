import { useState } from "react";

import { checkArchiveFolder } from "@fleetfrog/protocol/domain/archiveFolder";

import type { Machine } from "@fleetfrog/protocol/domain/fleet";

/** Why the folder can't be this machine's Archive folder, or null when it can. */
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

/**
 * The machine's Archive folder, saved when the field is left or on Enter. An empty field turns
 * archiving off.
 */
export function ArchiveFolderField({
  id,
  machine,
  onChange,
}: {
  readonly id: string;
  readonly machine: Machine;
  readonly onChange: (folder: string | null) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);

  const commit = (input: HTMLInputElement) => {
    const folder = input.value.trim();
    const found = folder === "" ? null : folderProblem(folder, machine);

    setProblem(found);

    if (found === null && folder !== (machine.archiveFolder ?? "")) {
      onChange(folder === "" ? null : folder);
    }
  };

  return (
    <div className="w-full">
      <input
        // Keyed on the saved value, so a change from the hub replaces what is shown.
        key={machine.archiveFolder ?? ""}
        id={id}
        type="text"
        spellCheck={false}
        autoComplete="off"
        placeholder="Archiving is off"
        aria-describedby={problem === null ? `${id}-description` : `${id}-description ${id}-error`}
        aria-invalid={problem === null ? undefined : true}
        defaultValue={machine.archiveFolder ?? ""}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        className="min-h-9 w-full max-w-md rounded-md border border-line bg-canvas px-2.5 font-mono text-sm aria-invalid:border-danger"
      />
      {problem !== null && (
        <p id={`${id}-error`} className="mt-2 text-sm text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
