import { useDashboardOutdated } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";

export function OutdatedNotice() {
  const outdated = useDashboardOutdated();

  if (!outdated) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-changes/30 bg-changes-soft px-4 py-2 text-sm text-changes sm:px-6">
      <p role="status" className="font-medium">
        FleetFrog was updated. Reload the page to keep using it.
      </p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  );
}
