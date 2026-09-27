import { Link, Outlet } from "@tanstack/react-router";

import { useHub, useRuns } from "@/rpc/hubConnection.ts";
import { Logo } from "@/ui/Logo.tsx";
import { Spinner } from "@/ui/Spinner.tsx";

import { HubStatus } from "./HubStatus.tsx";
import { StaleNotice } from "./StaleNotice.tsx";

const navigation = [
  { to: "/", label: "Projects" },
  { to: "/cleanup", label: "Cleanup" },
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
  const hub = useHub();

  return (
    // A page marked `data-fills-viewport` gets exactly the window's height and scrolls inside
    // itself, so its toolbars and header rows can stay in view.
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
              {navigation.map(({ to, label }) => (
                <li key={to}>
                  <Link
                    to={to}
                    // Settings stays current on every settings page; Projects only on its own.
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
          </div>
        </div>
      </header>
      <main id="content" className="flex min-h-0 flex-1 flex-col">
        <StaleNotice hub={hub} />
        <Outlet />
      </main>
    </div>
  );
}
