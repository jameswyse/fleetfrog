import { useState, useTransition } from "react";

import { Schema } from "effect";

import { knownFleet, requestHub, useHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { PollingSettings } from "@fleetfrog/protocol/domain/polling";

import { SettingsFooter, SettingsPage, SettingsRow, SettingsSection } from "../SettingsPage.tsx";

type Field = {
  readonly name: keyof PollingSettings;
  readonly label: string;
  readonly hint: string;
  readonly unit: "seconds" | "minutes";
};

const fields: ReadonlyArray<Field> = [
  {
    name: "idleStatusSeconds",
    label: "Status checks",
    hint: "How often agents reread each checkout while nobody has the dashboard open.",
    unit: "minutes",
  },
  {
    name: "watchingStatusSeconds",
    label: "Status checks while watching",
    hint: "The faster rate used while any dashboard is open.",
    unit: "seconds",
  },
  {
    name: "discoverySeconds",
    label: "Discovery",
    hint: "How often agents walk their discovery folders for new repositories.",
    unit: "minutes",
  },
  {
    name: "githubSeconds",
    label: "GitHub",
    hint: "How often agents ask GitHub for default branches and pull requests.",
    unit: "minutes",
  },
];

const validatePolling = Schema.decodeUnknownOption(PollingSettings);

type SaveState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Saved" }
  | { readonly _tag: "Invalid"; readonly fields: ReadonlySet<keyof PollingSettings> }
  | { readonly _tag: "Failed"; readonly message: string };

const minimumSeconds = 5;

export function ScanningSettings() {
  const hub = useHub();
  const [state, setState] = useState<SaveState>({ _tag: "Idle" });
  const [saving, startSaving] = useTransition();
  const fleet = knownFleet(hub);

  if (fleet === null) {
    return (
      <SettingsPage trail={[{ label: "Scanning" }]}>
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      </SettingsPage>
    );
  }

  const { polling } = fleet;
  const live = hub._tag === "Live";

  return (
    <SettingsPage trail={[{ label: "Scanning" }]}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();

          const form = event.currentTarget;
          const values = new FormData(form);
          const candidate = Object.fromEntries(
            fields.map(({ name, unit }) => [
              name,
              Math.round(Number(values.get(name)) * (unit === "minutes" ? 60 : 1)),
            ]),
          );
          const settings = validatePolling(candidate);

          if (settings._tag === "None") {
            const invalid = fields
              .map(({ name }) => name)
              .filter((name) => !Schema.is(PollingSettings.fields[name])(candidate[name]));
            const [first] = invalid;
            const input = first === undefined ? null : form.elements.namedItem(first);

            setState({ _tag: "Invalid", fields: new Set(invalid) });

            if (input instanceof HTMLInputElement) {
              input.focus();
            }

            return;
          }

          startSaving(async () => {
            const result = await requestHub((client) =>
              client.UpdatePolling({ polling: settings.value }),
            );

            setState(
              result._tag === "Failure"
                ? { _tag: "Failed", message: result.message }
                : { _tag: "Saved" },
            );
          });
        }}
      >
        <SettingsSection title="Intervals for every machine">
          {fields.map(({ name, label, hint, unit }) => {
            const invalid = state._tag === "Invalid" && state.fields.has(name);

            return (
              <SettingsRow
                key={name}
                title={label}
                description={hint}
                htmlFor={name}
                control={
                  <span className="flex items-center gap-2 text-sm">
                    <span className="text-ink-muted">Every</span>
                    <input
                      // Keyed on the saved value, so a change from the hub replaces what is shown.
                      key={polling[name]}
                      id={name}
                      name={name}
                      type="number"
                      inputMode="decimal"
                      min={unit === "minutes" ? minimumSeconds / 60 : minimumSeconds}
                      step="any"
                      required
                      aria-describedby={
                        invalid ? `${name}-description ${name}-error` : `${name}-description`
                      }
                      aria-invalid={invalid ? true : undefined}
                      defaultValue={unit === "minutes" ? polling[name] / 60 : polling[name]}
                      className="min-h-9 w-20 rounded-md border border-line bg-canvas px-2.5 text-end tabular-nums aria-invalid:border-danger"
                    />
                    <span className="w-14 text-ink-muted">{unit}</span>
                  </span>
                }
              >
                {invalid ? (
                  <p id={`${name}-error`} className="text-sm text-danger">
                    Enter an interval of at least 5 seconds.
                  </p>
                ) : undefined}
              </SettingsRow>
            );
          })}
          <SettingsFooter>
            <p role="status" className="me-auto text-sm">
              {!live && (
                <span className="text-ink-muted">
                  Saving is paused until the dashboard reconnects to the hub.
                </span>
              )}
              {state._tag === "Saved" && (
                <span className="text-clean">Saved. Agents pick up the new intervals now.</span>
              )}
              {state._tag === "Invalid" && (
                <span className="text-danger">
                  Each interval must be at least 5 seconds. Check the marked fields.
                </span>
              )}
              {state._tag === "Failed" && <span className="text-danger">{state.message}</span>}
            </p>
            <Button tone="primary" type="submit" disabled={saving || !live}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </SettingsFooter>
        </SettingsSection>
      </form>
    </SettingsPage>
  );
}
