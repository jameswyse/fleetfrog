import { useState, useTransition } from "react";

import { Link } from "@tanstack/react-router";
import {
  ArrowDownToLineIcon,
  CloudDownloadIcon,
  FolderSearchIcon,
  SettingsIcon,
} from "lucide-react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { useRole } from "@/rpc/session.ts";
import { Menu, MenuIcon, MenuItem, menuItemClass } from "@/ui/Menu.tsx";

import { canPull, machineBlocker } from "../actions/actionAvailability.ts";
import { PullDialog } from "../actions/PullDialog.tsx";
import { useStartBatch } from "../actions/useStartBatch.ts";

import type { ReactNode } from "react";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";

export function MachineActions({
  fleet,
  machine,
  trigger,
}: {
  readonly fleet: Fleet;
  readonly machine: Machine;
  readonly trigger: { readonly content: ReactNode; readonly className: string };
}) {
  const role = useRole();
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
      <Menu trigger={trigger}>
        {(close) => (
          <>
            <MenuItem
              icon={<CloudDownloadIcon />}
              disabled={blocked || fetching.pending}
              onClick={() => fetching.start({ _tag: "Fetch", scope }, close)}
            >
              {fetching.pending ? "Starting…" : "Fetch every repository"}
            </MenuItem>
            <MenuItem
              icon={<ArrowDownToLineIcon />}
              disabled={blocked || !canPull(fleet, scope)}
              onClick={() => {
                close();
                setPulling(true);
              }}
            >
              Pull every checkout
            </MenuItem>
            <MenuItem
              icon={<FolderSearchIcon />}
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
            {role === "admin" && (
              <Link
                to="/settings/fleet/$machineId"
                params={{ machineId: machine.id }}
                className={menuItemClass}
              >
                <MenuIcon>
                  <SettingsIcon />
                </MenuIcon>
                Machine settings
              </Link>
            )}
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
