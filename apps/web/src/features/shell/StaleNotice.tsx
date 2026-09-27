import { useDashboardOutdated } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";

import type { HubState } from "@/rpc/hubConnection.ts";

/**
 * Says when the page shows a fleet the hub may since have changed, or when the hub was updated and
 * the page needs reloading. The live region stays mounted so screen readers announce the text when
 * it appears.
 */
export function StaleNotice({ hub }: { readonly hub: HubState }) {
  const outdated = useDashboardOutdated();
  const stale = hub._tag === "Reconnecting" ? hub.snapshot : null;

  if (outdated) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-changes/30 bg-changes-soft px-4 py-2 text-sm text-changes sm:px-6">
        <p role="status" className="font-medium">
          FleetFrog was updated. Reload the page to keep using it.
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }

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
