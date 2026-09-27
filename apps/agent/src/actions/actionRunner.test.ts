import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option } from "effect";

import { RunId } from "@fleetfrog/protocol/domain/activity";
import { nothingUnique, TrashId } from "@fleetfrog/protocol/domain/trash";

import { placeLocation } from "../discovery/discoverCheckouts.ts";
import { locateCheckout } from "../git/readCheckout.ts";
import { inspectCheckout } from "../inspect/inspectCheckout.ts";
import { temporaryDirectory } from "../testing/temporaryDirectory.ts";
import { listTrash } from "../trash/trashFolder.ts";
import { makeActionOutput } from "./actionOutput.ts";
import { makeActionRunner } from "./actionRunner.ts";
import { unarchiveCheckout } from "./archiveActions.ts";

import type { ActionRequest, ActionUpdate } from "@fleetfrog/protocol/domain/action";

import type { AuditEntry } from "../audit/auditLog.ts";
import type { AgentPolicy } from "../config/agentPolicy.ts";
import type { CheckoutLocation } from "../git/readCheckout.ts";

// The agent's own Git commands, such as the commit a stash makes, need an identity too.
process.env.GIT_AUTHOR_NAME = "Test";
process.env.GIT_AUTHOR_EMAIL = "test@example.com";
process.env.GIT_COMMITTER_NAME = "Test";
process.env.GIT_COMMITTER_EMAIL = "test@example.com";

function git(cwd: string, ...args: Array<string>): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();
}

/** A clone whose upstream has one commit it hasn't fetched yet. */
function createFixture(root: string) {
  const upstream = path.join(root, "upstream");
  const clone = path.join(root, "projects", "clone");

  git(root, "init", "-q", "-b", "main", upstream);
  writeFileSync(path.join(upstream, "readme.md"), "one\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-q", "-m", "First");
  git(root, "clone", "-q", upstream, clone);
  writeFileSync(path.join(upstream, "readme.md"), "two\n");
  git(upstream, "commit", "-q", "-am", "Second");

  return { root, upstream, clone };
}

const runIds = {
  first: RunId.make("00000000-0000-4000-8000-000000000001"),
  second: RunId.make("00000000-0000-4000-8000-000000000002"),
};

/** A runner over one checkout, recording what it reports and audits. */
const makeHarness = Effect.fn("makeHarness")(function* (options: {
  readonly location: CheckoutLocation;
  readonly roots: ReadonlyArray<string>;
  readonly archiveFolder: string | null;
  readonly trashDirectory: string;
  readonly policy: AgentPolicy;
}) {
  const updates = new Map<RunId, Array<ActionUpdate>>();
  const audit: Array<AuditEntry> = [];
  const tracked: Array<string> = [];
  /** For each rescan, whether it came before any run reported its outcome. */
  const rescannedBeforeFinishing: Array<boolean> = [];
  const signals = new Map<string, Deferred.Deferred<ActionUpdate>>();

  /** Resolves when the run first reports an update of this kind. */
  const signalFor = (runId: RunId, kind: "Started" | "Finished") => {
    const key = `${runId}:${kind}`;
    const existing = signals.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const created = Deferred.makeUnsafe<ActionUpdate>();

    signals.set(key, created);

    return created;
  };

  const runner = yield* makeActionRunner({
    catalogue: {
      locate: (checkoutPath) =>
        checkoutPath === options.location.path ? options.location : undefined,
      rescanRepository: () =>
        Effect.sync(() => {
          rescannedBeforeFinishing.push(
            [...updates.values()].every((sent) => sent.every(({ _tag }) => _tag !== "Finished")),
          );
        }),
      track: (trackedPath) => Effect.sync(() => tracked.push(trackedPath)),
      forget: () => Effect.void,
      reportTrash: Effect.void,
    },
    folders: () => ({ roots: options.roots, archiveFolder: options.archiveFolder }),
    trashDirectory: options.trashDirectory,
    loadPolicy: Effect.succeed(options.policy),
    report: (runId, update) =>
      Effect.sync(() => {
        updates.set(runId, [...(updates.get(runId) ?? []), update]);
      }).pipe(
        Effect.andThen(
          update._tag === "Started" || update._tag === "Finished"
            ? Deferred.succeed(signalFor(runId, update._tag), update)
            : Effect.void,
        ),
      ),
    audit: (entry) => Effect.sync(() => audit.push(entry)),
  });

  return {
    runner,
    audit,
    tracked,
    rescannedBeforeFinishing,
    updates: (runId: RunId) => (updates.get(runId) ?? []).map(({ _tag }) => _tag),
    /** Starts an action and waits for its outcome. */
    run: (request: ActionRequest, runId: RunId = runIds.first) =>
      runner.run(runId, request).pipe(Effect.andThen(Deferred.await(signalFor(runId, "Finished")))),
    started: (runId: RunId) => Deferred.await(signalFor(runId, "Started")),
    outcome: (runId: RunId) => Deferred.await(signalFor(runId, "Finished")),
  };
});

