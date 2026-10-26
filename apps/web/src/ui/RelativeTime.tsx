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

const ageUnits = [
  { unit: "day", letter: "d", size: 86_400 },
  { unit: "hour", letter: "h", size: 3600 },
  { unit: "minute", letter: "m", size: 60 },
] as const;

const spokenAge = new Intl.RelativeTimeFormat(undefined, { numeric: "always" });

function ageOf(at: DateTime.Utc, currentTime: number) {
  const seconds = Math.max(0, Math.round((currentTime - DateTime.toEpochMillis(at)) / 1000));
  const unit = ageUnits.find(({ size }) => seconds >= size);

  return unit === undefined ? null : { ...unit, count: Math.floor(seconds / unit.size) };
}

export function formatAge(at: DateTime.Utc, currentTime: number): string {
  const age = ageOf(at, currentTime);

  return age === null ? "now" : `${age.count}${age.letter}`;
}

export function speakAge(at: DateTime.Utc, currentTime: number): string {
  const age = ageOf(at, currentTime);

  return age === null ? "just now" : spokenAge.format(-age.count, age.unit);
}

export function RelativeTime({
  at,
  format = "phrase",
}: {
  readonly at: DateTime.Utc;
  readonly format?: "phrase" | "age";
}) {
  const currentTime = useNow();
  const date = DateTime.toDate(at);

  return (
    <time dateTime={date.toISOString()} title={absolute.format(date)}>
      {format === "phrase" ? (
        formatRelative(at, currentTime)
      ) : (
        <>
          <span aria-hidden="true">{formatAge(at, currentTime)}</span>
          <span className="sr-only">{speakAge(at, currentTime)}</span>
        </>
      )}
    </time>
  );
}
