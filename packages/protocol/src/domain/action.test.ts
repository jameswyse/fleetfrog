import { describe, expectTypeOf, it } from "@effect/vitest";

import type { ActionKind, ActionOutcome, ActionRequest, OutcomeKind } from "./action.ts";
import type { RunCounts } from "./activity.ts";

describe("action kinds", () => {
  it("keeps each list of kinds in step with the union it names", () => {
    expectTypeOf<(typeof OutcomeKind)["Type"]>().toEqualTypeOf<ActionOutcome["_tag"]>();
    expectTypeOf<(typeof ActionKind)["Type"]>().toEqualTypeOf<ActionRequest["_tag"]>();
    expectTypeOf<keyof RunCounts>().toEqualTypeOf<"Queued" | "Running" | OutcomeKind>();
  });
});
