import { useState } from "react";

import { Schema } from "effect";

import { knownFleet, requestHub, useHub } from "@/rpc/hubConnection.ts";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { PollingSettings } from "@fleetfrog/protocol/domain/polling";

import { SettingsRow, SettingsSection } from "../SettingsSection.tsx";
import { SaveStatus, useAutoSave } from "../useAutoSave.tsx";

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
    label: "New repositories",
    hint: "How often agents search their project folders for repositories.",
    unit: "minutes",
  },
  {
    name: "githubSeconds",
    label: "GitHub",
    hint: "How often agents ask GitHub for default branches and pull requests.",
    unit: "minutes",
  },
];

const minimumSeconds = 5;

function readInterval(input: HTMLInputElement, field: Field): number | null {
  const seconds = Math.round(Number(input.value) * (field.unit === "minutes" ? 60 : 1));

  return input.value.trim() !== "" && Schema.is(PollingSettings.fields[field.name])(seconds)
    ? seconds
    : null;
}

export function ScanningSettings() {
  const hub = useHub();
  const fleet = knownFleet(hub);
  const { state, save } = useAutoSave();
  const [invalid, setInvalid] = useState<ReadonlySet<keyof PollingSettings>>(() => new Set());

  if (fleet === null) {
    return (
      <SidebarPage title="Scanning">
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      </SidebarPage>
    );
  }

  const { polling } = fleet;

  const commit = (field: Field, input: HTMLInputElement) => {
    const seconds = readInterval(input, field);
    const next = new Set(invalid);

    if (seconds === null) {
      setInvalid(next.add(field.name));

      return;
    }

    next.delete(field.name);
    setInvalid(next);

    if (seconds !== polling[field.name]) {
      void save(() =>
        requestHub((client) =>
          client.UpdatePolling({ polling: { ...polling, [field.name]: seconds } }),
        ),
      );
    }
  };

  return (
    <SidebarPage title="Scanning">
      <SettingsSection title="Intervals for every machine" status={<SaveStatus state={state} />}>
        {fields.map((field) => {
          const { name, label, hint, unit } = field;
          const isInvalid = invalid.has(name);

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
                    key={polling[name]}
                    id={name}
                    type="number"
                    inputMode="decimal"
                    min={unit === "minutes" ? minimumSeconds / 60 : minimumSeconds}
                    step="any"
                    required
                    aria-describedby={
                      isInvalid ? `${name}-description ${name}-error` : `${name}-description`
                    }
                    aria-invalid={isInvalid ? true : undefined}
                    defaultValue={unit === "minutes" ? polling[name] / 60 : polling[name]}
                    onBlur={(event) => commit(field, event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    className="min-h-9 w-20 rounded-md border border-line bg-canvas px-2.5 text-end tabular-nums aria-invalid:border-danger"
                  />
                  <span className="w-14 text-ink-muted">{unit}</span>
                </span>
              }
            >
              {isInvalid ? (
                <p id={`${name}-error`} className="text-sm text-danger">
                  Enter an interval of at least 5 seconds.
                </p>
              ) : undefined}
            </SettingsRow>
          );
        })}
      </SettingsSection>
    </SidebarPage>
  );
}
