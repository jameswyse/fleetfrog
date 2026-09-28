import { useId } from "react";

import { Switch } from "@/ui/Switch.tsx";

import { SettingsRow, SettingsSection } from "../settings/SettingsSection.tsx";
import { setBlurPersonal, usePreferences } from "./preferences.ts";
import { ThemePicker } from "./ThemePicker.tsx";

/** The settings this browser keeps for itself, whoever signs in. */
export function BrowserSettings() {
  const themeId = useId();
  const blurId = useId();
  const { blurPersonal } = usePreferences();

  return (
    <SettingsSection title="This browser">
      <SettingsRow
        title={<span id={themeId}>Theme</span>}
        control={<ThemePicker labelledBy={themeId} className="w-64" />}
      />
      <SettingsRow
        title="Blur emails and usernames"
        description="For sharing your screen. Email addresses, and usernames from services such as GitHub, stay blurred until you point at them."
        htmlFor={blurId}
        control={
          <Switch
            id={blurId}
            checked={blurPersonal}
            onChange={setBlurPersonal}
            aria-describedby={`${blurId}-description`}
          />
        }
      />
    </SettingsSection>
  );
}
