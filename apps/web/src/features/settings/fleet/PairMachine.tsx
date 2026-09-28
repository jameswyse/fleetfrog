import { useActionState, useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import { DateTime } from "effect";

import { knownFleet, requestHub, useHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { RelativeTime, useNow } from "@/ui/RelativeTime.tsx";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";
import { encodePairingString } from "@fleetfrog/protocol/pairing/pairingString";

import { SettingsSection } from "../SettingsSection.tsx";

import type { PairingOffer } from "@fleetfrog/protocol/dashboard/rpcs";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Browsers only expose the clipboard API on HTTPS or localhost, and the dashboard is often served
// over plain HTTP on a LAN address.
const clipboardAvailable = window.isSecureContext && "clipboard" in navigator;

const installCommand =
  "curl -fsSL https://github.com/jameswyse/fleetfrog/releases/latest/download/install.sh | sh";

function agentUrl(offer: PairingOffer): string {
  return offer.endpoint._tag === "DashboardHost"
    ? `${offer.endpoint.scheme}://${window.location.hostname}:${offer.endpoint.port}`
    : offer.endpoint.url;
}

type OfferState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Ready"; readonly offer: PairingOffer; readonly command: string }
  | { readonly _tag: "Failed"; readonly message: string };

/** The outcome of copying one command. A new code makes an older outcome irrelevant. */
type CopyOutcome =
  | { readonly _tag: "Copied"; readonly command: string }
  | { readonly _tag: "Failed"; readonly command: string };

function CommandBox({ command }: { readonly command: string }) {
  return (
    <div className="rounded-md border border-line bg-canvas p-3">
      <code className="block font-mono text-xs break-all select-all">{command}</code>
    </div>
  );
}

function CopyFailed() {
  return (
    <p role="alert" className="text-danger">
      Couldn't copy the command. Select it and copy it yourself.
    </p>
  );
}

/** Creates a one-time pairing code and watches for the new machine to connect. */
export function PairMachine() {
  const navigate = useNavigate();
  const hub = useHub();
  const now = useNow();
  const fleet = knownFleet(hub);
  // The machines paired before this page opened. Opened directly, the page renders before the
  // fleet arrives, so they come from the first fleet it sees rather than an empty list.
  const [knownMachines, setKnownMachines] = useState<ReadonlySet<string> | null>(() =>
    fleet === null ? null : new Set(fleet.machines.map(({ id }) => id)),
  );

  if (knownMachines === null && fleet !== null) {
    setKnownMachines(new Set(fleet.machines.map(({ id }) => id)));
  }

  const [copyOutcome, setCopyOutcome] = useState<CopyOutcome | null>(null);
  const [state, createOffer, creating] = useActionState(
    async (): Promise<OfferState> => {
      const result = await requestHub((client) => client.CreatePairingOffer());

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
    knownMachines === null ? undefined : fleet?.machines.find(({ id }) => !knownMachines.has(id));
  const offer = state._tag === "Ready" ? state : null;
  const expired = offer !== null && DateTime.toEpochMillis(offer.offer.expiresAt) <= now;

  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command).then(
      () => setCopyOutcome({ _tag: "Copied", command }),
      () => setCopyOutcome({ _tag: "Failed", command }),
    );
  };

  const copied = (command: string) =>
    copyOutcome?._tag === "Copied" && copyOutcome.command === command;
  const copyFailed = (command: string) =>
    copyOutcome?._tag === "Failed" && copyOutcome.command === command;

  return (
    <SidebarPage title="Pair a machine" parents={[{ label: "Fleet", to: "/settings/fleet" }]}>
      <SettingsSection title="New machine">
        <div className="space-y-4 px-5 py-5 text-sm">
          {paired === undefined && (
            <>
              <p>Install the FleetFrog agent on the machine you want to add:</p>
              <CommandBox command={installCommand} />
              {clipboardAvailable && (
                <Button onClick={() => copyCommand(installCommand)}>
                  {copied(installCommand) ? "Copied" : "Copy install command"}
                </Button>
              )}
              {copyFailed(installCommand) && <CopyFailed />}
              <p>
                Then create a pairing code and run the command it shows on that machine. The code
                works once and expires after 10 minutes.
              </p>
              {!clipboardAvailable && (
                <p className="text-ink-muted">Select a command to copy it.</p>
              )}
              {offer === null && (
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
              {offer !== null && (
                <>
                  {!expired && <CommandBox command={offer.command} />}
                  <div className="flex flex-wrap items-center gap-3">
                    {!expired && clipboardAvailable && (
                      <Button tone="primary" onClick={() => copyCommand(offer.command)}>
                        {copied(offer.command) ? "Copied" : "Copy pairing command"}
                      </Button>
                    )}
                    <form action={createOffer}>
                      <Button
                        type="submit"
                        tone={expired ? "primary" : "secondary"}
                        disabled={creating}
                      >
                        New code
                      </Button>
                    </form>
                    <span className="text-ink-muted">
                      {expired ? (
                        "Expired"
                      ) : (
                        <>
                          Expires <RelativeTime at={offer.offer.expiresAt} />
                        </>
                      )}
                    </span>
                  </div>
                  {copyFailed(offer.command) && <CopyFailed />}
                  {offer.offer.endpoint._tag === "Tailnet" && (
                    <p className="text-ink-muted">
                      The machine connects to the hub over Tailscale, so sign it in to the same
                      tailnet before you run the command.
                    </p>
                  )}
                  {offer.offer.endpoint._tag === "DashboardHost" &&
                    loopbackHosts.has(window.location.hostname) && (
                      <p className="rounded-md border border-changes/30 bg-changes-soft p-3 text-changes">
                        This command points at localhost, so it only works on the hub's own
                        computer. To pair another machine, open the dashboard at the hub's network
                        address first.
                      </p>
                    )}
                </>
              )}
            </>
          )}
          <p role="status" className={paired === undefined ? "text-ink-muted" : undefined}>
            {paired !== undefined && (
              <>
                <span className="font-semibold">{machineLabel(paired)}</span> is paired. Its
                repositories appear on the Projects page after its first scan.
              </>
            )}
            {paired === undefined &&
              offer !== null &&
              !expired &&
              "Waiting for the machine to pair…"}
            {paired === undefined && expired && "This code has expired. Create a new code to pair."}
          </p>
          {paired !== undefined && (
            // Pairing replaces the controls that had focus, so focus moves to the only next step.
            <Button
              tone="primary"
              autoFocus
              onClick={() => {
                void navigate({
                  to: "/settings/fleet/$machineId",
                  params: { machineId: paired.id },
                });
              }}
            >
              Open {machineLabel(paired)}
            </Button>
          )}
        </div>
      </SettingsSection>
    </SidebarPage>
  );
}
