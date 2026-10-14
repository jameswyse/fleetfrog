import { useRef, useState } from "react";

import { XIcon } from "lucide-react";

import { knownFleet, requestHub, useHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";

import { SettingsRow, SettingsSection } from "../SettingsSection.tsx";
import { SaveStatus, useAutoSave } from "../useAutoSave.tsx";

import type { HubResult } from "@/rpc/hubConnection.ts";

const whitespace = /\s/;

function additionProblem(name: string, branches: ReadonlyArray<string>): string | null {
  if (name === "") {
    return "Enter a branch name to add.";
  }

  if (whitespace.test(name)) {
    return "Branch names can't contain spaces.";
  }

  return branches.includes(name) ? `${name} is already in the list.` : null;
}

function IgnoredBranches({
  saved,
  onChange,
}: {
  readonly saved: ReadonlyArray<string>;
  readonly onChange: (branches: ReadonlyArray<string>) => Promise<HubResult<unknown>>;
}) {
  const savedKey = saved.join("\n");
  const [unsaved, setUnsaved] = useState<ReadonlyArray<string> | null>(null);
  const [saving, setSaving] = useState(0);
  const [adoptedKey, setAdoptedKey] = useState(savedKey);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(0);
  const branches = unsaved ?? saved;

  if (adoptedKey !== savedKey) {
    setAdoptedKey(savedKey);

    if (saving === 0) {
      setUnsaved(null);
    }
  }

  if (saving === 0 && unsaved !== null && unsaved.join("\n") === savedKey) {
    setUnsaved(null);
  }

  const update = async (next: ReadonlyArray<string>) => {
    const sequence = ++latest.current;

    setUnsaved(next);
    setSaving((count) => count + 1);

    const result = await onChange(next);

    setSaving((count) => count - 1);

    if (result._tag === "Failure" && sequence === latest.current) {
      setUnsaved(null);
    }
  };

  return (
    <div className="rounded-lg border border-line">
      {branches.length === 0 ? (
        <p className="px-3 py-2.5 text-sm text-ink-muted">
          No ignored branches, so Tidy branches lists every branch.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5 px-3 py-2.5">
          {branches.map((branch) => (
            <li
              key={branch}
              className="inline-flex items-center gap-0.5 rounded-md border border-line bg-canvas ps-2"
            >
              <span className="font-mono text-[13px] break-all">{branch}</span>
              <button
                type="button"
                onClick={() => {
                  void update(branches.filter((other) => other !== branch));
                  document.getElementById("new-ignored-branch")?.focus();
                }}
                aria-label={`Stop ignoring ${branch}`}
                title="Remove"
                className="grid size-7 place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-danger"
              >
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();

          const name = draft.trim();
          const found = additionProblem(name, branches);

          setProblem(found);

          if (found === null) {
            setDraft("");
            void update([...branches, name]);
          } else {
            document.getElementById("new-ignored-branch")?.focus();
          }
        }}
        className="border-t border-line px-3 py-2"
      >
        <div className="flex items-center gap-2">
          <label htmlFor="new-ignored-branch" className="sr-only">
            Branch to ignore
          </label>
          <input
            id="new-ignored-branch"
            value={draft}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setProblem(null);
            }}
            placeholder="Add a branch, such as release"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={problem === null ? undefined : true}
            aria-describedby={problem === null ? undefined : "new-ignored-branch-error"}
            className="min-h-9 min-w-0 flex-1 rounded-md border border-line bg-canvas px-2.5 font-mono text-[13px] aria-invalid:border-danger"
          />
          <Button type="submit">Add</Button>
        </div>
        {problem !== null && (
          <p id="new-ignored-branch-error" className="mt-1.5 text-sm text-danger">
            {problem}
          </p>
        )}
      </form>
    </div>
  );
}

export function CleanupSettings() {
  const hub = useHub();
  const fleet = knownFleet(hub);
  const { state, save } = useAutoSave();

  if (fleet === null) {
    return (
      <SidebarPage title="Cleanup">
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      </SidebarPage>
    );
  }

  return (
    <SidebarPage title="Cleanup">
      <SettingsSection title="Branches on every machine" status={<SaveStatus state={state} />}>
        <SettingsRow
          title="Ignored branches"
          description="Tidy branches never lists these, so they can't be deleted by mistake. Names must match exactly."
        >
          <IgnoredBranches
            saved={fleet.cleanup.ignoredBranches}
            onChange={(ignoredBranches) =>
              save(() =>
                requestHub((client) =>
                  client.UpdateCleanup({ cleanup: { ignoredBranches: [...ignoredBranches] } }),
                ),
              )
            }
          />
        </SettingsRow>
      </SettingsSection>
    </SidebarPage>
  );
}
