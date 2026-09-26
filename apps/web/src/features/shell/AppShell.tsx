import { useState, useTransition } from "react";

import { Link, Outlet } from "@tanstack/react-router";

import { requestHub, useHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Logo } from "@/ui/Logo.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";

import type { HubState } from "@/rpc/hubConnection.ts";

const navigation = [
  { to: "/", label: "Overview" },
  { to: "/machines", label: "Machines" },
  { to: "/settings", label: "Settings" },
] as const;

function HubStatus() {
  const hub = useHub();
  const [label, tone] = {
    Connecting: ["Connecting to hub…", "bg-ink-muted"],
    Live: ["Live", "bg-clean"],
    Reconnecting: ["Hub unreachable, retrying", "bg-danger"],
  }[hub._tag];

  return (
    <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
      <span aria-hidden="true" className={`size-2 rounded-full ${tone}`} />
      {label}
    </p>
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

/**
 * Says when the page shows a fleet the hub may since have changed. The live region stays mounted
 * so screen readers announce the text when it appears.
 */
function StaleNotice({ hub }: { readonly hub: HubState }) {
  const stale = hub._tag === "Reconnecting" ? hub.snapshot : null;

  return (
    <div
      className={
        stale === null
          ? undefined
          : "flex flex-wrap gap-x-2 border-b border-changes/30 bg-changes-soft px-4 py-2.5 text-sm text-changes sm:px-6"
      }
    >
      <p role="status" className="font-medium">
        {stale !== null && "Can't reach the hub. Showing the last known state."}
      </p>
      {stale !== null && (
        <p>
          Last updated <RelativeTime at={stale.receivedAt} />.
        </p>
      )}
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
      <header className="sticky top-0 z-[5] border-b border-line bg-surface/90 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center rounded-md">
            <Logo className="h-7 w-auto" />
          </Link>
          <nav aria-label="Main">
            <ul className="flex gap-1">
              {navigation.map(({ to, label }) => (
                <li key={to}>
                  <Link
                    to={to}
                    activeOptions={{ exact: true, includeSearch: false }}
                    className="rounded-md px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink aria-[current=page]:bg-surface-raised aria-[current=page]:text-ink"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ms-auto flex items-center gap-4">
            <HubStatus />
            <RescanAll live={hub._tag === "Live"} />
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
