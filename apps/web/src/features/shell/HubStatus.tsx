import { useHub } from "@/rpc/hubConnection.ts";

/** Whether the dashboard is connected to the hub, as a dot and a word or two. */
export function HubStatus() {
  const hub = useHub();
  const [label, tone] = {
    Connecting: ["Connecting to hub…", "bg-ink-muted"],
    Live: ["Connected", "bg-clean"],
    Reconnecting: ["Hub unreachable, retrying", "bg-danger"],
  }[hub._tag];

  return (
    <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
      <span aria-hidden="true" className={`size-2 rounded-full ${tone}`} />
      {label}
    </p>
  );
}
