import { readFileSync, writeFileSync, unlinkSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { Effect } from "effect";

import { withDashboard } from "../../tools/e2e/dashboard.ts";
import { fixturePaths, git, sandboxDirectory } from "../../tools/e2e/repositories.ts";
import { fleetSnapshot, openCheckout } from "./support.ts";

const directory = sandboxDirectory();
const fixtures = fixturePaths(directory);

test("[deterministic] fetch updates remote refs without changing checkout files", async ({
  app,
  screen,
}) => {
  const before = git(fixtures.fetch, "rev-parse", "HEAD");
  await openCheckout(app, screen, "fetch-project");
  await screen.getByRole("button", { name: "Fetch", exact: true }).click();
  await expect
    .poll(() => git(fixtures.fetch, "rev-parse", "origin/main"))
    .toBe(git(path.join(directory, "fetch-author"), "rev-parse", "HEAD"));
  expect(git(fixtures.fetch, "rev-parse", "HEAD")).toBe(before);
  expect(readFileSync(path.join(fixtures.fetch, "README.md"), "utf8")).toBe("fetch-project\n");
  await expect(screen.getByRole("status").filter({ hasText: "Fetch:" })).toContainText("Fetched");
});

test("[deterministic] stash confirmation cancels without changing files", async ({
  app,
  screen,
}) => {
  await openCheckout(app, screen, "dirty-project");
  await screen.getByRole("button", { name: "Stash changes", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Stash changes in dirty-project?" });
  await expect(dialog).toContainText("1 changed file");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(git(fixtures.dirty, "stash", "list")).toBe("");
  expect(readFileSync(path.join(fixtures.dirty, "README.md"), "utf8")).toBe(
    "Uncommitted fixture changes\n",
  );
});

test("[deterministic] Git failure appears in checkout status and Activity", async ({
  app,
  screen,
}) => {
  const lock = path.join(fixtures.failure, ".git/index.lock");
  writeFileSync(lock, "E2E lock\n");

  try {
    await openCheckout(app, screen, "failure-project");
    await screen.getByRole("button", { name: "Switch to feature/e2e", exact: true }).click();
    await expect(screen.getByRole("status").filter({ hasText: "Switch:" })).toContainText(
      /Another git process|index.lock|Unable to create/,
    );
    expect(git(fixtures.failure, "branch", "--show-current")).toBe("main");
    await screen.getByRole("link", { name: "View in Activity" }).click();
    await expect(screen.getByRole("dialog")).toContainText("failure-project");
    await expect(screen.getByRole("dialog")).toContainText(
      /Another git process|index.lock|Unable to create/,
    );
  } finally {
    unlinkSync(lock);
  }
});

test("[deterministic] clone validates destination and creates a real checkout on another agent", async ({
  app,
  screen,
}) => {
  await app.open("/");
  await screen.getByRole("button", { name: "Actions for clone-project", exact: true }).click();
  await screen.getByRole("button", { name: "Clone to another machine", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Clone clone-project", exact: true });
  await dialog.getByRole("button", { name: /Clone/, exact: false }).click();
  await expect(dialog).toContainText("Choose at least one machine");
  await dialog.getByRole("checkbox", { name: "E2E clone machine" }).press("Space");
  const destination = dialog.getByRole("textbox", { name: /New folder inside/ });
  await destination.fill("../outside");
  await dialog.getByRole("button", { name: /^Clone/ }).click();
  await expect(destination).toHaveAttribute("aria-invalid", "true");
  await destination.fill("clone-project");
  await dialog.getByRole("button", { name: /^Clone/ }).click();
  await expect(dialog).toBeHidden();
  const checkout = path.join(fixtures.secondProjects, "clone-project");
  await expect
    .poll(() => {
      try {
        return git(checkout, "branch", "--show-current");
      } catch {
        return null;
      }
    })
    .toBe("main");
  expect(readFileSync(path.join(checkout, "README.md"), "utf8")).toBe("clone-project\n");
  expect(git(checkout, "rev-parse", "HEAD")).toBe(git(fixtures.clone, "rev-parse", "HEAD"));
  await expect(
    screen
      .getByRole("row")
      .filter({ hasText: "clone-project" })
      .getByRole("button", { name: /main/ }),
  ).toHaveCount(2);
});

test("[deterministic] repository bulk pull lists eligible and skipped checkouts", async ({
  app,
  screen,
}) => {
  const remote = path.join(directory, "bulk-project.git");
  const author = path.join(directory, "bulk-author");
  git(directory, "clone", remote, author);
  git(author, "config", "user.name", "FleetFrog E2E");
  git(author, "config", "user.email", "e2e@example.test");
  writeFileSync(path.join(author, "bulk.txt"), "Bulk pull update\n");
  git(author, "add", ".");
  git(author, "commit", "-m", "Bulk update");
  git(author, "push", "origin", "main");
  await app.open("/");
  await screen.getByRole("button", { name: "Actions for bulk-project", exact: true }).click();
  await screen.getByRole("button", { name: "Pull on every machine", exact: true }).click();
  const dialog = screen.getByRole("dialog");
  await expect(dialog).toContainText("Pull 1 checkout on 1 machine?");
  await dialog.getByRole("button", { name: /Pull/, exact: false }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => git(fixtures.bulk, "rev-parse", "HEAD"))
    .toBe(git(author, "rev-parse", "HEAD"));
  expect(readFileSync(path.join(fixtures.bulk, "bulk.txt"), "utf8")).toBe("Bulk pull update\n");
});

test("[deterministic] fleet and machine pull previews leave dirty checkouts alone on cancellation", async ({
  app,
  screen,
}) => {
  await app.open("/");
  await screen.getByRole("button", { name: "Fleet actions", exact: true }).click();
  await screen.getByRole("button", { name: "Pull every checkout", exact: true }).click();
  await expect(screen.getByRole("dialog")).toContainText("dirty-project");
  await expect(screen.getByRole("dialog")).toContainText(/changes|uncommitted/);
  await screen.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await screen
    .getByRole("columnheader")
    .filter({ hasText: "E2E machine" })
    .getByRole("button")
    .click();
  await screen.getByRole("button", { name: "Pull every checkout", exact: true }).click();
  await expect(screen.getByRole("dialog")).toContainText("E2E machine");
  await screen.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(readFileSync(path.join(fixtures.dirty, "README.md"), "utf8")).toBe(
    "Uncommitted fixture changes\n",
  );
});

test("[deterministic] a running fetch can be cancelled from Activity", async ({ app, screen }) => {
  const slowUpload = path.join(directory, "slow-upload-pack");
  writeFileSync(slowUpload, '#!/bin/sh\nsleep 15\nexec git-upload-pack "$@"\n');
  chmodSync(slowUpload, 0o755);
  git(fixtures.cancel, "config", "remote.origin.uploadpack", slowUpload);
  const before = git(fixtures.cancel, "rev-parse", "HEAD");

  try {
    await openCheckout(app, screen, "cancel-project");
    await screen.getByRole("button", { name: "Fetch", exact: true }).click();
    await screen.getByRole("link", { name: "View in Activity", exact: true }).click();
    await expect(screen.getByRole("dialog")).toContainText("cancel-project");
    await screen.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await app.open("/activity/running");
    await expect(screen.getByRole("main")).toContainText("cancel-project");
    await screen
      .getByRole("button", { name: "Cancel cancel-project on E2E machine", exact: true })
      .click();
    await expect(screen.getByText("Nothing is running", { exact: true })).toBeVisible();
    await openCheckout(app, screen, "cancel-project");
    await expect(screen.getByRole("status").filter({ hasText: "Fetch:" })).toContainText(
      /Cancelled|cancelled/,
    );
    expect(git(fixtures.cancel, "rev-parse", "HEAD")).toBe(before);
  } finally {
    git(fixtures.cancel, "config", "--unset", "remote.origin.uploadpack");
  }
});

test("[deterministic] clone without a supported remote reports failure and creates no checkout", async ({
  app,
  screen,
}) => {
  await app.open("/");
  await screen.getByRole("button", { name: "Actions for dirty-project", exact: true }).click();
  await screen.getByRole("button", { name: "Clone to another machine", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Clone dirty-project", exact: true });
  await dialog.getByRole("checkbox", { name: "E2E clone machine", exact: true }).press("Space");
  await dialog.getByRole("button", { name: /^Clone/ }).click();
  await expect(dialog.getByRole("status")).toContainText("nothing to clone from");
  expect(existsSync(path.join(fixtures.secondProjects, "dirty-project"))).toBe(false);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("[deterministic] fleet rescan discovers a newly created repository", async ({
  app,
  screen,
}) => {
  const url = app.baseUrl;

  if (url === undefined) {
    throw new Error("The dashboard URL is missing.");
  }

  const { polling } = await fleetSnapshot();
  const setDiscoverySeconds = (discoverySeconds: number) =>
    withDashboard(url, (client) =>
      client.UpdatePolling({ polling: { ...polling, discoverySeconds } }).pipe(Effect.asVoid),
    );

  // Without this, the harness's 5-second discovery finds the repository before the assertion times out.
  await setDiscoverySeconds(3600);

  try {
    const checkout = path.join(fixtures.projects, "rescan-project");
    mkdirSync(checkout);
    git(checkout, "init", "--initial-branch=main");
    git(checkout, "config", "user.name", "FleetFrog E2E");
    git(checkout, "config", "user.email", "e2e@example.test");
    writeFileSync(path.join(checkout, "README.md"), "Discovered after rescan\n");
    git(checkout, "add", ".");
    git(checkout, "commit", "-m", "Rescan fixture");
    await app.open("/");
    await screen.getByRole("button", { name: "Fleet actions", exact: true }).click();
    await screen.getByRole("button", { name: "Rescan every machine", exact: true }).click();
    await expect(screen.getByRole("row", { name: /^rescan-project / })).toBeVisible();
  } finally {
    await setDiscoverySeconds(polling.discoverySeconds);
  }
});
