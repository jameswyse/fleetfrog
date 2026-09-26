import type { ReactNode } from "react";

const tones = {
  neutral: "border-line text-ink-muted",
  changes: "border-changes/30 bg-changes-soft text-changes",
  sync: "border-sync/30 bg-sync-soft text-sync",
  danger: "border-danger/30 bg-danger-soft text-danger",
  clean: "border-transparent text-clean",
} as const;

export type ChipTone = keyof typeof tones;

/** A short status label. The text carries the meaning; colour only reinforces it. */
export function Chip({
  tone,
  children,
}: {
  readonly tone: ChipTone;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-px text-xs leading-5 font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
