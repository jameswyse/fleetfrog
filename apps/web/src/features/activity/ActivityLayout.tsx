import { Link, Outlet, useMatch, useNavigate, useSearch } from "@tanstack/react-router";
import { CirclePlayIcon, HistoryIcon } from "lucide-react";

import { useRuns } from "@/rpc/hubConnection.ts";
import { SidebarLayout, sidebarLinkClass } from "@/ui/SidebarLayout.tsx";
import { Spinner } from "@/ui/Spinner.tsx";

import { BatchDetailPanel } from "./BatchDetailPanel.tsx";
import { HistoryFilters } from "./HistoryFilters.tsx";

/** Moving between the running and history pages keeps the history filters. */
export function ActivityLayout() {
  const { activeBatches } = useRuns();
  const search = useSearch({ from: "/_app/activity" });
  const navigate = useNavigate({ from: "/activity" });
  const onHistory = useMatch({ from: "/_app/activity/", shouldThrow: false }) !== undefined;

  return (
    <SidebarLayout
      sidebar={
        <>
          <nav aria-label="Activity" className="px-3 py-4">
            <ul className="space-y-0.5">
              <li>
                <Link
                  to="/activity/running"
                  search={({ batch: _batch, ...filters }) => filters}
                  activeOptions={{ includeSearch: false }}
                  className={sidebarLinkClass}
                >
                  <CirclePlayIcon />
                  <span className="flex-1">Running</span>
                  {activeBatches.length > 0 && (
                    <span className="flex items-center gap-1.5 text-xs text-sync tabular-nums">
                      <Spinner />
                      {activeBatches.length}
                      <span className="sr-only"> in progress</span>
                    </span>
                  )}
                </Link>
              </li>
              <li>
                <Link
                  to="/activity"
                  search={({ batch: _batch, ...filters }) => filters}
                  activeOptions={{ exact: true, includeSearch: false }}
                  className={sidebarLinkClass}
                >
                  <HistoryIcon />
                  History
                </Link>
              </li>
            </ul>
          </nav>
          {onHistory && <HistoryFilters />}
        </>
      }
    >
      <Outlet />
      {search.batch !== undefined && (
        <BatchDetailPanel
          batchId={search.batch}
          onClose={() => {
            void navigate({
              to: onHistory ? "/activity" : "/activity/running",
              search: ({ batch: _batch, ...rest }) => rest,
            });
          }}
        />
      )}
    </SidebarLayout>
  );
}
