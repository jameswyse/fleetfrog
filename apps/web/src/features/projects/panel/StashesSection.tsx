import { useState } from "react";

import { ArchiveIcon } from "lucide-react";

import { useRuns } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { plural } from "@/ui/plural.ts";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { machineBlocker } from "../../actions/actionAvailability.ts";
import { activeRunFor } from "../../actions/runLookup.ts";
import { useStartBatch } from "../../actions/useStartBatch.ts";
import { PanelSection, ShortList } from "./PanelSection.tsx";

import type { Checkout, GitStatus, Stash } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";

/** A stash the dashboard can name exactly, by its commit. */
type KnownStash = Stash & { readonly sha: string };

function isKnown(stash: Stash): stash is KnownStash {
  return stash.sha !== null;
}

/** Confirms dropping stashes, which go to the trash. */
function DropStashesDialog({
  machine,
  checkout,
  stashes,
  onClose,
}: {
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly stashes: readonly [KnownStash, ...Array<KnownStash>];
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const [only] = stashes;
  const title =
    stashes.length === 1
      ? `Drop “${only.message}”?`
      : `Drop ${plural(stashes.length, "stash", "stashes")}?`;

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="space-y-4 text-sm">
        {stashes.length === 1 && <p className="break-words text-ink-muted">{only.message}</p>}
        <p>
          {stashes.length === 1 ? "It leaves" : "They leave"} the stash list on{" "}
          {machineLabel(machine)} and go to the Trash, where you can restore them until you empty
          it. If the stashes change before this runs, none are dropped.
        </p>
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="danger"
            disabled={pending}
            onClick={() =>
              start(
                {
                  _tag: "Targeted",
                  runs: [
                    {
                      machineId: machine.id,
                      request: {
                        _tag: "DropStashes",
                        path: checkout.path,
                        stashes: [
                          { index: only.index, sha: only.sha },
                          ...stashes.slice(1).map(({ index, sha }) => ({ index, sha })),
                        ],
                      },
                    },
                  ],
                },
                onClose,
              )
            }
          >
            {pending ? "Starting…" : `Drop ${plural(stashes.length, "stash", "stashes")}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** The checkout's stashes, each of which can be dropped into the trash, or all at once. */
export function StashesSection({
  machine,
  checkout,
  git,
}: {
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly git: GitStatus;
}) {
  const runs = useRuns();
  const [dropping, setDropping] = useState<readonly [KnownStash, ...Array<KnownStash>] | null>(
    null,
  );
  const blocked = machineBlocker(machine, "DropStashes");
  const busy = activeRunFor(runs, { machineId: machine.id, checkout }) !== undefined;
  const known = git.stashes.items.filter(isKnown);
  // Every stash has to be listed to drop them all, or one past the list would stay.
  const [first, ...rest] = known.length === git.stashes.total ? known : [];

  return (
    <PanelSection title="Stashes" icon={ArchiveIcon} tone="neutral" count={git.stashes.total}>
      <ShortList
        items={git.stashes.items}
        total={git.stashes.total}
        noun="stashes"
        render={(stash) => (
          <li key={stash.index} className="flex min-h-7 items-start gap-2 text-sm">
            <span className="mt-0.5 shrink-0 rounded bg-canvas px-1.5 font-mono text-xs text-ink-muted">
              {stash.index}
            </span>
            <span className="min-w-0 flex-1 break-words">{stash.message}</span>
            {isKnown(stash) && blocked === null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setDropping([stash])}
                aria-label={`Drop stash ${stash.index}, ${stash.message}`}
                className="shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-canvas hover:text-danger disabled:cursor-not-allowed disabled:opacity-60"
              >
                Drop
              </button>
            )}
          </li>
        )}
      />
      {first !== undefined && git.stashes.total > 1 && blocked === null && (
        <div className="mt-3 border-t border-line pt-3">
          <Button disabled={busy} onClick={() => setDropping([first, ...rest])}>
            Drop all stashes…
          </Button>
        </div>
      )}
      {blocked !== null && <p className="mt-2 text-xs text-ink-muted">{blocked}.</p>}
      {dropping !== null && (
        <DropStashesDialog
          machine={machine}
          checkout={checkout}
          stashes={dropping}
          onClose={() => setDropping(null)}
        />
      )}
    </PanelSection>
  );
}
