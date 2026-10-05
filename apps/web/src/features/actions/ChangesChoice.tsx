import { TriangleAlertIcon } from "lucide-react";

import { useMayRun } from "@/rpc/session.ts";

import { machineBlocker } from "./actionAvailability.ts";

import type { Machine } from "@fleetfrog/protocol/domain/fleet";

export type ChangesHandling = "Stash" | "Discard";

export function DiscardWarning() {
  return (
    <p className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2">
      <TriangleAlertIcon className="mt-0.5 shrink-0 text-danger" />
      <span>
        Discarded changes go to Cleanup → Trash. Until the Trash is emptied, you can restore them
        from there as a stash and apply it. After that, they're gone for good.
      </span>
    </p>
  );
}

export function ChangesChoice({
  machine,
  value,
  onChange,
  stash,
  discard,
  unavailable,
}: {
  readonly machine: Machine;
  readonly value: ChangesHandling;
  readonly onChange: (next: ChangesHandling) => void;
  readonly stash: string;
  readonly discard: string;
  readonly unavailable: string | null;
}) {
  const offered = useMayRun("Discard");
  const blocked = machineBlocker(machine, "Discard") ?? unavailable;

  if (!offered) {
    return <p>{stash}</p>;
  }

  const options = [
    { value: "Stash", label: "Stash them", detail: stash, disabled: false },
    {
      value: "Discard",
      label: "Discard them",
      detail: blocked === null ? discard : `Not available: ${blocked}.`,
      disabled: blocked !== null,
    },
  ] as const;

  return (
    <fieldset className="min-w-0 space-y-1.5">
      <legend className="mb-2 font-medium">What happens to the changes</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line px-3 py-2 has-checked:border-accent has-checked:bg-accent-soft has-disabled:cursor-not-allowed has-disabled:opacity-60"
        >
          <input
            type="radio"
            name="changes"
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
            className="mt-0.5 size-4 shrink-0 accent-accent"
          />
          <span className="grid gap-0.5">
            <span className="font-medium">{option.label}</span>
            <span className="text-ink-muted">{option.detail}</span>
          </span>
        </label>
      ))}
      {value === "Discard" && <DiscardWarning />}
    </fieldset>
  );
}
