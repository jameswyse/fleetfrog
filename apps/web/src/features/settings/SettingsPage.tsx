import { useState, useTransition } from "react";

import { Schema } from "effect";

import { requestHub, useHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { PollingSettings } from "@fleetfrog/protocol/domain/polling";

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
  | { readonly _tag: "Invalid" }
  | { readonly _tag: "Failed"; readonly message: string };

export function SettingsPage() {
  const hub = useHub();
  const [state, setState] = useState<SaveState>({ _tag: "Idle" });
  const [saving, startSaving] = useTransition();

  if (hub._tag !== "Live") {
    return <p className="px-6 py-24 text-center text-sm text-ink-muted">Waiting for the hub…</p>;
  }

  const { polling } = hub.fleet;

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 sm:px-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <p className="text-sm text-ink-muted">These intervals apply to every agent.</p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();

          const form = new FormData(event.currentTarget);
          const candidate = Object.fromEntries(
            fields.map(({ name, unit }) => [
              name,
              Math.round(Number(form.get(name)) * (unit === "minutes" ? 60 : 1)),
            ]),
          );
          const settings = validatePolling(candidate);

          if (settings._tag === "None") {
            setState({ _tag: "Invalid" });

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
        className="mt-5 space-y-5 rounded-lg border border-line bg-surface px-5 py-5"
      >
        {fields.map(({ name, label, hint, unit }) => (
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
                id={name}
                name={name}
                type="number"
                inputMode="decimal"
                min={unit === "minutes" ? 1 : 5}
                step="any"
                required
                aria-describedby={`${name}-hint`}
                aria-invalid={state._tag === "Invalid" ? true : undefined}
                defaultValue={unit === "minutes" ? polling[name] / 60 : polling[name]}
                className="min-h-9 w-24 rounded-md border border-line bg-canvas px-2.5 tabular-nums"
              />
              <span>{unit}</span>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <p role="status" className="text-sm">
            {state._tag === "Saved" && (
              <span className="text-clean">Saved. Agents pick up the new intervals now.</span>
            )}
            {state._tag === "Invalid" && (
              <span className="text-danger">Each interval must be at least 5 seconds.</span>
            )}
            {state._tag === "Failed" && <span className="text-danger">{state.message}</span>}
          </p>
        </div>
      </form>
    </div>
  );
}
