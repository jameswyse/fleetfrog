import { useState, useTransition } from "react";

import { requestHub } from "@/rpc/hubConnection.ts";

import type { BatchId, BatchRequest } from "@fleetfrog/protocol/domain/activity";

/** Starts a batch of actions, tracking the request and any refusal to show beside the control. */
export function useStartBatch() {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = (request: BatchRequest, onStarted?: (batchId: BatchId) => void) =>
    startTransition(async () => {
      const result = await requestHub((client) => client.StartBatch({ request }));

      if (result._tag === "Failure") {
        setFailure(result.message);

        return;
      }

      setFailure(null);
      onStarted?.(result.value.batchId);
    });

  return { start, pending, failure };
}
