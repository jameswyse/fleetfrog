import { expect, it } from "@effect/vitest";

import { ActionKind } from "./action.ts";
import { mayRun } from "./user.ts";

it("lets users run only git-tier actions, and admins run everything", () => {
  const forUsers = ActionKind.literals.filter((kind) => mayRun("user", kind));

  expect(forUsers).toEqual(["Fetch", "Pull", "Clone", "Switch", "Stash"]);
  expect(ActionKind.literals.every((kind) => mayRun("admin", kind))).toBe(true);
});
