import { useState, useTransition } from "react";

import { Link } from "@tanstack/react-router";
import { ArchiveIcon, Trash2Icon } from "lucide-react";

import { requestHub, useRuns } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Menu, MenuItem } from "@/ui/Menu.tsx";

import {
  machineBlocker,
  pullSkipReason,
  stashSkipReason,
} from "../../actions/actionAvailability.ts";
import { activeRunFor, latestRunFor } from "../../actions/runLookup.ts";
import { RunStateText } from "../../actions/RunStateText.tsx";
import { StashDialog } from "../../actions/StashDialog.tsx";
import { useStartBatch } from "../../actions/useStartBatch.ts";
import { planArchive } from "../../archive/archiveAvailability.ts";
import { ArchiveDialog } from "../../archive/ArchiveDialog.tsx";
import { trashBlocker } from "../../cleanup/trashAvailability.ts";
import { TrashCheckoutDialog } from "../../cleanup/TrashCheckoutDialog.tsx";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

/**
 * Fetch, pull and stash for one checkout, with what is running on it now or how its last action
 * ended.
 */
export function CheckoutActions({
  repository,
  machine,
  checkout,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
}) {
  const [dialog, setDialog] = useState<"stash" | "archive" | "trash" | null>(null);
  const runs = useRuns();
  const { start, pending, failure } = useStartBatch();
  const [cancelling, startCancel] = useTransition();
  const active = activeRunFor(runs, { machineId: machine.id, checkout });
  const latest = latestRunFor(runs, { machineId: machine.id, checkout });
  const fetchBlocked = machineBlocker(machine, "Fetch");
  const pullBlocked = pullSkipReason(machine, checkout);
  const git = checkout.status._tag === "Read" ? checkout.status.git : null;
  const hasChanges = git !== null && git.changed.total + git.untracked.total > 0;
  const stashBlocked = stashSkipReason(machine, checkout);
  const archive = planArchive({ repository, machine, checkout });
  const trashBlocked = trashBlocker({ repository, machine, checkout });
  const scope = { _tag: "Checkout", machineId: machine.id, path: checkout.path } as const;
  const shown = active ?? latest;

  return (
    <section aria-labelledby="checkout-actions" className="space-y-2">
      <h3 id="checkout-actions" className="sr-only">
        Actions
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={fetchBlocked !== null || active !== undefined || pending}
          onClick={() => start({ _tag: "Fetch", scope })}
        >
          Fetch
        </Button>
        <Button
          disabled={pullBlocked !== null || active !== undefined || pending}
          onClick={() => start({ _tag: "Pull", scope })}
        >
          Pull
        </Button>
        {hasChanges && (
          <Button
            disabled={stashBlocked !== null || active !== undefined || pending}
            onClick={() => setDialog("stash")}
          >
            Stash changes
          </Button>
        )}
        <Menu
          label="More actions for this checkout"
          trigger={{
            content: "More…",
            className:
              "inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-ink-muted hover:bg-surface-raised hover:text-ink",
          }}
        >
          {(close) => (
            <>
              <MenuItem
                icon={<ArchiveIcon />}
                disabled={archive._tag === "Blocked" || active !== undefined}
                onClick={() => {
                  close();
                  setDialog("archive");
                }}
              >
                Archive…
              </MenuItem>
              {archive._tag === "Blocked" && (
                <p className="px-3 pb-2 text-xs text-ink-muted">{archive.reason}.</p>
              )}
              <MenuItem
                icon={<Trash2Icon />}
                disabled={trashBlocked !== null || active !== undefined}
                onClick={() => {
                  close();
                  setDialog("trash");
                }}
              >
                Move to the trash…
              </MenuItem>
              {trashBlocked !== null && (
                <p className="px-3 pb-2 text-xs text-ink-muted">{trashBlocked}.</p>
              )}
            </>
          )}
        </Menu>
        {active !== undefined && (
          <Button
            tone="quiet"
            disabled={cancelling}
            onClick={() =>
              startCancel(async () => {
                await requestHub((client) =>
                  client.Cancel({ target: { _tag: "Run", runId: active.id } }),
                );
              })
            }
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        )}
      </div>
      {active === undefined && (fetchBlocked ?? pullBlocked) !== null && (
        <p className="text-sm text-ink-muted">
          {fetchBlocked === null
            ? `Pull isn't available: ${pullBlocked}.`
            : `Actions aren't available: ${fetchBlocked}.`}
        </p>
      )}
      {active === undefined && fetchBlocked === null && hasChanges && stashBlocked !== null && (
        <p className="text-sm text-ink-muted">Stashing isn't available: {stashBlocked}.</p>
      )}
      <p role="status" className="text-sm">
        {failure !== null && <span className="text-danger">{failure}</span>}
        {failure === null && shown !== undefined && (
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-ink-muted">{shown.request._tag}:</span>
            <RunStateText run={shown} />
            <Link
              to="/activity"
              search={{ batch: shown.batchId }}
              className="text-accent-text underline-offset-2 hover:underline"
            >
              View in Activity
            </Link>
          </span>
        )}
      </p>
      {dialog === "stash" && git !== null && (
        <StashDialog
          repository={repository}
          machine={machine}
          checkout={checkout}
          git={git}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "trash" && (
        <TrashCheckoutDialog
          label={repository.label}
          machine={machine}
          checkout={checkout}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "archive" && archive._tag === "Ready" && (
        <ArchiveDialog
          repository={repository}
          machine={machine}
          checkout={checkout}
          destination={archive.destination}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
