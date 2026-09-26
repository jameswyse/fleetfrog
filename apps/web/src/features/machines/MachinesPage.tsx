import { useNavigate, useSearch } from "@tanstack/react-router";

import { useHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";

import { MachineCard } from "./MachineCard.tsx";
import { PairMachineDialog } from "./PairMachineDialog.tsx";

export function MachinesPage() {
  const hub = useHub();
  const { pair = false } = useSearch({ from: "/machines" });
  const navigate = useNavigate({ from: "/machines" });
  const machines = hub._tag === "Connecting" || hub.fleet === null ? [] : hub.fleet.machines;

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Machines</h1>
          <p className="text-sm text-ink-muted">
            Each paired machine runs an agent that reports its repositories.
          </p>
        </div>
        <Button
          tone="primary"
          disabled={hub._tag !== "Live"}
          onClick={() => {
            void navigate({ search: { pair: true } });
          }}
        >
          Pair a machine
        </Button>
      </div>
      {machines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-5 py-12 text-center text-sm text-ink-muted">
          {hub._tag === "Live" ? "No machines are paired yet." : "Waiting for the hub…"}
        </p>
      ) : (
        <div className="space-y-5">
          {machines.map((machine) => (
            <MachineCard key={machine.id} machine={machine} />
          ))}
        </div>
      )}
      {pair && hub._tag === "Live" && (
        <PairMachineDialog
          onClose={() => {
            void navigate({ search: {} });
          }}
        />
      )}
    </div>
  );
}
