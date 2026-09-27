import { Link, Outlet } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { SidebarLayout, sidebarLinkClass } from "@/ui/SidebarLayout.tsx";

import { trashEntries } from "./trashEntries.ts";

/** Where tidied-away work waits: the trash, and what can come back from it. */
export function CleanupLayout() {
  const fleet = knownFleet(useHub());
  const inTrash = fleet === null ? 0 : trashEntries(fleet).length;

  return (
    <SidebarLayout
      sidebar={
        <nav aria-label="Cleanup" className="px-3 py-4">
          <ul className="space-y-0.5">
            <li>
              <Link to="/cleanup/trash" className={sidebarLinkClass}>
                <Trash2Icon />
                <span className="flex-1">Trash</span>
                {inTrash > 0 && (
                  <span className="text-xs text-ink-muted tabular-nums">
                    {inTrash}
                    <span className="sr-only"> items</span>
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
