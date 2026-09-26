import { useSyncExternalStore } from "react";

import { DateTime } from "effect";

const tickMilliseconds = 15_000;
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const units = [
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
] as const;

let now = Date.now();
const listeners = new Set<() => void>();

// One shared clock keeps every relative time on the page in step.
setInterval(() => {
  now = Date.now();

  for (const listener of listeners) {
    listener();
  }
}, tickMilliseconds);

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function formatRelative(at: DateTime.Utc, currentTime: number): string {
  const seconds = Math.round((DateTime.toEpochMillis(at) - currentTime) / 1000);

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }

  return "just now";
}

export function RelativeTime({ at }: { readonly at: DateTime.Utc }) {
  const currentTime = useSyncExternalStore(subscribe, () => now);
  const date = DateTime.toDate(at);

  return (
    <time dateTime={date.toISOString()} title={absolute.format(date)}>
      {formatRelative(at, currentTime)}
    </time>
  );
}
