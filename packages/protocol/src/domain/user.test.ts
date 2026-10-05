import { expect, it } from "@effect/vitest";

import { ActionKind, actionTiers } from "./action.ts";
import { batchTier } from "./activity.ts";
import { MachineId } from "./machine.ts";
import { mayRun } from "./user.ts";

it("lets users run only git-tier actions, and admins run everything", () => {
  const forUsers = ActionKind.literals.filter((kind) => mayRun("user", actionTiers[kind]));

  expect(forUsers).toEqual(["Fetch", "Pull", "Clone", "Switch", "Stash"]);
  expect(ActionKind.literals.every((kind) => mayRun("admin", actionTiers[kind]))).toBe(true);
});

it("treats a branch switch that discards changes as a cleanup action", () => {
  const machineId = MachineId.make("5b0c7a1e-7a0e-4f3e-9d63-2f8f7a8d0a01");

  const switching = (discardChanges: boolean) =>
    batchTier({
      _tag: "Targeted",
      runs: [
        {
          machineId,
          request: {
            _tag: "Switch",
            path: "/p",
            branch: "main",
            stashChanges: true,
            discardChanges,
          },
        },
      ],
    });

  expect(mayRun("user", switching(false))).toBe(true);
  expect(mayRun("user", switching(true))).toBe(false);
});
