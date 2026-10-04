import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import { fixturePaths, git, sandboxDirectory } from "../../tools/e2e/repositories.ts";
import { cleanupEntry, fleetSnapshot, openCheckout, requireIsolatedTrash } from "./support.ts";

import type { App, Screen } from "e2e";

const fixtures = fixturePaths(sandboxDirectory());

async function trashPayload(originalPath: string) {
  const item = (await fleetSnapshot()).machines
    .flatMap((machine) => machine.trash)
    .find((entry) => entry.originalPath === originalPath);

  if (item === undefined) {
    throw new Error(`No trash entry for ${originalPath}`);
  }

  const directory = path.join(sandboxDirectory(), "agent-data/fleetfrog/trash", item.id);
  expect(existsSync(path.join(directory, "checkout"))).toBe(true);

  return directory;
}

async function trashCheckout(app: App, screen: Screen, name: string) {
  requireIsolatedTrash();
  await openCheckout(app, screen, name);
  await screen.getByRole("button", { name: "More actions for this checkout" }).click();
  await screen.getByRole("button", { name: "Move to the trash…", exact: true }).click();
  const dialog = screen.getByRole("dialog");
  await dialog.getByRole("button", { name: "Move to the trash", exact: true }).click();
  await expect(dialog).toBeHidden();
  await app.open("/cleanup/trash");
  const entry = cleanupEntry(screen, name);
  await expect(entry).toBeVisible();

  return entry;
}

test("[deterministic] stash tracked and untracked files, drop to trash and restore the stash", async ({
  app,
  screen,
}) => {
  requireIsolatedTrash();
  await openCheckout(app, screen, "stash-project");
  await screen.getByRole("button", { name: "Stash changes", exact: true }).click();
  await screen
    .getByRole("dialog")
    .getByRole("button", { name: "Stash 2 files", exact: true })
    .click();
  await expect.poll(() => git(fixtures.stash, "status", "--porcelain")).toBe("");
  expect(git(fixtures.stash, "show", "stash@{0}:README.md")).toBe("Tracked stash changes");
  expect(git(fixtures.stash, "show", "stash@{0}^3:notes.txt")).toBe("Untracked stash changes");
  const sha = git(fixtures.stash, "rev-parse", "stash@{0}");
  await screen.getByRole("button", { name: /Drop stash 0,/ }).click();
  await screen
    .getByRole("dialog")
    .getByRole("button", { name: "Drop 1 stash", exact: true })
    .click();
  await expect.poll(() => git(fixtures.stash, "stash", "list")).toBe("");
  await app.open("/cleanup/trash");
  const entry = screen.getByRole("listitem").filter({ hasText: "Stash in stash-project" });
  await expect(entry).toBeVisible();
  await entry.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(entry).toBeHidden();
  expect(git(fixtures.stash, "rev-parse", "stash@{0}")).toBe(sha);
});

test("[deterministic] tidy branches protects the current branch and restores local-only commits", async ({
  app,
  screen,
}) => {
  requireIsolatedTrash();
  const sha = git(fixtures.branches, "rev-parse", "local-only");
  await openCheckout(app, screen, "branches-project");
  await screen.getByRole("button", { name: "Tidy branches…", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Tidy branches in branches-project" });
  await expect(dialog).toContainText("Can't delete yet");
  await expect(dialog).toContainText("main");
  const merged = dialog.getByRole("checkbox", { name: /feature\/e2e/ });
  await expect(merged).toBeChecked();
  await dialog.getByRole("button", { name: "Select none in Merged", exact: true }).click();
  await expect(merged).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: /local-only/ }).press("Space");
  await dialog.getByRole("button", { name: "Delete 1 branch", exact: true }).click();
  await expect.poll(() => git(fixtures.branches, "branch", "--list", "local-only")).toBe("");
  expect(git(fixtures.branches, "branch", "--show-current")).toBe("main");
  expect(git(fixtures.branches, "branch", "--list", "feature/e2e")).toContain("feature/e2e");
  await app.open("/cleanup/trash");
  const entry = screen.getByRole("listitem").filter({ hasText: "Branch in branches-project" });
  await entry.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(entry).toBeHidden();
  expect(git(fixtures.branches, "rev-parse", "local-only")).toBe(sha);
  expect(git(fixtures.branches, "show", "local-only:local.txt")).toBe("Keep this branch commit");
});

