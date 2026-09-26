import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { MachineKindIcon, machineKindLabels } from "@/ui/MachineKindIcon.tsx";
import { Menu, MenuItem } from "@/ui/Menu.tsx";
import { machineKind } from "@fleetfrog/protocol/domain/fleet";
import { MachineKind } from "@fleetfrog/protocol/domain/machine";

import type { Machine } from "@fleetfrog/protocol/domain/fleet";

/**
 * Chooses the machine's kind, which picks its icon. The detected kind is marked, and choosing it
 * hands the choice back to detection.
 */
export function MachineKindPicker({
  machine,
  onChange,
}: {
  readonly machine: Machine;
  /** Null to follow what the agent detects. */
  readonly onChange: (kind: MachineKind | null) => void;
}) {
  const current = machineKind(machine);
  const detected = machine.info.system?.kind ?? null;

  return (
    <Menu
      label={`Icon: ${machineKindLabels[current]}`}
      trigger={{
        className:
          "inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-canvas px-3 text-sm hover:bg-surface-raised",
        content: (
          <>
            <MachineKindIcon kind={current} className="size-4 text-ink-muted" />
            {machineKindLabels[current]}
            <ChevronDownIcon className="size-4 text-ink-muted" />
          </>
        ),
      }}
    >
      {(close) =>
        MachineKind.literals.map((kind) => (
          <MenuItem
            key={kind}
            aria-pressed={kind === current}
            onClick={() => {
              close();
              onChange(kind === detected ? null : kind);
            }}
          >
            <span className="flex items-center gap-3">
              <MachineKindIcon kind={kind} className="size-4 text-ink-muted" />
              <span className="flex-1">{machineKindLabels[kind]}</span>
              {kind === detected && <span className="text-xs text-ink-muted">detected</span>}
              <span className="grid size-4 place-items-center">
                {kind === current && <CheckIcon className="size-4" />}
              </span>
            </span>
          </MenuItem>
        ))
      }
    </Menu>
  );
}
