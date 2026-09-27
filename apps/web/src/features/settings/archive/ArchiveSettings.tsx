import { useState } from "react";

import { Link } from "@tanstack/react-router";

import { knownFleet, requestHub, useHub } from "@/rpc/hubConnection.ts";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { checkArchiveFolder } from "@fleetfrog/protocol/domain/archiveFolder";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { SettingsRow, SettingsSection } from "../SettingsSection.tsx";
import { SaveStatus, useAutoSave } from "../useAutoSave.tsx";

import type { Fleet } from "@fleetfrog/protocol/domain/fleet";

/** Why the folder can't be the Archive folder on some machine, or null when it works on all. */
function folderProblem(folder: string, fleet: Fleet): string | null {
  for (const machine of fleet.machines) {
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

    if (check._tag === "ContainsProjectFolder") {
      return `It holds ${check.root}, a project folder on ${machineLabel(machine)}. Choose a folder inside it or elsewhere.`;
    }
  }

  return null;
}

/** Where every machine keeps archived checkouts. The field saves when it's left or on Enter. */
export function ArchiveSettings() {
  const fleet = knownFleet(useHub());
  const { state, save } = useAutoSave();
  const [problem, setProblem] = useState<string | null>(null);

  if (fleet === null) {
    return (
      <SidebarPage title="Archive">
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      </SidebarPage>
    );
  }

  const commit = (input: HTMLInputElement) => {
    const folder = input.value.trim();
    const found = folder === "" ? null : folderProblem(folder, fleet);

    setProblem(found);

    if (found === null && folder !== (fleet.archiveFolder ?? "")) {
      void save(() =>
        requestHub((client) => client.SetArchiveFolder({ folder: folder === "" ? null : folder })),
      );
    }
  };

  return (
    <SidebarPage title="Archive">
      <SettingsSection title="Archived checkouts" status={<SaveStatus state={state} />}>
        <SettingsRow
          title="Archive folder"
          description={
            <>
              Archiving moves a checkout here on its machine, keeping its path below its project
              folder, and takes it off the Projects page. Use the same path on every machine, such
              as <span className="font-mono">~/Archive</span> or{" "}
              <span className="font-mono">~/Projects/Archive</span>. Leave it empty to turn
              archiving off.
            </>
          }
          htmlFor="archive-folder"
        >
          <div className="w-full">
            <input
              // Keyed on the saved value, so a change from the hub replaces what is shown.
              key={fleet.archiveFolder ?? ""}
              id="archive-folder"
              type="text"
              spellCheck={false}
              autoComplete="off"
              placeholder="~/Archive"
              aria-describedby={problem === null ? undefined : "archive-folder-error"}
              aria-invalid={problem === null ? undefined : true}
              defaultValue={fleet.archiveFolder ?? ""}
              onBlur={(event) => commit(event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              className="min-h-9 w-full max-w-md rounded-md border border-line bg-canvas px-2.5 font-mono text-sm aria-invalid:border-danger"
            />
            {problem !== null && (
              <p id="archive-folder-error" className="mt-2 text-sm text-danger">
                {problem}
              </p>
            )}
            <p className="mt-2 text-sm text-ink-muted">
              Changing the folder leaves checkouts already archived where they are. A folder inside
              a project folder is skipped when that project folder is searched, so turning archiving
              off shows its checkouts in Projects again. Archived checkouts are listed under{" "}
              <Link
                to="/cleanup/archive"
                className="text-accent-text underline-offset-2 hover:underline"
              >
                Cleanup
              </Link>
              .
            </p>
          </div>
        </SettingsRow>
      </SettingsSection>
    </SidebarPage>
  );
}
