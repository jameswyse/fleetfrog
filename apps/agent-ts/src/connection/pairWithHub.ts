import { Effect, Option, Schema } from "effect";

import { decodePairingString } from "@fleetfrog/protocol/pairing/pairingString";

import { writeAuditEntry } from "../audit/auditLog.ts";
import { ensureConfigWritable, saveAgentConfig } from "../config/agentConfig.ts";
import { readMachineInfo, suggestDiscoveryRoots } from "../machine/machineInfo.ts";
import { makePairingClient } from "./hubClient.ts";
import { fetchPinnedCertificate } from "./hubTls.ts";

export class PairingRefused extends Schema.TaggedError<PairingRefused>()("PairingRefused", {
  message: Schema.String,
}) {}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Redeems a pairing string with the hub and saves the resulting credentials. */
export const pairWithHub = Effect.fn("pairWithHub")(function* (options: {
  readonly pairingString: string;
  /** Allows an unencrypted connection to a hub that is not on this machine. */
  readonly insecure: boolean;
}) {
  const invite = decodePairingString(options.pairingString);

  if (Option.isNone(invite)) {
    return yield* new PairingRefused({
      message: "That is not a FleetFrog pairing string. Copy it again from the dashboard.",
    });
  }

  const { agentUrl, code, certificateFingerprint } = invite.value;
  const url = URL.canParse(agentUrl) ? new URL(agentUrl) : null;

  if (url === null || (url.protocol !== "ws:" && url.protocol !== "wss:")) {
    return yield* new PairingRefused({
      message: `The pairing string points at "${agentUrl}", which is not a WebSocket address. Check FLEETFROG_AGENT_URL on the hub.`,
    });
  }

  if (url.protocol === "ws:" && !loopbackHosts.has(url.hostname) && !options.insecure) {
    return yield* new PairingRefused({
      message: `The hub at ${url.host} does not use TLS. Pass --insecure only if the network path is already encrypted, such as over Tailscale.`,
    });
  }

  const certificatePem =
    certificateFingerprint === null || url.protocol === "ws:"
      ? null
      : yield* fetchPinnedCertificate({ url, fingerprint: certificateFingerprint });

  // The code is spent on first use, so confirm the token can be saved before redeeming it.
  yield* ensureConfigWritable;

  const client = yield* makePairingClient({ agentUrl: url, certificatePem });

  const paired = yield* client.Pair({
    code,
    info: yield* readMachineInfo,
    suggestedRoots: suggestDiscoveryRoots(),
  });

  yield* saveAgentConfig({
    agentUrl,
    machineId: paired.machineId,
    token: paired.token,
    certificatePem,
  });
  yield* writeAuditEntry({ event: "Paired", agentUrl, machineId: paired.machineId });

  return paired.machineId;
});
