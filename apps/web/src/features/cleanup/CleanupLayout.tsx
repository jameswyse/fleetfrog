import { Link, Outlet } from "@tanstack/react-router";
import { ArchiveIcon, Trash2Icon } from "lucide-react";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { SidebarLayout, sidebarLinkClass } from "@/ui/SidebarLayout.tsx";

import { trashEntries } from "./trashEntries.ts";

/** Where tidied-away work waits: the archive and the trash, and what can come back from each. */
export function CleanupLayout() {
  const fleet = knownFleet(useHub());
  const inTrash = fleet === null ? 0 : trashEntries(fleet).length;
  const archived =
    fleet?.archive.reduce((count, { checkouts }) => count + checkouts.length, 0) ?? 0;

  return (
    <SidebarLayout
      sidebar={
        <nav aria-label="Cleanup" className="px-3 py-4">
          <ul className="space-y-0.5">
            <li>
              <Link to="/cleanup/archive" className={sidebarLinkClass}>
                <ArchiveIcon />
                <span className="flex-1">Archive</span>
                {archived > 0 && (
                  <span className="text-xs text-ink-muted tabular-nums">
                    {archived}
                    <span className="sr-only"> archived</span>
                  </span>
                )}
              </Link>
            </li>
            <li>
              <Link to="/cleanup/trash" className={sidebarLinkClass}>
                <Trash2Icon />
                <span className="flex-1">Trash</span>
                {inTrash > 0 && (
                  <span className="text-xs text-ink-muted tabular-nums">
                    {inTrash}
                    <span className="sr-only"> in the trash</span>
                  </span>
                )}
              </Link>
            </li>
          </ul>
        </nav>
      }
    >
      <Outlet />
    </SidebarLayout>
  );
}
