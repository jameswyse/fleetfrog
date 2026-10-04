import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";

import { BusyThreadsNotice } from "./T3CodeNotices.tsx";

import type { T3CodeThread } from "@fleetfrog/protocol/domain/t3Code";

export function BusyCheckoutDialog({
  title,
  threads,
  consequence,
  confirmLabel,
  pending,
  failure,
  onConfirm,
  onClose,
}: {
  readonly title: string;
  readonly threads: ReadonlyArray<T3CodeThread>;
  readonly consequence: string;
  readonly confirmLabel: string;
  readonly pending: boolean;
  readonly failure: string | null;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <BusyThreadsNotice threads={threads} where="in this checkout" consequence={consequence} />
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" disabled={pending} onClick={onConfirm}>
            {pending ? "Starting…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
