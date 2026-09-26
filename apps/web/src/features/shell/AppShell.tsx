import { useState, useTransition } from "react";

import { Link, Outlet } from "@tanstack/react-router";

import { knownFleet, requestHub, useHub, useRuns } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Logo } from "@/ui/Logo.tsx";
import { Spinner } from "@/ui/Spinner.tsx";

import { canPull, machineBlocker } from "../actions/actionAvailability.ts";
import { PullDialog } from "../actions/PullDialog.tsx";
import { useStartBatch } from "../actions/useStartBatch.ts";
import { HubStatus } from "./HubStatus.tsx";
import { StaleNotice } from "./StaleNotice.tsx";

import type { HubState } from "@/rpc/hubConnection.ts";

const navigation = [
  { to: "/", label: "Overview" },
  { to: "/activity", label: "Activity" },
  { to: "/settings", label: "Settings" },
] as const;

/** How many runs are queued or running, linking to where they can be followed. */
function RunningIndicator() {
  const { active } = useRuns();

  if (active.length === 0) {
    return null;
  }

  return (
    <Link
      to="/activity"
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sync hover:bg-surface-raised"
    >
      <Spinner />
      <span>
        <span className="sr-only">Activity: </span>
        {active.length} running
      </span>
    </Link>
  );
}

/** Fetches every repository, or asks before pulling every checkout. */
function FleetActions({ hub }: { readonly hub: HubState }) {
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

export function AppShell() {
  const hub = useHub();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-[5] border-b border-line bg-surface/90 backdrop-blur lg:h-(--app-header-height)">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:h-full lg:flex-nowrap lg:py-0">
          <Link to="/" className="flex items-center rounded-md">
            <Logo className="h-7 w-auto" />
          </Link>
          <nav aria-label="Main">
            <ul className="flex gap-1">
              {navigation.map(({ to, label }) => (
                <li key={to}>
                  <Link
                    to={to}
                    // Settings stays current on every settings page; the overview only on its own.
                    activeOptions={{ exact: to === "/", includeSearch: false }}
                    className="rounded-md px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink aria-[current=page]:bg-surface-raised aria-[current=page]:text-ink"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ms-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <HubStatus />
            <RunningIndicator />
            <div className="flex flex-wrap items-center gap-2">
              <FleetActions hub={hub} />
              <RescanAll live={hub._tag === "Live"} />
            </div>
          </div>
        </div>
      </header>
      <main id="content" className="flex-1">
        <StaleNotice hub={hub} />
        <Outlet />
      </main>
    </div>
  );
}
