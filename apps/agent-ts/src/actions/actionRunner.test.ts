import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "@effect/vitest";
import { Deferred, Duration, Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";

import { RunId } from "@fleetfrog/protocol/domain/activity";
import { nothingUnique, TrashId } from "@fleetfrog/protocol/domain/trash";

import { inheritedEnvironment } from "../config/environment.ts";
import { locateCheckout } from "../git/readCheckout.ts";
import { readLinkedWorktrees } from "../git/worktrees.ts";
import { makeScanner } from "../scheduling/scanner.ts";
import { temporaryDirectory } from "../testing/temporaryDirectory.ts";
import { listTrash } from "../trash/trashFolder.ts";
import { makeActionRunner } from "./actionRunner.ts";

import type { ScanReport } from "@fleetfrog/protocol/agent/rpcs";
import type { ActionRequest, ActionUpdate } from "@fleetfrog/protocol/domain/action";

import type { AuditEntry } from "../audit/auditLog.ts";
import type { AgentPolicy } from "../config/agentPolicy.ts";

beforeAll(() => {
  vi.stubEnv("GIT_AUTHOR_NAME", "Test");
  vi.stubEnv("GIT_AUTHOR_EMAIL", "test@example.com");
  vi.stubEnv("GIT_COMMITTER_NAME", "Test");
  vi.stubEnv("GIT_COMMITTER_EMAIL", "test@example.com");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function git(cwd: string, ...args: Array<string>): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...inheritedEnvironment(),
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();
}

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

function pathsHeldByHub(reports: ReadonlyArray<ScanReport>): Array<string> {
  const paths = new Set<string>();

  for (const report of reports) {
    if (report._tag === "Discovery") {
      paths.clear();
      report.checkouts.forEach((checkout) => paths.add(checkout.path));
    } else if (report._tag === "Status") {
      report.removedPaths.forEach((removed) => paths.delete(removed));
      report.changed.forEach((checkout) => paths.add(checkout.path));
    }
  }

  return [...paths].toSorted();
}

const makeHarness = Effect.fn("makeHarness")(function* (options: {
  readonly roots: ReadonlyArray<string>;
  readonly archiveFolder: string | null;
  readonly trashDirectory: string;
  readonly policy: AgentPolicy;
  readonly discovered?: Effect.Effect<void> | undefined;
}) {
  const updates = new Map<RunId, Array<ActionUpdate>>();
  const reports: Array<ScanReport> = [];
  const audit: Array<AuditEntry> = [];
  const rescannedBeforeFinishing: Array<boolean> = [];
  const signals = new Map<string, Deferred.Deferred<ActionUpdate>>();

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

  const folders = () => ({ roots: options.roots, archiveFolder: options.archiveFolder });

  const scanner = makeScanner({
    githubLogin: null,
    trashDirectory: options.trashDirectory,
    folders,
    report: (report) => Effect.sync(() => reports.push(report)),
  });

  const discover = scanner.discover({
    ...folders(),
    githubMaximumAge: Duration.zero,
    t3Code: null,
  });

  if (options.discovered === undefined) {
    yield* discover;
  }

  const runner = yield* makeActionRunner({
    catalogue: {
      ...scanner,
      discovered: options.discovered ?? scanner.discovered,
      rescanRepository: (commonDirectory) =>
        Effect.sync(() => {
          rescannedBeforeFinishing.push(
            [...updates.values()].every((sent) => sent.every(({ _tag }) => _tag !== "Finished")),
          );
        }).pipe(Effect.andThen(scanner.rescanRepository(commonDirectory))),
    },
    folders,
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
    discover,
    audit,
    rescannedBeforeFinishing,
    reportedPaths: () => pathsHeldByHub(reports),
    updates: (runId: RunId) => (updates.get(runId) ?? []).map(({ _tag }) => _tag),
    run: (request: ActionRequest, runId: RunId = runIds.first) =>
      runner.run(runId, request).pipe(Effect.andThen(Deferred.await(signalFor(runId, "Finished")))),
    inspect: (checkoutPath: string) =>
      runner
        .inspect({ path: checkoutPath, worktree: null })
        .pipe(
          Effect.flatMap((result) =>
            result._tag === "Inspected"
              ? Effect.succeed(result.inspection)
              : Effect.die(new Error(`Inspection failed: ${JSON.stringify(result)}`)),
          ),
        ),
    inspectWorktree: (checkoutPath: string, worktree: string) =>
      runner
        .inspect({ path: checkoutPath, worktree })
        .pipe(
          Effect.flatMap((result) =>
            result._tag === "WorktreeInspected"
              ? Effect.succeed(result.inspection)
              : Effect.die(new Error(`Inspection failed: ${JSON.stringify(result)}`)),
          ),
        ),
    started: (runId: RunId) => Deferred.await(signalFor(runId, "Started")),
    outcome: (runId: RunId) => Deferred.await(signalFor(runId, "Finished")),
  };
});

const withCleanup: AgentPolicy = { allowedTiers: ["git", "cleanup"] };

const setUp = (
  policy: AgentPolicy = { allowedTiers: ["git"] },
  archiveFolder: string | null = null,
  discovered?: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const fixture = createFixture(yield* temporaryDirectory("fleetfrog-actions-"));

    const harness = yield* makeHarness({
      roots: [path.join(fixture.root, "projects")],
      archiveFolder: archiveFolder === null ? null : path.join(fixture.root, archiveFolder),
      trashDirectory: path.join(fixture.root, "trash"),
      policy,
      discovered,
    });

    return { ...fixture, ...harness };
  });

describe("action runner", () => {
  it.effect("waits for the first discovery walk before looking for the checkout", () =>
    Effect.gen(function* () {
      const walk = yield* Deferred.make<void>();

      const { runner, discover, clone, updates, outcome } = yield* setUp(
        undefined,
        null,
        Deferred.await(walk),
      );

      yield* runner.run(runIds.first, { _tag: "Fetch", path: clone });
      yield* Effect.yieldNow;
      expect(updates(runIds.first)).toEqual([]);
      yield* discover;
      yield* Deferred.succeed(walk, undefined);
      expect(yield* outcome(runIds.first)).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "Fetched" } },
      });
    }),
  );

  it.effect("says why when the first discovery walk takes too long", () =>
    Effect.gen(function* () {
      const { runner, clone, outcome } = yield* setUp(undefined, null, Effect.never);

      yield* runner.run(runIds.first, { _tag: "Fetch", path: clone });
      yield* TestClock.adjust(Duration.minutes(2));
      const finished = yield* outcome(runIds.first);

      expect(
        finished._tag === "Finished" && finished.outcome._tag === "Failed"
          ? finished.outcome.message
          : null,
      ).toContain("hasn't finished finding");
    }),
  );

  it.effect("pulls by fetching and fast-forwarding a clean checkout", () =>
    Effect.gen(function* () {
      const { run, updates, audit, rescannedBeforeFinishing, clone, upstream } = yield* setUp();

      expect(yield* run({ _tag: "Pull", path: clone })).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "FastForwarded", commits: 1 } },
      });
      expect(git(clone, "rev-parse", "HEAD")).toBe(git(upstream, "rev-parse", "HEAD"));
      expect(updates(runIds.first).at(0)).toBe("Started");
      expect(audit.map(({ event }) => event)).toEqual(["ActionStarted", "ActionFinished"]);
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
      const { run, reportedPaths, clone, root } = yield* setUp();
      const hidden = path.join(root, "projects", ".dotfiles");

      git(root, "init", "-q", hidden);

      expect(
        yield* run({ _tag: "Clone", url: "https://github.com/acme/shop.git", destination: hidden }),
      ).toMatchObject({ outcome: { _tag: "Failed" } });
      expect(reportedPaths()).toEqual([clone]);
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

      expect(
        yield* run({ _tag: "Switch", path: clone, branch: "feature", stashChanges: false }),
      ).toMatchObject({
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

      expect(
        yield* run({ _tag: "Switch", path: clone, branch: "feature", stashChanges: false }),
      ).toMatchObject({
        outcome: { _tag: "Skipped", reason: { _tag: "UncommittedChanges", files: 1 } },
      });
      expect(git(clone, "branch", "--show-current")).toBe("main");
    }),
  );

  it.effect("stashes changes to tracked files first when asked, then switches", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp();

      git(clone, "branch", "feature");
      writeFileSync(path.join(clone, "readme.md"), "edited\n");

      expect(
        yield* run({ _tag: "Switch", path: clone, branch: "feature", stashChanges: true }),
      ).toMatchObject({
        outcome: {
          _tag: "Succeeded",
          result: { _tag: "Switched", branch: "feature", stashedFiles: 1 },
        },
      });
      expect(git(clone, "branch", "--show-current")).toBe("feature");
      expect(git(clone, "stash", "list")).toContain("before switching to feature");
    }),
  );

  it.effect("keeps a detached HEAD's own commits in the trash when switching away", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp();

      git(clone, "switch", "-q", "--detach");
      writeFileSync(path.join(clone, "readme.md"), "detached\n");
      git(clone, "commit", "-q", "-am", "Only on a detached HEAD");

      const sha = git(clone, "rev-parse", "HEAD");

      expect(
        yield* run({ _tag: "Switch", path: clone, branch: "main", stashChanges: false }),
      ).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "Switched", savedCommits: 1 } },
      });
      expect(
        git(clone, "for-each-ref", "--format=%(refname) %(objectname)", "refs/fleetfrog/deleted/"),
      ).toMatch(new RegExp(`/detached-${sha.slice(0, 7)} ${sha}$`));
    }),
  );

  it.effect("won't switch to a branch another worktree has checked out", () =>
    Effect.gen(function* () {
      const { run, clone, root } = yield* setUp();

      git(clone, "worktree", "add", "-q", "-b", "feature", path.join(root, "feature"));

      expect(
        yield* run({ _tag: "Switch", path: clone, branch: "feature", stashChanges: false }),
      ).toMatchObject({
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

      git(clone, "branch", "feature");
      expect(
        yield* run(
          { _tag: "Restore", target: { _tag: "Branch", path: clone, ref } },
          runIds.second,
        ),
      ).toMatchObject({
        outcome: {
          _tag: "Succeeded",
          result: { _tag: "Restored", branch: "feature-restored" },
        },
      });
      expect(git(clone, "rev-parse", "feature-restored")).toBe(sha);
      expect(git(clone, "for-each-ref", "refs/fleetfrog/deleted")).toBe("");
    }),
  );

  it.effect("deletes the branches that haven't moved and reports the one that has", () =>
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
        outcome: {
          _tag: "Succeeded",
          result: {
            _tag: "BranchesDeleted",
            branches: 1,
            skipped: [{ branch: "moved", reason: { _tag: "BranchChanged", branch: "moved" } }],
          },
        },
      });
      expect(git(clone, "branch", "--list", "stale", "moved")).toBe("moved");
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

  it.effect("archives a checkout with its worktrees, inside and out, and brings them back", () =>
    Effect.gen(function* () {
      const { run, discover, reportedPaths, clone, root } = yield* setUp(withCleanup, "Archive");
      const outside = path.join(root, "projects", "clone-feature");
      const nested = path.join(clone, "worktrees", "fix");
      const archived = path.join(root, "Archive", "clone");

      git(clone, "worktree", "add", "-q", "-b", "feature", outside);
      git(clone, "worktree", "add", "-q", "-b", "fix", nested);
      yield* discover;

      expect(yield* run({ _tag: "Archive", path: clone })).toMatchObject({
        outcome: {
          _tag: "Succeeded",
          result: {
            _tag: "Archived",
            path: archived,
            worktrees: [{ from: outside, to: path.join(root, "Archive", "clone-feature") }],
          },
        },
      });

      expect(git(path.join(root, "Archive", "clone-feature"), "branch", "--show-current")).toBe(
        "feature",
      );
      expect(git(path.join(archived, "worktrees", "fix"), "branch", "--show-current")).toBe("fix");

      const everyArchived = [
        archived,
        path.join(archived, "worktrees", "fix"),
        path.join(root, "Archive", "clone-feature"),
      ].toSorted();

      expect(reportedPaths()).toEqual(everyArchived);
      yield* discover;
      expect(reportedPaths()).toEqual(everyArchived);
      expect(yield* run({ _tag: "Unarchive", path: archived }, runIds.second)).toMatchObject({
        outcome: {
          _tag: "Succeeded",
          result: { _tag: "Unarchived", path: clone, worktrees: [{ to: outside }] },
        },
      });
      expect(git(outside, "branch", "--show-current")).toBe("feature");
      expect(git(nested, "branch", "--show-current")).toBe("fix");
      expect(git(clone, "worktree", "list", "--porcelain")).not.toContain("prunable");
      expect(reportedPaths()).toEqual([clone, outside, nested].toSorted());
    }),
  );

  it.effect("adds a number to an archive place that's taken or shared", () =>
    Effect.gen(function* () {
      const { run, clone, root } = yield* setUp(withCleanup, "Archive");

      git(clone, "worktree", "add", "-q", "-b", "a", path.join(root, "one", "shared"));
      git(clone, "worktree", "add", "-q", "-b", "b", path.join(root, "two", "shared"));
      mkdirSync(path.join(root, "Archive", "clone"), { recursive: true });

      expect(yield* run({ _tag: "Archive", path: clone })).toMatchObject({
        outcome: {
          _tag: "Succeeded",
          result: {
            _tag: "Archived",
            path: path.join(root, "Archive", "clone-2"),
            worktrees: [
              { to: path.join(root, "Archive", "shared") },
              { to: path.join(root, "Archive", "shared-2") },
            ],
          },
        },
      });
      expect(git(path.join(root, "Archive", "shared-2"), "branch", "--show-current")).toBe("b");
    }),
  );

  it.effect("removes a worktree after keeping its commits and changes in the trash", () =>
    Effect.gen(function* () {
      const { run, clone, root, inspectWorktree } = yield* setUp(withCleanup);
      const detached = path.join(root, "detached");
      const secrets = path.join(root, "secrets");

      git(clone, "worktree", "add", "-q", "--detach", detached);
      git(detached, "commit", "-q", "--allow-empty", "-m", "Only here");
      git(clone, "worktree", "add", "-q", "-b", "secrets", secrets);
      writeFileSync(path.join(clone, ".git", "info", "exclude"), ".env\nnode_modules/\n");
      writeFileSync(path.join(secrets, ".env"), "SECRET=1\n");
      writeFileSync(path.join(secrets, "notes.txt"), "work in progress\n");

      const lonely = yield* inspectWorktree(clone, detached);
      const withSecrets = yield* inspectWorktree(clone, secrets);

      expect(lonely).toMatchObject({ unreachableCommits: 1, changedFiles: 0 });
      expect(withSecrets).toMatchObject({
        untrackedFiles: 1,
        ignored: { total: 1, items: [{ path: ".env" }] },
      });
      expect(
        yield* run({
          _tag: "RemoveWorktree",
          path: clone,
          worktree: detached,
          fingerprint: lonely.fingerprint,
        }),
      ).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "WorktreeRemoved", savedCommits: 1 } },
      });
      expect(git(clone, "for-each-ref", "--format=%(refname)", "refs/fleetfrog/deleted/")).toMatch(
        /\/detached-[0-9a-f]{7}$/,
      );

      writeFileSync(path.join(secrets, "later.txt"), "more\n");
      expect(
        yield* run(
          {
            _tag: "RemoveWorktree",
            path: clone,
            worktree: secrets,
            fingerprint: withSecrets.fingerprint,
          },
          runIds.second,
        ),
      ).toMatchObject({ outcome: { _tag: "Skipped", reason: { _tag: "ChangedSinceInspection" } } });
      expect(existsSync(secrets)).toBe(true);
    }),
  );

  it.effect("deletes the default branch when it isn't checked out", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp(withCleanup);

      git(clone, "switch", "-q", "-c", "elsewhere");

      expect(
        yield* run({
          _tag: "DeleteBranches",
          path: clone,
          branches: [{ name: "main", sha: git(clone, "rev-parse", "main") }],
        }),
      ).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "BranchesDeleted", branches: 1 } },
      });
    }),
  );

  it.effect("removes worktrees left behind by a moved checkout, stashing one's changes", () =>
    Effect.gen(function* () {
      const { root } = yield* setUp(withCleanup);
      const main = path.join(root, "projects", "main");
      const broken = path.join(root, "projects", "broken");
      const dirty = path.join(root, "projects", "dirty");

      git(root, "clone", "-q", path.join(root, "upstream"), path.join(root, "projects", "before"));
      git(path.join(root, "projects", "before"), "worktree", "add", "-q", "-b", "broken", broken);
      git(path.join(root, "projects", "before"), "worktree", "add", "-q", "-b", "dirty", dirty);
      writeFileSync(path.join(dirty, "notes.txt"), "work in progress\n");
      renameSync(path.join(root, "projects", "before"), main);

      const location = Option.getOrThrow(yield* locateCheckout(main));

      const harness = yield* makeHarness({
        roots: [path.join(root, "projects")],
        archiveFolder: null,
        trashDirectory: path.join(root, "trash"),
        policy: withCleanup,
      });

      expect(
        (yield* readLinkedWorktrees(location)).map(({ path: worktree, state }) => [
          worktree,
          state,
        ]),
      ).toEqual([
        [broken, "Broken"],
        [dirty, "Broken"],
      ]);

      const remove = Effect.fn(function* (worktree: string, runId: RunId) {
        const { fingerprint } = yield* harness.inspectWorktree(main, worktree);

        return yield* harness.run(
          { _tag: "RemoveWorktree", path: main, worktree, fingerprint },
          runId,
        );
      });

      expect(yield* remove(broken, runIds.first)).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "WorktreeRemoved", stashedFiles: 0 } },
      });
      expect(yield* remove(dirty, runIds.second)).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "WorktreeRemoved", stashedFiles: 1 } },
      });
      expect(existsSync(broken) || existsSync(dirty)).toBe(false);
      expect(git(main, "branch", "--list", "broken")).toBe("broken");
      expect(git(main, "stash", "list")).toContain(`removing the worktree at ${dirty}`);
    }),
  );

  it.effect("drops stashes into the trash and restores them with their messages", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp(withCleanup);

      for (const message of ["first idea", "second idea"]) {
        writeFileSync(path.join(clone, "readme.md"), `${message}\n`);
        git(clone, "stash", "push", "-q", "-m", message);
      }

      const sha = git(clone, "rev-parse", "stash@{1}");

      writeFileSync(path.join(clone, "readme.md"), "third idea\n");
      git(clone, "stash", "push", "-q", "-m", "third idea");

      expect(
        yield* run({ _tag: "DropStashes", path: clone, stashes: [{ index: 1, sha }] }),
      ).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "StashesDropped", stashes: 1 } },
      });
      expect(git(clone, "stash", "list", "--format=%s")).toBe(
        "On main: third idea\nOn main: second idea",
      );

      const ref = git(clone, "for-each-ref", "--format=%(refname)", "refs/fleetfrog/stashes");

      expect(
        yield* run({ _tag: "Restore", target: { _tag: "Stash", path: clone, ref } }, runIds.second),
      ).toMatchObject({ outcome: { _tag: "Succeeded", result: { _tag: "Restored" } } });
      expect(git(clone, "stash", "list", "--format=%s")).toBe(
        "On main: first idea\nOn main: third idea\nOn main: second idea",
      );
    }),
  );

  it.effect("finds unpushed commits and ignored files, telling caches apart", () =>
    Effect.gen(function* () {
      const { inspect, clone } = yield* setUp(withCleanup);

      writeFileSync(path.join(clone, ".gitignore"), ".env\nnode_modules/\n.next-e2e/\n");
      git(clone, "add", ".gitignore");
      git(clone, "commit", "-q", "-m", "Ignore things");
      writeFileSync(path.join(clone, ".env"), "SECRET=1\n");
      mkdirSync(path.join(clone, "node_modules", "left-pad"), { recursive: true });
      writeFileSync(path.join(clone, "node_modules", "left-pad", "index.js"), "\n");
      mkdirSync(path.join(clone, ".next-e2e"));
      writeFileSync(path.join(clone, ".next-e2e", "build-manifest.json"), "{}\n");

      const inspection = yield* inspect(clone);

      expect(inspection.remote._tag).toBe("Fetched");
      expect(inspection.unpushedCommits).toBe(1);
      expect(inspection.unpushedBranches).toEqual([{ name: "main", commits: 1 }]);
      expect(inspection.ignored.items.map(({ path: entry }) => entry)).toEqual([".env"]);
      expect(inspection.caches.map(({ path: entry }) => entry).toSorted()).toEqual([
        ".next-e2e/",
        "node_modules/",
      ]);
      expect(nothingUnique(inspection)).toBe(false);
    }),
  );

  it.effect("counts commits only a detached HEAD holds, and tags no remote has", () =>
    Effect.gen(function* () {
      const { inspect, clone } = yield* setUp(withCleanup);

      git(clone, "tag", "local-only");
      git(clone, "switch", "-q", "--detach");
      git(clone, "commit", "-q", "--allow-empty", "-m", "Experiment");

      const inspection = yield* inspect(clone);

      expect(inspection.unpushedCommits).toBe(1);
      expect(inspection.unpushedTags).toBe(1);
      expect(nothingUnique(inspection)).toBe(false);
    }),
  );

  it.effect("moves a checkout to the trash with its worktree but not its caches, and back", () =>
    Effect.gen(function* () {
      const { run, inspect, discover, reportedPaths, clone, root } = yield* setUp(withCleanup);
      const worktree = path.join(root, "projects", "clone-feature");

      git(clone, "worktree", "add", "-q", "-b", "feature", worktree);
      yield* discover;

      writeFileSync(path.join(clone, ".git", "info", "exclude"), "node_modules/\n");
      mkdirSync(path.join(clone, "node_modules", "left-pad"), { recursive: true });
      writeFileSync(path.join(clone, "node_modules", "left-pad", "index.js"), "\n");

      const { fingerprint } = yield* inspect(clone);

      expect(
        yield* run({ _tag: "Trash", path: clone, fingerprint, removeCaches: true }),
      ).toMatchObject({ outcome: { _tag: "Succeeded", result: { _tag: "Trashed" } } });
      expect(existsSync(clone)).toBe(false);
      expect(reportedPaths()).toEqual([]);

      const [item] = yield* listTrash(path.join(root, "trash"));

      expect(item?.originalPath).toBe(clone);
      expect(item?.worktrees.map(({ originalPath }) => originalPath)).toEqual([worktree]);
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
      expect(git(worktree, "branch", "--show-current")).toBe("feature");
      expect(yield* listTrash(path.join(root, "trash"))).toEqual([]);
      expect(reportedPaths()).toEqual([clone, worktree]);
    }),
  );

  it.effect("empties a checkout out of the trash for good", () =>
    Effect.gen(function* () {
      const { run, inspect, clone, root } = yield* setUp(withCleanup);
      const { fingerprint } = yield* inspect(clone);

      yield* run({ _tag: "Trash", path: clone, fingerprint, removeCaches: false });

      const [item] = yield* listTrash(path.join(root, "trash"));

      expect(
        yield* run(
          {
            _tag: "Purge",
            target: { _tag: "Checkout", id: item?.id ?? TrashId.make(randomUUID()) },
          },
          runIds.second,
        ),
      ).toMatchObject({ outcome: { _tag: "Succeeded", result: { _tag: "Purged" } } });
      expect(yield* listTrash(path.join(root, "trash"))).toEqual([]);
      expect(existsSync(clone)).toBe(false);
    }),
  );

  it.effect("leaves a checkout alone when it changed after it was inspected", () =>
    Effect.gen(function* () {
      const { run, inspect, clone } = yield* setUp(withCleanup);
      const { fingerprint } = yield* inspect(clone);

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
      const { run, inspect, clone } = yield* setUp(withCleanup);

      writeFileSync(path.join(clone, ".git", "info", "exclude"), ".env\n");
      writeFileSync(path.join(clone, ".env"), "SECRET=1\n");

      const withSecret = yield* inspect(clone);

      expect(
        yield* run({
          _tag: "Delete",
          path: clone,
          fingerprint: withSecret.fingerprint,
          discardUniqueWork: false,
        }),
      ).toMatchObject({ outcome: { _tag: "Skipped", reason: { _tag: "UniqueWork" } } });
      expect(existsSync(clone)).toBe(true);

      rmSync(path.join(clone, ".env"));

      const clean = yield* inspect(clone);

      expect(nothingUnique(clean)).toBe(true);
      expect(
        yield* run(
          { _tag: "Delete", path: clone, fingerprint: clean.fingerprint, discardUniqueWork: false },
          runIds.second,
        ),
      ).toMatchObject({ outcome: { _tag: "Succeeded", result: { _tag: "Deleted" } } });
      expect(existsSync(clone)).toBe(false);
    }),
  );

  it.effect("deletes unique work and linked worktrees for good once that's accepted", () =>
    Effect.gen(function* () {
      const { run, clone, root, inspect } = yield* setUp(withCleanup);
      const worktree = path.join(root, "feature");

      git(clone, "worktree", "add", "-q", "-b", "feature", worktree);
      writeFileSync(path.join(clone, "notes.txt"), "only here\n");

      const inspection = yield* inspect(clone);

      expect(nothingUnique(inspection)).toBe(false);
      expect(
        yield* run({
          _tag: "Delete",
          path: clone,
          fingerprint: inspection.fingerprint,
          discardUniqueWork: true,
        }),
      ).toMatchObject({ outcome: { _tag: "Succeeded", result: { _tag: "Deleted" } } });
      expect(existsSync(clone) || existsSync(worktree)).toBe(false);
    }),
  );

  it.effect("won't delete a branch that is part-way through a rebase", () =>
    Effect.gen(function* () {
      const { run, clone } = yield* setUp(withCleanup);

      writeFileSync(path.join(clone, "readme.md"), "main\n");
      git(clone, "commit", "-q", "-am", "Main");
      git(clone, "switch", "-q", "-c", "topic", "HEAD~1");
      writeFileSync(path.join(clone, "readme.md"), "topic\n");
      git(clone, "commit", "-q", "-am", "Topic");

      const sha = git(clone, "rev-parse", "topic");

      expect(() => git(clone, "rebase", "-q", "main")).toThrow(/could not apply/);
      expect(
        yield* run({ _tag: "DeleteBranches", path: clone, branches: [{ name: "topic", sha }] }),
      ).toMatchObject({
        outcome: { _tag: "Skipped", reason: { _tag: "BranchCheckedOut", branch: "topic" } },
      });
      expect(git(clone, "rev-parse", "topic")).toBe(sha);
    }),
  );
});
