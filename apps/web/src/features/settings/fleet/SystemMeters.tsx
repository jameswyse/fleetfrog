import { formatLoad, percent } from "./systemFormat.ts";

import type { SystemUsage } from "@fleetfrog/protocol/domain/machine";

const usageFills = [
  { from: 0.9, fill: "bg-danger" },
  { from: 0.8, fill: "bg-changes" },
  { from: 0, fill: "bg-clean" },
] as const;

function Bar({ share, className }: { readonly share: number; readonly className: string }) {
  const { fill } = usageFills.find(({ from }) => share >= from) ?? usageFills[2];

  return (
    <div aria-hidden="true" className={`h-1.5 overflow-hidden rounded-full bg-line ${className}`}>
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${share * 100}%` }} />
    </div>
  );
}

const clamp = (share: number) => Math.min(1, Math.max(0, share));

export function UsageBar({
  used,
  total,
  usedShare,
}: {
  readonly used: string;
  readonly total: string;
  readonly usedShare: number;
}) {
  const share = clamp(usedShare);

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span>
          {used} <span className="text-ink-muted">of {total}</span>
        </span>
        <span className="text-ink-muted tabular-nums">{percent.format(share)} used</span>
      </div>
      <Bar share={share} className="mt-1.5" />
    </>
  );
}

export function UsageMeter({
  usedShare,
  description,
}: {
  readonly usedShare: number;
  readonly description: string;
}) {
  const share = clamp(usedShare);

  return (
    <div title={description} className="flex items-center gap-2">
      <Bar share={share} className="w-16 shrink-0" />
      <span className="tabular-nums">{percent.format(share)}</span>
      <span className="sr-only">, {description}</span>
    </div>
  );
}

const loadLevels = [
  { level: "light", below: 0.7, tone: "border-clean/30 bg-clean/10 text-clean" },
  { level: "busy", below: 1, tone: "border-changes/30 bg-changes-soft text-changes" },
  {
    level: "overloaded",
    below: Number.POSITIVE_INFINITY,
    tone: "border-danger/30 bg-danger-soft text-danger",
  },
] as const;

export function LoadPills({
  loadAverage,
  cores,
  labels,
}: {
  readonly loadAverage: SystemUsage["loadAverage"];
  readonly cores: number;
  readonly labels: "Labelled" | "Bare";
}) {
  const [one, five, fifteen] = loadAverage;

  const windows = [
    ["1 min", one],
    ["5 min", five],
    ["15 min", fifteen],
  ] as const;

  return (
    <ul className={`flex gap-1.5 ${labels === "Labelled" ? "flex-wrap" : ""}`}>
      {windows.map(([window, load]) => {
        const { level, tone } =
          loadLevels.find(({ below }) => load / Math.max(1, cores) < below) ?? loadLevels[2];

        return (
          <li
            key={window}
            title={`${window}: ${formatLoad(load)} across ${cores} processors, ${level}`}
            className={`inline-flex items-baseline gap-1.5 rounded-full border px-2 py-px text-xs ${tone}`}
          >
            <span className={labels === "Labelled" ? "opacity-75" : "sr-only"}>{window}</span>
            <span className="font-medium tabular-nums">{formatLoad(load)}</span>
            <span className="sr-only">, {level}</span>
          </li>
        );
      })}
    </ul>
  );
}
