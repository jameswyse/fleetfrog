import { useRef, useState } from "react";

import { Button } from "@/ui/Button.tsx";
import { Chip } from "@/ui/Chip.tsx";

import type { DiscoveryRoot, FolderStatus } from "@fleetfrog/protocol/domain/fleet";

const statusText = {
  Folder: null,
  Missing: "Not found on this machine",
  NotFolder: "Not a folder",
} satisfies Record<FolderStatus, string | null>;

/**
 * Edits a machine's discovery folders as a list. The first folder is the default for clones, so
 * making another the default moves it to the top. Submitted with the surrounding form as `root`
 * fields. Remount it to discard the draft.
 */
export function DiscoveryFolders({
  machineId,
  roots,
}: {
  readonly machineId: string;
  readonly roots: ReadonlyArray<DiscoveryRoot>;
}) {
  const [draft, setDraft] = useState<ReadonlyArray<{ readonly id: number; readonly path: string }>>(
    () => roots.map(({ path }, id) => ({ id, path })),
  );
  const nextId = useRef(roots.length);
  const list = useRef<HTMLOListElement>(null);
  const saved = new Map(roots.map(({ path, status }) => [path, status]));
  const hintId = `roots-hint-${machineId}`;

  const add = () => {
    const id = nextId.current;

    nextId.current += 1;
    setDraft([...draft, { id, path: "" }]);
    // Focus the new field once it has rendered.
    requestAnimationFrame(() => {
      list.current?.querySelector<HTMLInputElement>(`[data-root="${id}"]`)?.focus();
    });
  };

  return (
    <fieldset className="text-sm">
      <legend className="font-medium">Discovery folders</legend>
      <p id={hintId} className="text-ink-muted">
        The agent looks for repositories up to five folders deep. <code>~</code> means the home
        folder. Clones go into the default folder unless another machine keeps the repository
        somewhere these folders cover.
      </p>
      <ol ref={list} className="mt-2 max-w-xl space-y-2">
        {draft.map(({ id, path }, index) => {
          const status = saved.has(path) ? saved.get(path) : undefined;
          const problem = status === undefined || status === null ? null : statusText[status];
          const label = `Discovery folder ${index + 1}${index === 0 ? ", default" : ""}`;

          return (
            <li key={id} className="flex flex-wrap items-center gap-2">
              <input
                name="root"
                data-root={id}
                value={path}
                onChange={(event) => {
                  const value = event.currentTarget.value;

                  setDraft(draft.map((item) => (item.id === id ? { id, path: value } : item)));
                }}
                aria-label={label}
                aria-describedby={hintId}
                placeholder="~/Projects"
                autoComplete="off"
                spellCheck={false}
                className="min-h-9 min-w-0 flex-1 basis-56 rounded-md border border-line bg-canvas px-2.5 font-mono text-[13px]"
              />
              {index === 0 ? (
                <Chip tone="neutral">Default</Chip>
              ) : (
                <Button
                  tone="quiet"
                  aria-label={`Make ${path || "this folder"} the default`}
                  onClick={() =>
                    setDraft([
                      draft[index] ?? { id, path },
                      ...draft.filter((item) => item.id !== id),
                    ])
                  }
                >
                  Make default
                </Button>
              )}
              <Button
                tone="quiet"
                aria-label={`Remove ${path || "this folder"}`}
                onClick={() => setDraft(draft.filter((item) => item.id !== id))}
              >
                Remove
              </Button>
              {problem !== null && <span className="basis-full text-changes">{problem}</span>}
              {status === null && path !== "" && (
                <span className="basis-full text-ink-muted">Not checked yet</span>
              )}
            </li>
          );
        })}
      </ol>
      <Button className="mt-2" onClick={add}>
        Add folder
      </Button>
    </fieldset>
  );
}
