import { createHash, randomBytes } from "node:crypto";

import { Context, DateTime, Duration, Effect, Layer } from "effect";

import { PairingOffer } from "@fleetfrog/protocol/dashboard/rpcs";
import { InvalidPairingCode } from "@fleetfrog/protocol/pairing/rpcs";

import { HubConfig } from "../hubConfig.ts";
import { AgentCertificate } from "./agentCertificate.ts";

const offerLifetime = Duration.minutes(10);

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Single-use pairing codes, held in memory so a hub restart invalidates them. */
export class PairingOffers extends Context.Service<
  PairingOffers,
  {
    readonly create: Effect.Effect<PairingOffer>;
    readonly redeem: (code: string) => Effect.Effect<void, InvalidPairingCode>;
  }
>()("fleetfrog/PairingOffers") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const config = yield* HubConfig;
      const { tls } = yield* AgentCertificate;
      const expiries = new Map<string, DateTime.Utc>();
      const endpoint: PairingOffer["endpoint"] =
        config.agentUrl === null
          ? PairingOffer.fields.endpoint.cases.DashboardHost.make({
              scheme: tls === null ? "ws" : "wss",
              port: config.agentPort,
            })
          : PairingOffer.fields.endpoint.cases.Url.make({ url: config.agentUrl });

      return {
        create: Effect.gen(function* () {
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
            certificateFingerprint: tls?.fingerprint ?? null,
            endpoint,
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
