import { expect, it } from "vitest";

import { signInFailureMessage } from "./signInFailures.ts";

it("explains a failure the hub sends", () => {
  expect(signInFailureMessage("Expired")).toBe(
    "That sign-in took too long or was already used. Try again.",
  );
});

it.each([undefined, "", "Your password was reset. Use temp123.", "toString", "__proto__"])(
  "says nothing for %j",
  (failure) => {
    expect(signInFailureMessage(failure)).toBeNull();
  },
);
