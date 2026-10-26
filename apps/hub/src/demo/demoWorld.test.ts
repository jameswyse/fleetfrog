import { describe, expect, it } from "@effect/vitest";
import { DateTime } from "effect";

import { demoMachines, demoRepositories } from "./demoFleetData.ts";
import { buildWorld, renderCheckouts } from "./demoWorld.ts";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";

const now = DateTime.makeUnsafe("2026-10-20T00:00:00Z");

function listedWorktrees(checkout: Checkout): ReadonlyArray<string> {
  if (checkout.status._tag !== "Read") {
    throw new Error(`The demo couldn't read ${checkout.path}.`);
  }

  return checkout.status.git.worktrees.map(({ path }) => path);
}

function checkoutAt({
  checkouts,
  path,
}: {
  readonly checkouts: ReadonlyArray<Checkout>;
  readonly path: string;
}): Checkout {
  const found = checkouts.find((checkout) => checkout.path === path);

  if (found === undefined) {
    throw new Error(`The demo has no checkout at ${path}.`);
  }

  return found;
}

describe("renderCheckouts", () => {
  it("lists linked worktrees only from their main checkout, as the agents do", () => {
    const world = buildWorld({ machines: demoMachines, repositories: demoRepositories, now });

    const linked = world.machines.flatMap((machine) => {
      const checkouts = renderCheckouts(machine, now);

      return checkouts.flatMap((checkout) =>
        checkout.worktree._tag === "Linked"
          ? [{ checkout, main: checkoutAt({ checkouts, path: checkout.worktree.mainPath }) }]
          : [],
      );
    });

    expect(linked.length).toBeGreaterThan(0);

    for (const { checkout, main } of linked) {
      expect(listedWorktrees(checkout)).toStrictEqual([]);
      expect(listedWorktrees(main)).toContain(checkout.path);
    }
  });
});
