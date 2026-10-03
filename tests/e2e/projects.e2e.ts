import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import { fixturePaths, git, sandboxDirectory } from "../../tools/e2e/repositories.ts";
import { cleanupEntry } from "./support.ts";

const fixtures = fixturePaths(sandboxDirectory());

test("[deterministic] search and changes filters show the matching repositories", async ({
  app,
  screen,
}) => {
  await app.open("/");
  const table = screen.getByRole("table");

  await expect(table).toContainText("clean-project");
  await screen.getByRole("searchbox", { name: "Search repositories" }).fill("dirty-project");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByRole("row", { name: /dirty-project/ })).toBeVisible();
  await screen.getByRole("button", { name: "Clear the search" }).click();
  await screen.getByRole("radio", { name: /Has changes/ }).press("Space");
  await expect(screen.getByRole("radio", { name: /Has changes/ })).toBeChecked();
  await expect(table.getByRole("row", { name: /dirty-project/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /^archive-project / })).toBeVisible();
  await expect(table.getByRole("row", { name: /clean-project/ })).toHaveCount(0);
  await expect(table.getByRole("row", { name: /pull-project/ })).toHaveCount(0);
});

test("[deterministic] switch a clean checkout through the dashboard", async ({ app, screen }) => {
  await app.open("/");
  await screen
    .getByRole("row", { name: /clean-project/ })
    .getByRole("button", { name: /main/ })
    .click();
  await screen.getByRole("button", { name: "Switch to feature/e2e", exact: true }).click();
  await expect(screen.getByRole("button", { name: "Switch to main", exact: true })).toBeVisible();
  await expect.poll(() => git(fixtures.clean, "branch", "--show-current")).toBe("feature/e2e");
  expect(git(fixtures.clean, "status", "--porcelain")).toBe("");
});

test("[deterministic] switching a dirty checkout preserves the changes in a stash", async ({
  app,
  screen,
}) => {
  await app.open("/");
  await screen
    .getByRole("row", { name: /dirty-switch-project/ })
    .getByRole("button", { name: /main/ })
    .click();
  await screen.getByRole("button", { name: "Switch to feature/e2e", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Stash changes and switch to feature/e2e?" });

  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Stash and switch" }).click();
  await expect(dialog).toBeHidden();
  await expect(screen.getByRole("button", { name: "Switch to main", exact: true })).toBeVisible();
  await expect
    .poll(() => git(fixtures.dirtySwitch, "branch", "--show-current"))
    .toBe("feature/e2e");
  expect(git(fixtures.dirtySwitch, "show", "stash@{0}:README.md")).toBe(
    "Uncommitted fixture changes",
  );
  expect(git(fixtures.dirtySwitch, "status", "--porcelain")).toBe("");
});

test("[deterministic] pull fast-forwards from a local bare remote", async ({ app, screen }) => {
  await app.open("/");
  await screen
    .getByRole("row", { name: /pull-project/ })
    .getByRole("button", { name: /main/ })
    .click();
  await screen.getByRole("button", { name: "Pull", exact: true }).click();
  await expect(screen.getByRole("status").filter({ hasText: "Pull:" })).toContainText(
    "Pulled 1 commit",
  );
  await expect
    .poll(() => readFileSync(path.join(fixtures.pull, "README.md"), "utf8"))
    .toBe("Pulled from the local remote\n");
  expect(git(fixtures.pull, "rev-parse", "HEAD")).toBe(
    git(fixtures.pull, "rev-parse", "origin/main"),
  );
});

test("[deterministic] archive and unarchive preserve files and repair linked worktrees", async ({
  app,
  screen,
}) => {
  await app.open("/");
  await screen
    .getByRole("row", { name: /^archive-project / })
    .getByRole("button", { name: /main/ })
    .click();
  await screen.getByRole("button", { name: "More actions for this checkout" }).click();
  await screen.getByRole("button", { name: "Archive…", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Archive archive-project on E2E machine?" });

  await expect(dialog).toContainText("1 linked worktree");
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  await app.open("/cleanup/archive");
  const entry = cleanupEntry(screen, "archive-project");

  await expect(entry).toBeVisible();
  const archived = path.join(fixtures.archive, "archive-project");
  const archivedWorktree = path.join(fixtures.archive, "archive-worktree");

  await expect.poll(() => existsSync(fixtures.archiveProject)).toBe(false);
  expect(readFileSync(path.join(archived, "notes.txt"), "utf8")).toBe(
    "Keep these untracked notes\n",
  );
  expect(readFileSync(path.join(archived, "ignored.txt"), "utf8")).toBe("Keep this ignored file\n");
  expect(git(archivedWorktree, "branch", "--show-current")).toBe("feature/e2e");
  expect(git(archived, "worktree", "list", "--porcelain")).toContain(archivedWorktree);

  await entry.getByRole("button", { name: "Unarchive", exact: true }).click();
  await expect(entry).toBeHidden();
  await expect.poll(() => existsSync(fixtures.archiveProject)).toBe(true);
  expect(readFileSync(path.join(fixtures.archiveProject, "notes.txt"), "utf8")).toBe(
    "Keep these untracked notes\n",
  );
  expect(readFileSync(path.join(fixtures.worktree, "worktree-notes.txt"), "utf8")).toBe(
    "Keep worktree notes\n",
  );
  expect(git(fixtures.worktree, "branch", "--show-current")).toBe("feature/e2e");
  expect(git(fixtures.archiveProject, "worktree", "list", "--porcelain")).toContain(
    fixtures.worktree,
  );
  expect(existsSync(path.join(fixtures.archiveProject, ".git/fleetfrog-archive.json"))).toBe(false);

  await app.open("/");
  await expect(screen.getByRole("row", { name: /^archive-project / })).toBeVisible();
});
