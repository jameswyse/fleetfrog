import { useState, useTransition } from "react";

import { Link } from "@tanstack/react-router";

import { requestHub } from "@/rpc/hubConnection.ts";
import { Menu, MenuItem, menuItemClass } from "@/ui/Menu.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { canPull, machineBlocker } from "../actions/actionAvailability.ts";
import { PullDialog } from "../actions/PullDialog.tsx";
import { useStartBatch } from "../actions/useStartBatch.ts";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";

/** A machine column's menu: fetch, pull or rescan everything on it, or open its settings. */
export function MachineActions({
  fleet,
  machine,
}: {
  readonly fleet: Fleet;
  readonly machine: Machine;
}) {
  const [pulling, setPulling] = useState(false);
  const fetching = useStartBatch();
  const [rescanning, startRescan] = useTransition();
  const [rescanFailure, setRescanFailure] = useState<string | null>(null);
  const scope = { _tag: "Machine", machineId: machine.id } as const;
  const blocked = machineBlocker(machine, "Fetch") !== null;
  const failure =
    fetching.failure === null ? rescanFailure : `Couldn't start the fetch. ${fetching.failure}`;

  return (
    <>
      <Menu label={`Actions for ${machineLabel(machine)}`}>
        {(close) => (
          <>
            <MenuItem
              disabled={blocked || fetching.pending}
              onClick={() => fetching.start({ _tag: "Fetch", scope }, close)}
            >
              {fetching.pending ? "Starting…" : "Fetch every repository"}
            </MenuItem>
            <MenuItem
              disabled={blocked || !canPull(fleet, scope)}
              onClick={() => {
                close();
                setPulling(true);
              }}
            >
              Pull every checkout…
            </MenuItem>
            <MenuItem
              disabled={machine.connection._tag === "Offline" || rescanning}
              onClick={() =>
                startRescan(async () => {
                  const result = await requestHub((client) =>
                    client.Refresh({ target: { _tag: "Machine", machineId: machine.id } }),
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
              {rescanning ? "Requesting rescan…" : "Rescan now"}
            </MenuItem>
            <Link
              to="/settings/fleet/$machineId"
              params={{ machineId: machine.id }}
              className={menuItemClass}
            >
              Machine settings
            </Link>
            <p role="status" className="px-3 text-sm text-danger">
              {failure}
            </p>
          </>
        )}
      </Menu>
      {pulling && <PullDialog fleet={fleet} scope={scope} onClose={() => setPulling(false)} />}
    </>
  );
}
