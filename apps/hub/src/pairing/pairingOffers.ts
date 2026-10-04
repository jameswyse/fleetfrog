import { createHash, randomBytes } from "node:crypto";

import { Context, DateTime, Duration, Effect, Layer } from "effect";

import { AgentEndpoint } from "@fleetfrog/protocol/dashboard/rpcs";
import { pairingCodeLifetimeMinutes } from "@fleetfrog/protocol/pairing/pairingString";
import { InvalidPairingCode } from "@fleetfrog/protocol/pairing/rpcs";

import { HubConfig } from "../hubConfig.ts";
import { AgentCertificate } from "./agentCertificate.ts";
import { readTailnetAgentUrl } from "./tailscaleServe.ts";

import type { PairingOffer, TailscaleServeUnavailable } from "@fleetfrog/protocol/dashboard/rpcs";

const offerLifetime = Duration.minutes(pairingCodeLifetimeMinutes);

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Single-use pairing codes, held in memory so a hub restart invalidates them. */
export class PairingOffers extends Context.Service<
  PairingOffers,
  {
    readonly create: Effect.Effect<PairingOffer, TailscaleServeUnavailable>;
    readonly redeem: (code: string) => Effect.Effect<void, InvalidPairingCode>;
  }
>()("fleetfrog/PairingOffers") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const config = yield* HubConfig;
      const { tls } = yield* AgentCertificate;
      const expiries = new Map<string, DateTime.Utc>();

      const endpoint = Effect.gen(function* () {
        if (config.agentUrl !== null) {
          return AgentEndpoint.cases.Url.make({ url: config.agentUrl });
        }

        // Read for each offer, because the address changes when the tailnet machine is renamed.
        if (config.tailscaleSocket !== null) {
          const url = yield* readTailnetAgentUrl(config.tailscaleSocket, config.agentPort);

          return AgentEndpoint.cases.Tailnet.make({ url });
        }

        return AgentEndpoint.cases.DashboardHost.make({
          scheme: tls === null ? "ws" : "wss",
          port: config.agentPort,
        });
      });

      return {
        create: Effect.gen(function* () {
          const offerEndpoint: AgentEndpoint = yield* endpoint;
          const now = yield* DateTime.now;
          const code = randomBytes(16).toString("base64url");
          const expiresAt = DateTime.addDuration(now, offerLifetime);

          for (const [hash, expiry] of expiries) {
            if (DateTime.isLessThan(expiry, now)) {
              expiries.delete(hash);
            }
          }

          expiries.set(hashCode(code), expiresAt);

          return {
            code,
            // Agents on the tailnet see Tailscale's certificate, never the hub's own.
            certificateFingerprint:
              offerEndpoint._tag === "Tailnet" ? null : (tls?.fingerprint ?? null),
            endpoint: offerEndpoint,
            expiresAt,
          };
        }),
        redeem: (code) =>
          DateTime.now.pipe(
            Effect.flatMap((now) => {
              const hash = hashCode(code);
              const expiry = expiries.get(hash);

              expiries.delete(hash);

              return expiry === undefined || DateTime.isLessThan(expiry, now)
                ? Effect.fail(new InvalidPairingCode())
                : Effect.void;
            }),
          ),
      };
    }),
  );
}
