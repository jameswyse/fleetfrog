import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { usePreferences } from "./preferences.ts";

import type { LucideIcon } from "lucide-react";

import type { ColorScheme } from "@fleetfrog/protocol/domain/preferences";

const schemes = [
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
] as const satisfies ReadonlyArray<{
  readonly value: ColorScheme;
  readonly label: string;
  readonly Icon: LucideIcon;
}>;

/** The colour scheme as three buttons, the current one pressed. */
export function ThemePicker({
  labelledBy,
  onPick,
  className = "",
}: {
  /** The id of the text that labels the group. */
  readonly labelledBy: string;
  readonly onPick: (colorScheme: ColorScheme) => void;
  readonly className?: string;
}) {
  const { colorScheme } = usePreferences();

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className={`grid grid-cols-3 gap-0.5 rounded-md bg-canvas p-0.5 ${className}`}
    >
      {schemes.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={colorScheme === value}
          onClick={() => onPick(value)}
          className="flex min-h-7 items-center justify-center gap-1.5 rounded px-2 text-xs text-ink-muted hover:text-ink aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-sm"
        >
          <Icon aria-hidden="true" className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
