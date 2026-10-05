import { useState, useTransition } from "react";

import { Link } from "@tanstack/react-router";
import { ArchiveIcon, Trash2Icon, Undo2Icon } from "lucide-react";

import { requestHub, useRuns } from "@/rpc/hubConnection.ts";
import { useMayRun } from "@/rpc/session.ts";
import { Button } from "@/ui/Button.tsx";
import { Menu, MenuItem } from "@/ui/Menu.tsx";

import {
  discardSkipReason,
  hiddenTrashReason,
  machineBlocker,
  pullSkipReason,
  stashSkipReason,
} from "../../actions/actionAvailability.ts";
import { DiscardDialog } from "../../actions/DiscardDialog.tsx";
import { activeRunFor, latestRunFor } from "../../actions/runLookup.ts";
import { RunStateText } from "../../actions/RunStateText.tsx";
import { StashDialog } from "../../actions/StashDialog.tsx";
import { useStartBatch } from "../../actions/useStartBatch.ts";
import { planArchive } from "../../archive/archiveAvailability.ts";
import { ArchiveDialog } from "../../archive/ArchiveDialog.tsx";
import { RemoveWorktreeDialog } from "../../cleanup/RemoveWorktreeDialog.tsx";
import { TrashCheckoutDialog } from "../../cleanup/TrashCheckoutDialog.tsx";
import { BusyCheckoutDialog } from "../../t3Code/BusyCheckoutDialog.tsx";
import { busyThreads } from "../../t3Code/t3CodeLookup.ts";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

import type { ArchivePlan } from "../../archive/archiveAvailability.ts";

export function CheckoutActions({
  repository,
  machine,
  checkout,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
}) {
  const [dialog, setDialog] = useState<"pull" | "stash" | "discard" | "archive" | "trash" | null>(
    null,
  );

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
  const hiddenTrash = hiddenTrashReason(repository, machine, checkout);
  const discardBlocked = discardSkipReason(machine, checkout) ?? hiddenTrash;
  const linked = checkout.worktree._tag === "Linked" ? checkout.worktree.mainPath : null;

  const archiveTarget =
    linked === null
      ? checkout
      : (repository.checkouts.find(
          (entry) => entry.machineId === machine.id && entry.checkout.path === linked,
        )?.checkout ?? null);

  const archive: ArchivePlan =
    archiveTarget === null
      ? {
          _tag: "Blocked",
          reason: `It's a linked worktree of ${linked}, which FleetFrog doesn't list, so it can't be archived from here`,
        }
      : planArchive({ machine, checkout: archiveTarget });

  const mayClean = useMayRun("Trash");
  const trashBlocked = machineBlocker(machine, linked === null ? "Trash" : "RemoveWorktree");
  const scope = { _tag: "Checkout", machineId: machine.id, path: checkout.path } as const;
  const agents = busyThreads(machine, [checkout.path]);
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
          onClick={() => (agents.length > 0 ? setDialog("pull") : start({ _tag: "Pull", scope }))}
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
        {mayClean && (
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
                {hasChanges && (
                  <>
                    <MenuItem
                      icon={<Undo2Icon />}
                      disabled={discardBlocked !== null || active !== undefined}
                      onClick={() => {
                        close();
                        setDialog("discard");
                      }}
                    >
                      Discard changes…
                    </MenuItem>
                    {discardBlocked !== null && (
                      <p className="px-3 pb-2 text-xs text-ink-muted">{discardBlocked}.</p>
                    )}
                  </>
                )}
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
                  {linked === null ? "Move to the trash…" : "Remove worktree…"}
                </MenuItem>
                {trashBlocked !== null && (
                  <p className="px-3 pb-2 text-xs text-ink-muted">{trashBlocked}.</p>
                )}
              </>
            )}
          </Menu>
        )}
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
      {dialog === "pull" && (
        <BusyCheckoutDialog
          title={`Pull ${repository.label} while T3 Code is working?`}
          threads={agents}
          consequence="Pulling changes files under it, and its agent may not notice before it carries on."
          confirmLabel="Pull anyway"
          pending={pending}
          failure={failure}
          onConfirm={() => start({ _tag: "Pull", scope }, () => setDialog(null))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "stash" && git !== null && (
        <StashDialog
          repository={repository}
          machine={machine}
          checkout={checkout}
          git={git}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "discard" && git !== null && (
        <DiscardDialog
          repository={repository}
          machine={machine}
          checkout={checkout}
          git={git}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "trash" && linked === null && (
        <TrashCheckoutDialog
          label={repository.label}
          machine={machine}
          checkout={checkout}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "trash" && linked !== null && (
        <RemoveWorktreeDialog
          machine={machine}
          mainPath={linked}
          worktree={checkout.path}
          discardUnavailable={hiddenTrash}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "archive" && archiveTarget !== null && (
        <ArchiveDialog
          repository={repository}
          machine={machine}
          checkout={archiveTarget}
          fromWorktree={linked === null ? null : checkout.path}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
