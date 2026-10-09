import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import { pairingCodeLifetimeMinutes } from "@fleetfrog/protocol/pairing/pairingString";

import { HubConfig } from "../hubConfig.ts";
import { AgentCertificate } from "./agentCertificate.ts";
import { PairingOffers } from "./pairingOffers.ts";

const TestOffers = PairingOffers.layer.pipe(
  Layer.provide([
    Layer.succeed(HubConfig)({
      dataDirectory: "unused",
      host: null,
      dashboardPort: 7420,
      agentPort: 7421,
      agentTls: "self-signed",
      agentUrl: null,
      tailscaleSocket: null,
      dashboardSocket: null,
      webRoot: null,
      authModeOverride: null,
      demo: false,
    }),
    Layer.succeed(AgentCertificate)({
      tls: { certificatePem: "unused", privateKeyPem: "unused", fingerprint: "AB:CD" },
    }),
  ]),
);

describe("PairingOffers", () => {
  it.effect("accepts a code once", () =>
    Effect.gen(function* () {
      const offers = yield* PairingOffers;
      const { code, certificateFingerprint } = yield* offers.create;

      expect(certificateFingerprint).toBe("AB:CD");
      yield* offers.redeem(code);
      expect((yield* offers.redeem(code).pipe(Effect.flip))._tag).toBe("InvalidPairingCode");
    }).pipe(Effect.provide(TestOffers)),
  );

  it.effect("rejects a code after it expires", () =>
    Effect.gen(function* () {
      const offers = yield* PairingOffers;
      const { code } = yield* offers.create;

      yield* TestClock.adjust(Duration.minutes(pairingCodeLifetimeMinutes + 1));
      expect((yield* offers.redeem(code).pipe(Effect.flip))._tag).toBe("InvalidPairingCode");
    }).pipe(Effect.provide(TestOffers)),
  );

  it.effect("rejects codes it never issued", () =>
    Effect.gen(function* () {
      const offers = yield* PairingOffers;

      expect((yield* offers.redeem("guessed").pipe(Effect.flip))._tag).toBe("InvalidPairingCode");
    }).pipe(Effect.provide(TestOffers)),
  );
});
