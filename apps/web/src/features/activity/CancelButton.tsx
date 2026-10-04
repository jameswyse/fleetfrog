import { useTransition } from "react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";

import type { CancelTarget } from "@fleetfrog/protocol/dashboard/rpcs";

export function CancelButton({
  target,
  label,
  subject,
}: {
  readonly target: CancelTarget;
  readonly label: string;
  readonly subject?: string;
}) {
  const [cancelling, startCancel] = useTransition();
  const text = cancelling ? "Cancelling…" : label;

  return (
    <Button
      tone="quiet"
      disabled={cancelling}
      aria-label={subject === undefined ? undefined : `${text} ${subject}`}
      onClick={() =>
        startCancel(async () => {
          await requestHub((client) => client.Cancel({ target }));
        })
      }
    >
      {text}
    </Button>
  );
}
