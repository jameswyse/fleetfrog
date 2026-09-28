import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { useHub } from "@/rpc/hubConnection.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";

import type { FleetSnapshot } from "@/rpc/hubConnection.ts";

// A drop that the next retry fixes shouldn't interrupt anyone, so the bubble waits this long.
const announceAfterMilliseconds = 5000;
const announceForMilliseconds = 6000;

/**
 * Mounted for each drop, so every drop gets its own announcement. It sits at the header's level
 * rather than in the top layer, so menus, dialogs and the full-screen panel stay above it, and it
 * lets clicks through to whatever it covers.
 */
function StaleDetails({
  id,
  snapshot,
  peeking,
}: {
  readonly id: string;
  readonly snapshot: FleetSnapshot;
  readonly peeking: boolean;
}) {
  const [announcing, setAnnouncing] = useState(false);
  const open = announcing || peeking;

  useEffect(() => {
    const start = setTimeout(setAnnouncing, announceAfterMilliseconds, true);
    const end = setTimeout(
      setAnnouncing,
      announceAfterMilliseconds + announceForMilliseconds,
      false,
    );

    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
  }, []);

  // Outside the header, whose backdrop blur would otherwise be what a fixed child positions against.
  return createPortal(
    <div
      id={id}
      className={`pointer-events-none fixed z-[5] ms-[-0.75rem] me-4 mt-2.5 hidden max-w-64 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xl transition-[opacity,visibility] duration-150 [position-anchor:--hub-status] [position-area:bottom_span-right] supports-[position-area:bottom]:block ${open ? "visible opacity-100" : "invisible opacity-0"}`}
    >
      {/* The tail points up at the status dot, whose centre is 1rem in from the bubble's outer edge. */}
      <span
        aria-hidden="true"
        className="absolute -top-[5px] start-[11px] size-2 rotate-45 border-s border-t border-line bg-surface"
      />
      This page may be out of date. Last updated <RelativeTime at={snapshot.receivedAt} />.
    </div>,
    document.body,
  );
}

/**
 * Whether the dashboard is connected to the hub, as a dot and a word or two. While the hub is
 * unreachable, a bubble says how old the fleet on the page is. It shows by itself once the drop
 * outlasts a retry, and again on hover or focus.
 */
export function HubStatus() {
  const hub = useHub();
  const detailsId = useId();
  // The drop being peeked at, so a peek that outlives its drop, such as focus that never blurred
  // when the status stopped being focusable, can't open the next drop's bubble.
  const [peekedAt, setPeekedAt] = useState<FleetSnapshot | null>(null);
  const [label, tone] = {
    Connecting: ["Connecting to hub…", "bg-ink-muted"],
    Live: ["Connected", "bg-clean"],
    Reconnecting: ["Hub unreachable, retrying", "bg-danger"],
  }[hub._tag];
  const stale = hub._tag === "Reconnecting" ? hub.snapshot : null;
  const peeking = stale !== null && peekedAt === stale;

  return (
    <>
      <p
        role="status"
        // Focusable only while there is a bubble to show, which is how keyboard and touch reach it.
        tabIndex={stale === null ? undefined : 0}
        aria-describedby={stale === null ? undefined : detailsId}
        onPointerEnter={() => setPeekedAt(stale)}
        onPointerLeave={() => setPeekedAt(null)}
        onFocus={() => setPeekedAt(stale)}
        onBlur={() => setPeekedAt(null)}
        className="flex items-center gap-2 rounded-md text-sm text-ink-muted"
      >
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${tone} [anchor-name:--hub-status]`}
        />
        {label}
      </p>
      {stale !== null && <StaleDetails id={detailsId} snapshot={stale} peeking={peeking} />}
    </>
  );
}
