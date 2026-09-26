import { Link, Outlet } from "@tanstack/react-router";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { HubStatus } from "../shell/HubStatus.tsx";
import { StaleNotice } from "../shell/StaleNotice.tsx";

import type { ReactNode } from "react";

const linkClass =
  "flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink aria-[current=page]:bg-surface-raised aria-[current=page]:font-medium aria-[current=page]:text-ink";

function SectionLabel({ children }: { readonly children: ReactNode }) {
  return <p className="px-2 pt-5 pb-1 text-xs font-medium text-ink-muted">{children}</p>;
}

/** The machines in the fleet, each linking to its own settings, then a way to add one. */
function FleetLinks() {
  const hub = useHub();
  const machines = knownFleet(hub)?.machines ?? [];

  return (
    <ul className="space-y-0.5">
      <li>
        <Link to="/settings/fleet" activeOptions={{ exact: true }} className={linkClass}>
          All machines
        </Link>
      </li>
      {machines.map((machine) => {
        const online = machine.connection._tag === "Online";

        return (
          <li key={machine.id}>
            <Link
              to="/settings/fleet/$machineId"
              params={{ machineId: machine.id }}
              className={linkClass}
            >
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${online ? "bg-clean" : "bg-ink-muted"}`}
              />
              <span className="truncate">{machineLabel(machine)}</span>
              {!online && <span className="sr-only">, offline</span>}
            </Link>
          </li>
        );
      })}
      <li>
        <Link to="/settings/fleet/pair" className={linkClass}>
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none">
            <path
              d="M8 3v10M3 8h10"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          Pair a machine
        </Link>
      </li>
    </ul>
  );
}

/**
 * Settings fills the window with its own sidebar in place of the main header, so each section and
 * each machine has room for its own page.
 */
export function SettingsLayout() {
  const hub = useHub();

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="flex flex-col border-b border-line bg-surface md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 md:overflow-y-auto md:border-e md:border-b-0">
        <div className="px-3 pt-4">
          <Link
            to="/"
            className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none">
              <path
                d="M10 3.5 5.5 8l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back to overview
          </Link>
        </div>
        <nav aria-label="Settings" className="flex-1 px-3 pb-4">
          <SectionLabel>General</SectionLabel>
          <ul>
            <li>
              <Link to="/settings/scanning" className={linkClass}>
                Scanning
              </Link>
            </li>
          </ul>
          <SectionLabel>Fleet</SectionLabel>
          <FleetLinks />
        </nav>
        <div className="border-t border-line px-5 py-3">
          <HubStatus />
        </div>
      </aside>
      <main id="content" className="min-w-0 flex-1">
        <StaleNotice hub={hub} />
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