const setUp = (
  policy: AgentPolicy = { allowedTiers: ["git"] },
  archiveFolder: string | null = null,
) =>
  Effect.gen(function* () {
    const fixture = createFixture(yield* temporaryDirectory("fleetfrog-actions-"));
    const location = yield* locateCheckout(fixture.clone);

    if (Option.isNone(location)) {
      return yield* Effect.die(new Error("The fixture clone is not a checkout."));
    }

    const harness = yield* makeHarness({
      location: location.value,
      roots: [path.join(fixture.root, "projects")],
      archiveFolder: archiveFolder === null ? null : path.join(fixture.root, archiveFolder),
      trashDirectory: path.join(fixture.root, "trash"),
      policy,
    });

    return { ...fixture, ...harness };
  });

describe("action runner", () => {
  it.effect("pulls by fetching and fast-forwarding a clean checkout", () =>
    Effect.gen(function* () {
      const { run, updates, audit, rescannedBeforeFinishing, clone, upstream } = yield* setUp();

      expect(yield* run({ _tag: "Pull", path: clone })).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "FastForwarded", commits: 1 } },
      });
      expect(git(clone, "rev-parse", "HEAD")).toBe(git(upstream, "rev-parse", "HEAD"));
      expect(updates(runIds.first).at(0)).toBe("Started");
      expect(audit.map(({ event }) => event)).toEqual(["ActionStarted", "ActionFinished"]);
      // The hub hears the outcome after the checkout's new state, never before it.
      expect(rescannedBeforeFinishing).toEqual([true]);
    }),
  );

  it.effect("skips a pull when tracked files have changed, leaving the checkout alone", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp();
      const before = git(clone, "rev-parse", "HEAD");

      writeFileSync(path.join(clone, "readme.md"), "edited\n");

      expect(yield* run({ _tag: "Pull", path: clone })).toMatchObject({
        outcome: { _tag: "Skipped", reason: { _tag: "UncommittedChanges", files: 1 } },
      });
      expect(git(clone, "rev-parse", "HEAD")).toBe(before);
    }),
  );

  it.effect("refuses actions in a tier the owner has denied, before touching anything", () =>
    Effect.gen(function* () {
      const { run, updates, audit, clone } = yield* setUp({ allowedTiers: [] });

      expect(yield* run({ _tag: "Fetch", path: clone })).toMatchObject({
        outcome: { _tag: "Skipped", reason: { _tag: "NotAllowed", tier: "git" } },
      });
      expect(updates(runIds.first)).toEqual(["Finished"]);
      expect(audit.map(({ event }) => event)).toEqual(["ActionRefused"]);
      expect(existsSync(path.join(clone, ".git", "FETCH_HEAD"))).toBe(false);
    }),
  );

  it.effect("reports a cancelled action waiting behind another on the same repository", () =>
    Effect.gen(function* () {
      const { runner, run, started, outcome, updates, clone } = yield* setUp();
      const first = yield* Effect.forkChild(run({ _tag: "Pull", path: clone }));

      // The first action holds the repository, so the second can only queue behind it.
      yield* started(runIds.first);
      yield* runner.run(runIds.second, { _tag: "Fetch", path: clone });
      yield* runner.cancel(runIds.second);

      expect(yield* outcome(runIds.second)).toMatchObject({ outcome: { _tag: "Cancelled" } });
      expect(updates(runIds.second)).toEqual(["Finished"]);
      expect(yield* Fiber.await(first)).toMatchObject({
        _tag: "Success",
        value: { outcome: { _tag: "Succeeded" } },
      });
    }),
  );

  it.effect("won't clone through a symbolic link that leads out of the discovery folders", () =>
    Effect.gen(function* () {
      const { run, root } = yield* setUp();
      const outside = path.join(root, "outside");

      mkdirSync(outside);
      symlinkSync(outside, path.join(root, "projects", "link"));

      expect(
        yield* run({
          _tag: "Clone",
          url: "https://github.com/acme/shop.git",
          destination: path.join(root, "projects", "link", "shop"),
        }),
      ).toMatchObject({
        outcome: {
          _tag: "Failed",
          message: "The destination must be inside one of this machine's project folders.",
        },
      });
      expect(existsSync(path.join(outside, "shop"))).toBe(false);
    }),
  );

  it.effect("never adds a refused clone's destination to the known checkouts", () =>
    Effect.gen(function* () {
      const { run, tracked, root } = yield* setUp();
      const hidden = path.join(root, "projects", ".dotfiles");

      git(root, "init", "-q", hidden);

      expect(
        yield* run({ _tag: "Clone", url: "https://github.com/acme/shop.git", destination: hidden }),
      ).toMatchObject({ outcome: { _tag: "Failed" } });
      expect(tracked).toEqual([]);
    }),
  );

  it.effect("won't clone a URL that carries credentials or isn't HTTPS or SSH", () =>
    Effect.gen(function* () {
      const { run, root } = yield* setUp();

      for (const url of ["https://user:token@github.com/acme/shop.git", "file:///srv/shop.git"]) {
        expect(
          yield* run({
            _tag: "Clone",
            url,
            destination: path.join(root, "projects", "shop"),
          }),
        ).toMatchObject({ outcome: { _tag: "Failed" } });
      }

      expect(existsSync(path.join(root, "projects", "shop"))).toBe(false);
    }),
  );

  it.effect("switches a clean checkout to another local branch", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp();

      git(clone, "branch", "feature");
      writeFileSync(path.join(clone, "notes.txt"), "untracked\n");

      expect(yield* run({ _tag: "Switch", path: clone, branch: "feature" })).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "Switched", branch: "feature" } },
      });
      expect(git(clone, "branch", "--show-current")).toBe("feature");
    }),
  );

  it.effect("won't switch while tracked files have changes", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp();

      git(clone, "branch", "feature");
      writeFileSync(path.join(clone, "readme.md"), "edited\n");

      expect(yield* run({ _tag: "Switch", path: clone, branch: "feature" })).toMatchObject({
        outcome: { _tag: "Skipped", reason: { _tag: "UncommittedChanges", files: 1 } },
      });
      expect(git(clone, "branch", "--show-current")).toBe("main");
    }),
  );

  it.effect("won't switch to a branch another worktree has checked out", () =>
    Effect.gen(function* () {
      const { run, clone, root } = yield* setUp();

      git(clone, "worktree", "add", "-q", "-b", "feature", path.join(root, "feature"));

      expect(yield* run({ _tag: "Switch", path: clone, branch: "feature" })).toMatchObject({
        outcome: { _tag: "Skipped", reason: { _tag: "BranchInUse" } },
      });
    }),
  );

  it.effect("stashes tracked and untracked changes, leaving a clean working tree", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp();

      writeFileSync(path.join(clone, "readme.md"), "edited\n");
      writeFileSync(path.join(clone, "notes.txt"), "untracked\n");

      expect(yield* run({ _tag: "Stash", path: clone })).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "Stashed", files: 2 } },
      });
      expect(git(clone, "status", "--porcelain")).toBe("");
      expect(git(clone, "stash", "list")).toContain("Stashed from FleetFrog");
    }),
  );

  it.effect("moves branches to the trash and restores them at the same commit", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp({ allowedTiers: ["git", "cleanup"] });

      git(clone, "branch", "feature");

      const sha = git(clone, "rev-parse", "feature");

      expect(
        yield* run({
          _tag: "DeleteBranches",
          path: clone,
          branches: [{ name: "feature", sha }],
        }),
      ).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "BranchesDeleted", branches: 1 } },
      });
      expect(git(clone, "branch", "--list", "feature")).toBe("");

      const ref = git(clone, "for-each-ref", "--format=%(refname)", "refs/fleetfrog/deleted");

      expect(ref).toMatch(/^refs\/fleetfrog\/deleted\/\d+\/feature$/);
      expect(
        yield* run(
          { _tag: "Restore", target: { _tag: "Branch", path: clone, ref } },
          runIds.second,
        ),
      ).toMatchObject({ outcome: { _tag: "Succeeded", result: { _tag: "Restored" } } });
      expect(git(clone, "rev-parse", "feature")).toBe(sha);
      expect(git(clone, "for-each-ref", "refs/fleetfrog/deleted")).toBe("");
    }),
  );

  it.effect("deletes no branch when any has moved since the dashboard showed it", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp({ allowedTiers: ["git", "cleanup"] });

      git(clone, "branch", "stale");
      git(clone, "branch", "moved");

      const shown = git(clone, "rev-parse", "moved");

      git(clone, "commit", "-q", "--allow-empty", "-m", "Newer");
      git(clone, "branch", "-f", "moved", "HEAD");

      expect(
        yield* run({
          _tag: "DeleteBranches",
          path: clone,
          branches: [
            { name: "stale", sha: git(clone, "rev-parse", "stale") },
            { name: "moved", sha: shown },
          ],
        }),
      ).toMatchObject({
        outcome: { _tag: "Skipped", reason: { _tag: "BranchChanged", branch: "moved" } },
      });
      expect(git(clone, "branch", "--list", "stale", "moved")).toContain("stale");
    }),
  );

  it.effect("won't delete the checked-out branch", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp({ allowedTiers: ["git", "cleanup"] });

      git(clone, "switch", "-q", "-c", "current");

      expect(
        yield* run({
          _tag: "DeleteBranches",
          path: clone,
          branches: [{ name: "current", sha: git(clone, "rev-parse", "current") }],
        }),
      ).toMatchObject({
        outcome: { _tag: "Skipped", reason: { _tag: "BranchCheckedOut", branch: "current" } },
      });
    }),
  );

  it.effect("archives a checkout below the Archive folder and brings it back", () =>
    Effect.gen(function* () {
      const cleanup: AgentPolicy = { allowedTiers: ["git", "cleanup"] };
      const { run, clone, root } = yield* setUp(cleanup, "Archive");
      const archived = path.join(root, "Archive", "clone");

      expect(yield* run({ _tag: "Archive", path: clone })).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "Archived", path: archived } },
      });
      expect(existsSync(clone)).toBe(false);

      const location = Option.getOrThrow(yield* locateCheckout(archived));
      const placed = yield* placeLocation(location, path.join(root, "Archive"));

      expect(placed.placement).toMatchObject({ _tag: "Archive", originalPath: clone });
      expect(
        yield* unarchiveCheckout(
          placed,
          {
            roots: [path.join(root, "projects")],
            archiveFolder: path.join(root, "Archive"),
            home: root,
          },
          makeActionOutput(),
        ),
      ).toMatchObject({ _tag: "Succeeded", result: { _tag: "Unarchived", path: clone } });
      expect(git(clone, "status", "--porcelain")).toBe("");
    }),
  );

  it.effect("won't archive a checkout whose linked worktrees would break", () =>
    Effect.gen(function* () {
      const { run, clone, root } = yield* setUp({ allowedTiers: ["git", "cleanup"] }, "Archive");

      git(clone, "worktree", "add", "-q", "-b", "feature", path.join(root, "feature"));

      expect(yield* run({ _tag: "Archive", path: clone })).toMatchObject({
        outcome: { _tag: "Skipped", reason: { _tag: "HasWorktrees", count: 1 } },
      });
      expect(existsSync(clone)).toBe(true);
    }),
  );

  it.effect("finds unpushed commits, stashes and ignored files, telling caches apart", () =>
    Effect.gen(function* () {
      const { clone } = yield* setUp();
      const location = Option.getOrThrow(yield* locateCheckout(clone));

      writeFileSync(path.join(clone, ".gitignore"), ".env\nnode_modules/\n");
      git(clone, "add", ".gitignore");
      git(clone, "commit", "-q", "-m", "Ignore things");
      writeFileSync(path.join(clone, ".env"), "SECRET=1\n");
      mkdirSync(path.join(clone, "node_modules", "left-pad"), { recursive: true });
      writeFileSync(path.join(clone, "node_modules", "left-pad", "index.js"), "\n");

      const inspection = yield* inspectCheckout(location);

      expect(inspection.remote._tag).toBe("Fetched");
      expect(inspection.unpushedCommits).toBe(1);
      expect(inspection.unpushedBranches).toEqual([{ name: "main", commits: 1 }]);
      expect(inspection.ignored.items.map(({ path: entry }) => entry)).toEqual([".env"]);
      expect(inspection.caches.map(({ path: entry }) => entry)).toEqual(["node_modules/"]);
      expect(nothingUnique(inspection)).toBe(false);
    }),
  );

  it.effect("moves a checkout to the trash without its caches and restores it", () =>
    Effect.gen(function* () {
      const { run, clone, root } = yield* setUp({ allowedTiers: ["git", "cleanup"] });
      const location = Option.getOrThrow(yield* locateCheckout(clone));

      writeFileSync(path.join(clone, ".git", "info", "exclude"), "node_modules/\n");
      mkdirSync(path.join(clone, "node_modules", "left-pad"), { recursive: true });
      writeFileSync(path.join(clone, "node_modules", "left-pad", "index.js"), "\n");

      const { fingerprint } = yield* inspectCheckout(location);

      expect(
        yield* run({ _tag: "Trash", path: clone, fingerprint, removeCaches: true }),
      ).toMatchObject({ outcome: { _tag: "Succeeded", result: { _tag: "Trashed" } } });
      expect(existsSync(clone)).toBe(false);

      const [item] = yield* listTrash(path.join(root, "trash"));

      expect(item?.originalPath).toBe(clone);
      expect(existsSync(path.join(root, "trash", item?.id ?? "", "checkout", "node_modules"))).toBe(
        false,
      );
      expect(
        yield* run(
          {
            _tag: "Restore",
            target: { _tag: "Checkout", id: item?.id ?? TrashId.make(randomUUID()) },
          },
          runIds.second,
        ),
      ).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "Restored", path: clone } },
      });
      expect(git(clone, "status", "--porcelain")).toBe("");
      expect(yield* listTrash(path.join(root, "trash"))).toEqual([]);
    }),
  );

  it.effect("leaves a checkout alone when it changed after it was inspected", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp({ allowedTiers: ["git", "cleanup"] });
      const { fingerprint } = yield* inspectCheckout(
        Option.getOrThrow(yield* locateCheckout(clone)),
      );

      writeFileSync(path.join(clone, "notes.txt"), "new work\n");

      expect(
        yield* run({ _tag: "Trash", path: clone, fingerprint, removeCaches: false }),
      ).toMatchObject({
        outcome: { _tag: "Skipped", reason: { _tag: "ChangedSinceInspection" } },
      });
      expect(existsSync(clone)).toBe(true);
    }),
  );

  it.effect("deletes for good only a checkout whose work is all on its remote", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp({ allowedTiers: ["git", "cleanup"] });
      const location = Option.getOrThrow(yield* locateCheckout(clone));

      writeFileSync(path.join(clone, ".git", "info", "exclude"), ".env\n");
      writeFileSync(path.join(clone, ".env"), "SECRET=1\n");

      const withSecret = yield* inspectCheckout(location);

      expect(
        yield* run({ _tag: "Delete", path: clone, fingerprint: withSecret.fingerprint }),
      ).toMatchObject({ outcome: { _tag: "Skipped", reason: { _tag: "UniqueWork" } } });
      expect(existsSync(clone)).toBe(true);

      rmSync(path.join(clone, ".env"));

      const clean = yield* inspectCheckout(location);

      expect(nothingUnique(clean)).toBe(true);
      expect(
        yield* run({ _tag: "Delete", path: clone, fingerprint: clean.fingerprint }, runIds.second),
      ).toMatchObject({ outcome: { _tag: "Succeeded", result: { _tag: "Deleted" } } });
      expect(existsSync(clone)).toBe(false);
    }),
  );
});