test("[deterministic] move checkout to trash, cancel purge and restore all content", async ({
  app,
  screen,
}) => {
  const sha = git(fixtures.trash, "rev-parse", "HEAD");
  const entry = await trashCheckout(app, screen, "trash-project");
  await expect.poll(() => existsSync(fixtures.trash)).toBe(false);
  await entry.getByRole("button", { name: "Delete permanently", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Permanently delete trash-project?" });
  await expect(dialog).toContainText("This can't be undone");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(entry).toBeVisible();
  await entry.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(entry).toBeHidden();
  expect(git(fixtures.trash, "rev-parse", "HEAD")).toBe(sha);
  expect(readFileSync(path.join(fixtures.trash, "notes.txt"), "utf8")).toBe(
    "Restore these notes\n",
  );
  expect(readFileSync(path.join(fixtures.trash, "ignored.txt"), "utf8")).toBe(
    "Restore ignored content\n",
  );
});

test("[deterministic] permanently delete one sandbox trash entry", async ({ app, screen }) => {
  const entry = await trashCheckout(app, screen, "purge-project");
  const payload = await trashPayload(fixtures.purge);
  await entry.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await screen
    .getByRole("dialog")
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(entry).toBeHidden();
  await expect.poll(() => existsSync(payload)).toBe(false);
  expect(existsSync(fixtures.purge)).toBe(false);
  await app.open("/");
  await expect(screen.getByRole("row").filter({ hasText: "purge-project" })).toHaveCount(0);
});

test("[deterministic] direct permanent deletion skips the trash", async ({ app, screen }) => {
  requireIsolatedTrash();
  await openCheckout(app, screen, "delete-project");
  await screen.getByRole("button", { name: "More actions for this checkout" }).click();
  await screen.getByRole("button", { name: "Move to the trash…", exact: true }).click();
  const dialog = screen.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: /Skip the trash/ }).press("Space");
  await expect(dialog).toContainText("lost for good");
  await dialog.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect.poll(() => existsSync(fixtures.delete)).toBe(false);
  await app.open("/cleanup/trash");
  await expect(cleanupEntry(screen, "delete-project")).toHaveCount(0);
});

test("[deterministic] empty trash confirms and purges multiple sandbox checkouts", async ({
  app,
  screen,
}) => {
  await trashCheckout(app, screen, "empty-trash-a-project");
  await trashCheckout(app, screen, "empty-trash-b-project");

  const payloads = await Promise.all([
    trashPayload(fixtures.emptyTrashA),
    trashPayload(fixtures.emptyTrashB),
  ]);

  await screen.getByRole("button", { name: "Empty the trash", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Empty the trash?", exact: true });
  await expect(dialog).toContainText("2 items");
  await dialog.getByRole("button", { name: "Empty the trash", exact: true }).click();
  await expect(screen.getByText("The trash is empty", { exact: true })).toBeVisible();

  for (const payload of payloads) {
    await expect.poll(() => existsSync(payload)).toBe(false);
  }

  expect(existsSync(fixtures.emptyTrashA)).toBe(false);
  expect(existsSync(fixtures.emptyTrashB)).toBe(false);
});

test("[deterministic] worktree removal stashes changes and preserves its branch", async ({
  app,
  screen,
}) => {
  requireIsolatedTrash();
  await openCheckout(app, screen, "remove-worktree-project");
  await expect(screen.getByRole("complementary")).toContainText("in another worktree");
  await expect(
    screen.getByRole("button", { name: "Switch to feature/e2e", exact: true }),
  ).toHaveCount(0);
  await screen.getByRole("button", { name: /^removable-worktree / }).click();
  await screen.getByRole("button", { name: "More actions for this checkout" }).click();
  await screen.getByRole("button", { name: "Remove worktree…", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Remove this worktree?", exact: true });
  await expect(dialog).toContainText("ignored.txt");
  await expect(dialog).toContainText("stashed first");
  await dialog.getByRole("button", { name: "Remove worktree", exact: true }).click();
  await expect.poll(() => existsSync(fixtures.removableWorktree)).toBe(false);
  expect(git(fixtures.removeWorktree, "branch", "--list", "feature/e2e")).toContain("feature/e2e");
  expect(git(fixtures.removeWorktree, "show", "stash@{0}:README.md")).toBe(
    "Keep removed worktree changes",
  );
  expect(git(fixtures.removeWorktree, "worktree", "list", "--porcelain")).not.toContain(
    fixtures.removableWorktree,
  );
});

test("[deterministic] an archived checkout can be trashed, restored and unarchived", async ({
  app,
  screen,
}) => {
  requireIsolatedTrash();
  await openCheckout(app, screen, "archive-trash-project");
  await screen.getByRole("button", { name: "More actions for this checkout" }).click();
  await screen.getByRole("button", { name: "Archive…", exact: true }).click();
  let dialog = screen.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(existsSync(fixtures.archiveTrash)).toBe(true);
  await screen.getByRole("button", { name: "More actions for this checkout" }).click();
  await screen.getByRole("button", { name: "Archive…", exact: true }).click();
  await screen.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click();
  await app.open("/cleanup/archive");
  const archivedEntry = cleanupEntry(screen, "archive-trash-project");
  await archivedEntry.getByRole("button", { name: "Move to the trash…", exact: true }).click();
  dialog = screen.getByRole("dialog");
  await dialog.getByRole("button", { name: "Move to the trash", exact: true }).click();
  await app.open("/cleanup/trash");
  const trashedEntry = cleanupEntry(screen, "archive-trash-project");
  await trashedEntry.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(trashedEntry).toBeHidden();
  await app.open("/cleanup/archive");
  await archivedEntry.getByRole("button", { name: "Unarchive", exact: true }).click();
  await expect(archivedEntry).toBeHidden();
  await expect.poll(() => existsSync(fixtures.archiveTrash)).toBe(true);
  expect(git(fixtures.archiveTrash, "branch", "--show-current")).toBe("main");
});
