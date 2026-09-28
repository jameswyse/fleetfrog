import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { setColorScheme, usePreferences } from "./preferences.ts";

import type { LucideIcon } from "lucide-react";

import type { ColorScheme } from "./preferences.ts";

const schemes = [
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
] as const satisfies ReadonlyArray<{
  readonly value: ColorScheme;
  readonly label: string;
  readonly Icon: LucideIcon;
}>;

/** This browser's colour scheme as three buttons, applying as soon as one is pressed. */
export function ThemePicker({
  labelledBy,
  className = "",
}: {
  /** The id of the text that labels the group. */
  readonly labelledBy: string;
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
          onClick={() => setColorScheme(value)}
          className="flex min-h-7 items-center justify-center gap-1.5 rounded px-2 text-xs text-ink-muted hover:text-ink aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-sm"
        >
          <Icon aria-hidden="true" className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
