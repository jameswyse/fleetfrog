import { useState, useTransition } from "react";

import { knownFleet, requestHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";

import { canPull, machineBlocker } from "../actions/actionAvailability.ts";
import { PullDialog } from "../actions/PullDialog.tsx";
import { useStartBatch } from "../actions/useStartBatch.ts";

import type { HubState } from "@/rpc/hubConnection.ts";

/** What every machine can do at once: fetch, pull after confirming, and rescan. */
export function FleetActions({ hub }: { readonly hub: HubState }) {
  const fetchAll = useStartBatch();
  const [pulling, setPulling] = useState(false);
  const [rescanFailure, setRescanFailure] = useState<string | null>(null);
  const [rescanning, startRescan] = useTransition();
  const fleet = knownFleet(hub);
  const live = hub._tag === "Live";

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
      <p role="status" className="text-sm text-danger">
        {fetchAll.failure !== null && `Fetch failed. ${fetchAll.failure} `}
        {rescanFailure}
      </p>
      <div className="flex gap-2">
        <Button
          tone="primary"
          disabled={
            !live ||
            fetchAll.pending ||
            !fleet?.machines.some((machine) => machineBlocker(machine, "Fetch") === null)
          }
          onClick={() => fetchAll.start({ _tag: "Fetch", scope: { _tag: "All" } })}
        >
          {fetchAll.pending ? "Starting fetch…" : "Fetch all"}
        </Button>
        <Button
          tone="primary"
          disabled={!live || fleet === null || !canPull(fleet, { _tag: "All" })}
          onClick={() => setPulling(true)}
        >
          Pull all
        </Button>
        <Button
          tone="primary"
          disabled={!live || rescanning}
          onClick={() =>
            startRescan(async () => {
              const result = await requestHub((client) =>
                client.Refresh({ target: { _tag: "All" } }),
              );

              setRescanFailure(
                result._tag === "Failure" ? `Rescan failed. ${result.message}` : null,
              );
            })
          }
        >
          {rescanning ? "Requesting rescan…" : "Rescan all"}
        </Button>
      </div>
      {pulling && fleet !== null && (
        <PullDialog fleet={fleet} scope={{ _tag: "All" }} onClose={() => setPulling(false)} />
      )}
    </div>
  );
}
