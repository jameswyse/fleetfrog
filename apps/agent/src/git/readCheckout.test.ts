import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { temporaryDirectory } from "../testing/temporaryDirectory.ts";
import { locateCheckout, readGitStatus } from "./readCheckout.ts";

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
  });
}

/** An upstream repository, a clone one commit behind and one ahead of it, and a linked worktree. */
function createFixture(root: string) {
  const upstream = path.join(root, "upstream");
  const clone = path.join(root, "clone");

  git(root, "init", "-q", "-b", "main", upstream);
  writeFileSync(path.join(upstream, "readme.md"), "one\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-q", "-m", "First");
  git(root, "clone", "-q", upstream, clone);
  writeFileSync(path.join(upstream, "readme.md"), "two\n");
  git(upstream, "commit", "-q", "-am", "Second upstream");

  writeFileSync(path.join(clone, "local.md"), "local\n");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "Local work");
  git(clone, "fetch", "-q");

  writeFileSync(path.join(clone, "stashed.md"), "stash me\n");
  git(clone, "add", "stashed.md");
  git(clone, "stash", "push", "-q", "-m", "parked idea");

  renameSync(path.join(clone, "local.md"), path.join(clone, "renamed.md"));
  git(clone, "add", "-A");
  writeFileSync(path.join(clone, "readme.md"), "edited\n");
  writeFileSync(path.join(clone, "notes with spaces.txt"), "untracked\n");
  git(clone, "worktree", "add", "-q", "-b", "feature", path.join(root, "feature"));

  return {
    root,
    upstream,
    clone,
    rootCommit: git(clone, "rev-list", "--max-parents=0", "HEAD").trim(),
  };
}

describe("reading a checkout", () => {
  it.effect("reports branch tracking, changes, renames, untracked files and stashes", () =>
    Effect.gen(function* () {
      const fixture = createFixture(yield* temporaryDirectory("fleetfrog-agent-"));
      const location = Option.getOrThrow(yield* locateCheckout(fixture.clone));
      const status = yield* readGitStatus(location);

      // A local-path origin has no remote identity, so the root commit identifies the repository.
      expect(location.identity).toEqual({ _tag: "RootCommit", sha: fixture.rootCommit });
      expect(location.worktree).toEqual({ _tag: "Main" });
      expect(location.directoryName).toBe("clone");
      expect(status.head).toEqual({
        _tag: "Branch",
        name: "main",
        upstream: { name: "origin/main", ahead: 1, behind: 1, gone: false },
      });
      expect(status.lastCommit?.subject).toBe("Local work");
      expect(status.changed.items).toEqual([
        { path: "readme.md", originalPath: null, staged: ".", unstaged: "M" },
        { path: "renamed.md", originalPath: "local.md", staged: "R", unstaged: "." },
      ]);
      expect(status.untracked).toEqual({ items: ["notes with spaces.txt"], total: 1 });
      expect(status.stashes).toEqual({
        items: [{ index: 0, message: "On main: parked idea" }],
        total: 1,
      });
      expect(status.branches.items.map(({ name }) => name)).toEqual(["feature", "main"]);
      expect(status.lastFetchedAt).not.toBeNull();
    }),
  );

  it.effect("identifies a linked worktree with its main checkout", () =>
    Effect.gen(function* () {
      const fixture = createFixture(yield* temporaryDirectory("fleetfrog-agent-"));
      const location = Option.getOrThrow(yield* locateCheckout(path.join(fixture.root, "feature")));

      expect(location.worktree).toEqual({ _tag: "Linked", mainPath: fixture.clone });
      expect(location.directoryName).toBe("clone");
      expect(location.identity).toEqual({ _tag: "RootCommit", sha: fixture.rootCommit });
    }),
  );

  it.effect("gives an unborn orphan worktree the identity of its main checkout", () =>
    Effect.gen(function* () {
      const fixture = createFixture(yield* temporaryDirectory("fleetfrog-agent-"));
      const orphan = path.join(fixture.root, "orphan");

      git(fixture.clone, "worktree", "add", "-q", "--orphan", "-b", "scratch", orphan);

      const location = Option.getOrThrow(yield* locateCheckout(orphan));
      const status = yield* readGitStatus(location);

      expect(location.identity).toEqual({ _tag: "RootCommit", sha: fixture.rootCommit });
      expect(status.head).toEqual({ _tag: "Unborn", name: "scratch" });
      // The clone's fetch counts for every worktree, since they share remote-tracking refs.
      expect(status.lastFetchedAt).not.toBeNull();
    }),
  );

  it.effect("uses a normalised origin URL when the remote is hosted", () =>
    Effect.gen(function* () {
      const fixture = createFixture(yield* temporaryDirectory("fleetfrog-agent-"));

      git(fixture.clone, "remote", "set-url", "origin", "git@github.com:Acme/Shop.git");

      const location = Option.getOrThrow(yield* locateCheckout(fixture.clone));

      expect(location.identity).toEqual({ _tag: "Remote", host: "github.com", path: "acme/shop" });
    }),
  );
});
