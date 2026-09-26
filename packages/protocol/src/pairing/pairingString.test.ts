import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { decodePairingString, encodePairingString } from "./pairingString.ts";

import type { PairingInvite } from "./pairingString.ts";

const invite: PairingInvite = {
  agentUrl: "wss://192.168.1.10:7421",
  code: "c0de",
  certificateFingerprint: "AB:CD:EF",
};

describe("pairing strings", () => {
  it("round-trips an invite through a single copyable token", () => {
    const encoded = encodePairingString(invite);

    expect(encoded).toMatch(/^ffp1_[\w-]+$/);
    expect(decodePairingString(`  ${encoded}\n`)).toEqual(Option.some(invite));
  });

  it("rejects strings without the version prefix or with a damaged payload", () => {
    const encoded = encodePairingString(invite);

    expect(decodePairingString(encoded.slice("ffp1_".length))).toEqual(Option.none());
    expect(decodePairingString(encoded.slice(0, -4))).toEqual(Option.none());
  });
});
