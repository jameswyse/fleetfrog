import { useId } from "react";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { Switch } from "@/ui/Switch.tsx";

import { setBlurPersonal, setColorScheme, usePreferences } from "./preferences.ts";

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

/** This browser's theme and blurring, for the header menu. Each applies as soon as it changes. */
export function PreferenceControls() {
  const themeId = useId();
  const blurId = useId();
  const { colorScheme, blurPersonal } = usePreferences();

  return (
    <div className="space-y-3 px-3 py-2">
      <div>
        <p id={themeId} className="mb-1.5 text-xs text-ink-muted">
          Theme
        </p>
        <div
          role="group"
          aria-labelledby={themeId}
          className="grid grid-cols-3 gap-0.5 rounded-md bg-canvas p-0.5"
        >
          {schemes.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={colorScheme === value}
              onClick={() => setColorScheme(value)}
              className="flex min-h-7 items-center justify-center gap-1.5 rounded text-xs text-ink-muted hover:text-ink aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-sm"
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <label htmlFor={blurId} className="block text-sm">
            Blur personal details
          </label>
          <p id={`${blurId}-description`} className="text-xs text-ink-muted">
            Names, emails and usernames
          </p>
        </div>
        <Switch
          id={blurId}
          checked={blurPersonal}
          onChange={setBlurPersonal}
          aria-describedby={`${blurId}-description`}
        />
      </div>
    </div>
  );
}
