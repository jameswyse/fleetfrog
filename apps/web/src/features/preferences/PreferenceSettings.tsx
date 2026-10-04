import { useId } from "react";

import { Switch } from "@/ui/Switch.tsx";

import { SettingsRow, SettingsSection } from "../settings/SettingsSection.tsx";
import { SaveStatus, useAutoSave } from "../settings/useAutoSave.tsx";
import { changePreferences, usePreferences } from "./preferences.ts";
import { ThemePicker } from "./ThemePicker.tsx";

import type { Preferences } from "@fleetfrog/protocol/domain/preferences";

export function PreferenceSettings({ title }: { readonly title: string }) {
  const themeId = useId();
  const blurId = useId();
  const { blurPersonal } = usePreferences();
  const { state, save } = useAutoSave();
  const change = (next: Partial<Preferences>) => void save(() => changePreferences(next));

  return (
    <SettingsSection title={title} status={<SaveStatus state={state} />}>
      <SettingsRow
        title={<span id={themeId}>Theme</span>}
        control={
          <ThemePicker
            labelledBy={themeId}
            onPick={(colorScheme) => change({ colorScheme })}
            className="w-64"
          />
        }
      />
      <SettingsRow
        title="Blur emails and usernames"
        description="For sharing your screen. Email addresses, and usernames from services such as GitHub, stay blurred until you point at them."
        htmlFor={blurId}
        control={
          <Switch
            id={blurId}
            checked={blurPersonal}
            onChange={(on) => change({ blurPersonal: on })}
            aria-describedby={`${blurId}-description`}
          />
        }
      />
    </SettingsSection>
  );
}
