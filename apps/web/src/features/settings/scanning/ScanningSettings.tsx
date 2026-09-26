import { useState, useTransition } from "react";

import { Schema } from "effect";

import { knownFleet, requestHub, useHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { PollingSettings } from "@fleetfrog/protocol/domain/polling";

import { SettingsHeading } from "../SettingsHeading.tsx";

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
    return <p className="py-24 text-center text-sm text-ink-muted">Waiting for the hub…</p>;
  }

  const { polling } = fleet;
  const live = hub._tag === "Live";

  return (
    <div>
      <SettingsHeading title="Scanning">
        How often agents check their repositories. These intervals apply to every machine.
      </SettingsHeading>
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
        className="space-y-5 rounded-lg border border-line bg-surface px-5 py-5"
      >
        {fields.map(({ name, label, hint, unit }) => {
          const invalid = state._tag === "Invalid" && state.fields.has(name);

          return (
            <div key={name}>
              <label htmlFor={name} className="block text-sm font-medium">
                {label}
              </label>
              <p id={`${name}-hint`} className="text-sm text-ink-muted">
                {hint}
              </p>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span>Every</span>
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
                  aria-describedby={invalid ? `${name}-hint ${name}-error` : `${name}-hint`}
                  aria-invalid={invalid ? true : undefined}
                  defaultValue={unit === "minutes" ? polling[name] / 60 : polling[name]}
                  className="min-h-9 w-24 rounded-md border border-line bg-canvas px-2.5 tabular-nums aria-invalid:border-danger"
                />
                <span>{unit}</span>
              </div>
              {invalid && (
                <p id={`${name}-error`} className="mt-1 text-sm text-danger">
                  Enter an interval of at least 5 seconds.
                </p>
              )}
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" type="submit" disabled={saving || !live}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {!live && (
            <p className="text-sm text-ink-muted">
              Saving is paused until the dashboard reconnects to the hub.
            </p>
          )}
          <p role="status" className="text-sm">
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
        </div>
      </form>
    </div>
  );
}
