import { ChevronDownIcon } from "lucide-react";

import { PersonalText, useMaskPersonal } from "../preferences/PersonalText.tsx";

import type { Machine } from "@fleetfrog/protocol/domain/fleet";

import type { DestinationDraft } from "./cloneDestinationDraft.ts";

const pathText = "font-mono text-[13px]";

/**
 * Where a clone goes, drawn as one path: the project folder as a chip at the start, chosen from the
 * machine's folders when it has more than one, then the new folder's name, typed in place.
 */
export function CloneDestinationField({
  id,
  label,
  machine,
  value,
  invalid,
  describedBy,
  onChange,
}: {
  /** The name input's id, for focusing it when the destination has a problem. */
  readonly id: string;
  readonly label: string;
  readonly machine: Machine;
  readonly value: DestinationDraft;
  readonly invalid: boolean;
  readonly describedBy: string;
  readonly onChange: (next: DestinationDraft) => void;
}) {
  const roots = machine.discoveryRoots;
  const mask = useMaskPersonal();

  return (
    // A fieldset won't shrink below its contents unless told to.
    <fieldset className="min-w-0">
      <legend className="text-ink-muted">{label}</legend>
      <div
        className={`mt-1 flex min-h-9 items-center rounded-md border bg-canvas ps-1 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent ${invalid ? "border-danger" : "border-line"}`}
      >
        {roots.length > 1 ? (
          // A long folder path gives way before the name does.
          <span className="relative flex max-w-[60%] min-w-0 shrink-0">
            <select
              aria-label="Project folder"
              aria-describedby={describedBy}
              value={value.root}
              onChange={(event) => onChange({ ...value, root: event.currentTarget.value })}
              className={`max-w-full appearance-none truncate rounded bg-chip py-0.5 ps-1.5 pe-5 text-ink ${pathText} outline-hidden field-sizing-content hover:bg-chip-hover focus-visible:ring-2 focus-visible:ring-accent`}
            >
              {roots.map((root) => (
                <option key={root.path} value={root.path}>
                  {mask(root.path)}
                  {root.status === "Missing" || root.status === "NotFolder"
                    ? " (doesn't exist)"
                    : ""}
                </option>
              ))}
            </select>
            <ChevronDownIcon
              aria-hidden="true"
              className="pointer-events-none absolute end-1 top-1/2 size-3.5 -translate-y-1/2 text-ink"
            />
          </span>
        ) : (
          <span
            title={mask(value.root)}
            className={`max-w-[60%] shrink-0 truncate rounded bg-chip px-1.5 py-0.5 text-ink ${pathText}`}
          >
            <PersonalText>{value.root}</PersonalText>
          </span>
        )}
        <span aria-hidden="true" className={`px-0.5 text-ink-muted ${pathText}`}>
          /
        </span>
        <input
          id={id}
          aria-label={`New folder inside ${value.root}`}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.currentTarget.value })}
          autoComplete="off"
          spellCheck={false}
          className={`min-w-0 flex-1 bg-transparent py-1.5 pe-2.5 ${pathText} outline-hidden`}
        />
      </div>
    </fieldset>
  );
}
