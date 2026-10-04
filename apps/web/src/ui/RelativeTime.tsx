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
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick() {
  now = Date.now();

  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  if (timer === null) {
    now = Date.now();
    timer = setInterval(tick, tickMilliseconds);
  }

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
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
  const currentTime = useNow();
  const date = DateTime.toDate(at);

  return (
    <time dateTime={date.toISOString()} title={absolute.format(date)}>
      {formatRelative(at, currentTime)}
    </time>
  );
}
