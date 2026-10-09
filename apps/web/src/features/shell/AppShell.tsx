import { useEffect } from "react";

import { Link, Outlet, useRouter } from "@tanstack/react-router";

import { knownFleet, useHub, useRuns } from "@/rpc/hubConnection.ts";
import { isSignedOut, useRole, useSession } from "@/rpc/session.ts";
import { Logo } from "@/ui/Logo.tsx";
import { Spinner } from "@/ui/Spinner.tsx";

import { t3CodeNeedsAttention } from "../settings/integrations/t3CodeHealth.ts";
import { HubStatus } from "./HubStatus.tsx";
import { OutdatedNotice } from "./OutdatedNotice.tsx";
import { UserMenu } from "./UserMenu.tsx";

const navigation = [
  { to: "/", label: "Projects", adminOnly: false },
  { to: "/cleanup", label: "Cleanup", adminOnly: true },
  { to: "/activity", label: "Activity", adminOnly: false },
  { to: "/settings", label: "Settings", adminOnly: true },
] as const;

function RunningIndicator() {
  const { active } = useRuns();

  if (active.length === 0) {
    return null;
  }

  return (
    <Link
      to="/activity/running"
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

export function AppShell() {
  const session = useSession();
  const role = useRole();
  const router = useRouter();
  const signedOut = isSignedOut(session);
  const hub = useHub();
  const fleet = knownFleet(hub);
  const settingsAttention = fleet !== null && t3CodeNeedsAttention(fleet);

  useEffect(() => {
    if (signedOut) {
      void router.invalidate();
    }
  }, [router, signedOut]);

  if (signedOut) {
    return null;
  }

  return (
    <div className="flex min-h-dvh flex-col has-[[data-fills-viewport]]:h-dvh">
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
              {navigation.flatMap(({ to, label, adminOnly }) =>
                adminOnly && role !== "admin"
                  ? []
                  : [
                      <li key={to}>
                        <Link
                          to={to}
                          activeOptions={{ exact: to === "/", includeSearch: false }}
                          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink aria-[current=page]:bg-surface-raised aria-[current=page]:text-ink"
                        >
                          {label}
                          {to === "/settings" && settingsAttention && (
                            <>
                              <span
                                aria-hidden="true"
                                className="size-1.5 rounded-full bg-danger"
                              />
                              <span className="sr-only">, needs attention</span>
                            </>
                          )}
                        </Link>
                      </li>,
                    ],
              )}
            </ul>
          </nav>
          <div className="ms-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <HubStatus />
            <RunningIndicator />
            <UserMenu />
          </div>
        </div>
      </header>
      <main id="content" className="flex min-h-0 flex-1 flex-col">
        <OutdatedNotice />
        <Outlet />
      </main>
    </div>
  );
}
