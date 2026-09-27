import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";

import { AdvertisedCapabilities } from "./action.ts";

import type { ActionKind, ActionOutcome, ActionRequest, OutcomeKind } from "./action.ts";
import type { RunCounts } from "./activity.ts";

describe("action kinds", () => {
  it("keeps each list of kinds in step with the union it names", () => {
    expectTypeOf<(typeof OutcomeKind)["Type"]>().toEqualTypeOf<ActionOutcome["_tag"]>();
    expectTypeOf<(typeof ActionKind)["Type"]>().toEqualTypeOf<ActionRequest["_tag"]>();
    expectTypeOf<keyof RunCounts>().toEqualTypeOf<"Queued" | "Running" | OutcomeKind>();
  });
});

describe("agent capabilities", () => {
  it("accepts a newer agent, ignoring the actions and tiers it adds", () => {
    const decode = Schema.decodeUnknownSync(AdvertisedCapabilities);

    expect(
      decode({
        actions: ["Fetch", "Teleport"],
        allowedTiers: ["git", "machine"],
        policyReadable: true,
        createsFolders: true,
      }),
    ).toEqual({
      actions: ["Fetch"],
      allowedTiers: ["git"],
      policyReadable: true,
      createsFolders: true,
    });
  });
});
