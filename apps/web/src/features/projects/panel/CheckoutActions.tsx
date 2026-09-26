import { useTransition } from "react";

import { Link } from "@tanstack/react-router";

import { requestHub, useRuns } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";

import { machineBlocker, pullSkipReason } from "../../actions/actionAvailability.ts";
import { activeRunFor, latestRunFor } from "../../actions/runLookup.ts";
import { RunStateText } from "../../actions/RunStateText.tsx";
import { useStartBatch } from "../../actions/useStartBatch.ts";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";

/** Fetch and pull for one checkout, with what is running on it now or how its last action ended. */
export function CheckoutActions({
  machine,
  checkout,
}: {
  readonly machine: Machine;
  readonly checkout: Checkout;
}) {
  const runs = useRuns();
  const { start, pending, failure } = useStartBatch();
  const [cancelling, startCancel] = useTransition();
  const active = activeRunFor(runs, { machineId: machine.id, checkout });
  const latest = latestRunFor(runs, { machineId: machine.id, checkout });
  const fetchBlocked = machineBlocker(machine, "Fetch");
  const pullBlocked = pullSkipReason(machine, checkout);
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
    </section>
  );
}
