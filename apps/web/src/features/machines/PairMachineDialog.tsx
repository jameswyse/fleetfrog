import { useActionState, useState } from "react";

import { requestHub, useHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { encodePairingString } from "@fleetfrog/protocol/pairing/pairingString";

import type { PairingOffer } from "@fleetfrog/protocol/dashboard/rpcs";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function agentUrl(offer: PairingOffer): string {
  return offer.endpoint._tag === "Url"
    ? offer.endpoint.url
    : `${offer.endpoint.scheme}://${window.location.hostname}:${offer.endpoint.port}`;
}

type OfferState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Ready"; readonly offer: PairingOffer; readonly command: string }
  | { readonly _tag: "Failed"; readonly message: string };

export function PairMachineDialog({ onClose }: { readonly onClose: () => void }) {
  const hub = useHub();
  const [knownMachines] = useState(
    () =>
      new Set(
        hub._tag === "Connecting" || hub.fleet === null
          ? []
          : hub.fleet.machines.map(({ id }) => id),
      ),
  );
  const [copied, setCopied] = useState(false);
  const [state, createOffer, creating] = useActionState(
    async (): Promise<OfferState> => {
      const result = await requestHub((client) => client.CreatePairingOffer());

      setCopied(false);

      if (result._tag === "Failure") {
        return { _tag: "Failed", message: result.message };
      }

      const invite = encodePairingString({
        agentUrl: agentUrl(result.value),
        code: result.value.code,
        certificateFingerprint: result.value.certificateFingerprint,
      });

      return { _tag: "Ready", offer: result.value, command: `fleetfrog pair ${invite}` };
    },
    { _tag: "Idle" },
  );
  const paired =
    hub._tag === "Live" ? hub.fleet.machines.find(({ id }) => !knownMachines.has(id)) : undefined;

  return (
    <Dialog title="Pair a machine" onClose={onClose}>
      {paired !== undefined ? (
        <div className="space-y-4">
          <p role="status" className="text-sm">
            <span className="font-semibold">{paired.info.prettyName ?? paired.info.hostname}</span>{" "}
            is paired. Its repositories appear on the overview after its first scan.
          </p>
          <Button tone="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <p>
            Install the FleetFrog agent on the machine you want to add, then run the command below
            there. The code works once and expires after 10 minutes.
          </p>
          {state._tag === "Ready" ? (
            <>
              <div className="rounded-md border border-line bg-canvas p-3">
                <code className="block font-mono text-xs break-all select-all">
                  {state.command}
                </code>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  tone="primary"
                  onClick={() => {
                    void navigator.clipboard.writeText(state.command).then(() => setCopied(true));
                  }}
                >
                  {copied ? "Copied" : "Copy command"}
                </Button>
                <form action={createOffer}>
                  <Button type="submit" disabled={creating}>
                    New code
                  </Button>
                </form>
                <span className="text-ink-muted">
                  Expires <RelativeTime at={state.offer.expiresAt} />
                </span>
              </div>
              {state.offer.endpoint._tag === "DashboardHost" &&
                loopbackHosts.has(window.location.hostname) && (
                  <p className="rounded-md border border-changes/30 bg-changes-soft p-3 text-changes">
                    This command points at localhost, so it only works on the hub's own computer. To
                    pair another machine, open the dashboard at the hub's network address first.
                  </p>
                )}
              <p className="text-ink-muted" aria-live="polite">
                Waiting for the machine to pair…
              </p>
            </>
          ) : (
            <form action={createOffer} className="space-y-3">
              {state._tag === "Failed" && (
                <p role="alert" className="text-danger">
                  {state.message}
                </p>
              )}
              <Button tone="primary" type="submit" disabled={creating}>
                {creating ? "Creating code…" : "Create pairing code"}
              </Button>
            </form>
          )}
        </div>
      )}
    </Dialog>
  );
}
