import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { temporaryDirectory } from "../testing/temporaryDirectory.ts";
import { discoverCheckouts } from "./discoverCheckouts.ts";

// Keeps the developer's global Git configuration, such as commit signing, out of the fixture.
const gitEnvironment = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };

function createRepository(directory: string): void {
  mkdirSync(directory, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", directory], { env: gitEnvironment });
  writeFileSync(path.join(directory, "readme.md"), `${directory}\n`);
  execFileSync("git", ["-C", directory, "add", "."], { env: gitEnvironment });
  execFileSync(
    "git",
    [
      "-C",
      directory,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-q",
      "-m",
      "Init",
    ],
    { env: gitEnvironment },
  );
}

describe("discoverCheckouts", () => {
  it.effect(
    "finds repositories under the roots and their worktrees elsewhere, skipping hidden and dependency folders",
    () =>
      Effect.gen(function* () {
        const home = yield* temporaryDirectory("fleetfrog-discovery-");
        const projects = path.join(home, "Projects");
        const shop = path.join(projects, "acme", "shop");
        const outsideWorktree = path.join(home, "worktrees", "shop-feature");

        createRepository(shop);
        createRepository(path.join(shop, "vendor", "nested"));
        createRepository(path.join(projects, "tools", "node_modules", "dependency"));
        createRepository(path.join(projects, ".cache", "hidden"));
        createRepository(path.join(projects, "a", "b", "c", "d", "e", "too-deep"));
        execFileSync(
          "git",
          ["-C", shop, "worktree", "add", "-q", "-b", "feature", outsideWorktree],
          { env: gitEnvironment },
        );

        const found = yield* discoverCheckouts([projects, path.join(home, "missing")]);

        expect(found.map(({ path: checkoutPath }) => checkoutPath).toSorted()).toEqual(
          [shop, outsideWorktree].toSorted(),
        );
      }),
  );
});
