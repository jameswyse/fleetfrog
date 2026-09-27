import { useState, useTransition } from "react";

import {
  ArrowDownToLineIcon,
  ChevronDownIcon,
  CloudDownloadIcon,
  FolderSearchIcon,
} from "lucide-react";

import { knownFleet, requestHub } from "@/rpc/hubConnection.ts";
import { Menu, MenuItem } from "@/ui/Menu.tsx";

import { canPull, machineBlocker } from "../actions/actionAvailability.ts";
import { PullDialog } from "../actions/PullDialog.tsx";
import { useStartBatch } from "../actions/useStartBatch.ts";

import type { HubState } from "@/rpc/hubConnection.ts";

/** A menu of actions across every machine, beside the grid's filters. */
export function FleetActions({ hub }: { readonly hub: HubState }) {
  const fetching = useStartBatch();
  const [pulling, setPulling] = useState(false);
  const [rescanFailure, setRescanFailure] = useState<string | null>(null);
  const [rescanning, startRescan] = useTransition();
  const fleet = knownFleet(hub);
  const live = hub._tag === "Live";
  const failure =
    fetching.failure === null ? rescanFailure : `Couldn't start the fetch. ${fetching.failure}`;

  return (
    <>
      <Menu
        trigger={{
          className:
            "inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-raised",
          content: (
            <>
              Fleet actions
              <ChevronDownIcon aria-hidden="true" className="size-4 text-ink-muted" />
            </>
          ),
        }}
      >
        {(close) => (
          <>
            <MenuItem
              icon={<CloudDownloadIcon />}
              disabled={
                !live ||
                fetching.pending ||
                !fleet?.machines.some((machine) => machineBlocker(machine, "Fetch") === null)
              }
              onClick={() => fetching.start({ _tag: "Fetch", scope: { _tag: "All" } }, close)}
            >
              {fetching.pending ? "Starting…" : "Fetch every repository"}
            </MenuItem>
            <MenuItem
              icon={<ArrowDownToLineIcon />}
              disabled={!live || fleet === null || !canPull(fleet, { _tag: "All" })}
              onClick={() => {
                close();
                setPulling(true);
              }}
            >
              Pull every checkout
            </MenuItem>
            <MenuItem
              icon={<FolderSearchIcon />}
              disabled={!live || rescanning}
              onClick={() =>
                startRescan(async () => {
                  const result = await requestHub((client) =>
                    client.Refresh({ target: { _tag: "All" } }),
                  );

                  if (result._tag === "Failure") {
                    setRescanFailure(`Couldn't start a rescan. ${result.message}`);
                  } else {
                    setRescanFailure(null);
                    close();
                  }
                })
              }
            >
              {rescanning ? "Requesting rescan…" : "Rescan every machine"}
            </MenuItem>
            <p role="status" className="px-3 text-sm text-danger">
              {failure}
            </p>
          </>
        )}
      </Menu>
      {pulling && fleet !== null && (
        <PullDialog fleet={fleet} scope={{ _tag: "All" }} onClose={() => setPulling(false)} />
      )}
    </>
  );
}
