import { useState, useTransition } from "react";

import { knownFleet, requestHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";

import { canPull, machineBlocker } from "../actions/actionAvailability.ts";
import { PullDialog } from "../actions/PullDialog.tsx";
import { useStartBatch } from "../actions/useStartBatch.ts";

import type { HubState } from "@/rpc/hubConnection.ts";

/** Fetches every repository, or asks before pulling every checkout. */
function FetchAndPull({ hub }: { readonly hub: HubState }) {
  const { start, pending, failure } = useStartBatch();
  const [pulling, setPulling] = useState(false);
  const fleet = knownFleet(hub);
  const live = hub._tag === "Live";

  return (
    <>
      <p role="status" className="text-sm text-danger">
        {failure === null ? null : `Fetch failed. ${failure}`}
      </p>
      <Button
        disabled={
          !live ||
          pending ||
          !fleet?.machines.some((machine) => machineBlocker(machine, "Fetch") === null)
        }
        onClick={() => start({ _tag: "Fetch", scope: { _tag: "All" } })}
      >
        {pending ? "Starting fetch…" : "Fetch all"}
      </Button>
      <Button
        disabled={!live || fleet === null || !canPull(fleet, { _tag: "All" })}
        onClick={() => setPulling(true)}
      >
        Pull all…
      </Button>
      {pulling && fleet !== null && (
        <PullDialog fleet={fleet} scope={{ _tag: "All" }} onClose={() => setPulling(false)} />
      )}
    </>
  );
}

function RescanAll({ live }: { readonly live: boolean }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startRescan] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <p role="status" className="text-sm text-danger">
        {failure}
      </p>
      <Button
        disabled={!live || pending}
        onClick={() =>
          startRescan(async () => {
            const result = await requestHub((client) =>
              client.Refresh({ target: { _tag: "All" } }),
            );

            setFailure(result._tag === "Failure" ? `Rescan failed. ${result.message}` : null);
          })
        }
      >
        {pending ? "Requesting rescan…" : "Rescan all"}
      </Button>
    </div>
  );
}

/** What every machine can do at once: fetch, pull and rescan. */
export function FleetActions({ hub }: { readonly hub: HubState }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FetchAndPull hub={hub} />
      <RescanAll live={hub._tag === "Live"} />
    </div>
  );
}
