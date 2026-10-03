import { existsSync } from "node:fs";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import { fixturePaths, git, sandboxDirectory } from "../../tools/e2e/repositories.ts";
import { cleanupEntry } from "./support.ts";

const fixtures = fixturePaths(sandboxDirectory());

test("[agent] search the project grid", async ({ app, agent, screen }) => {
  await app.open("/");
  await expect(screen.getByRole("row", { name: /agent-switch-project/ })).toBeVisible();
  await agent.act("Use the search field to filter the Projects grid to agent-switch-project.");
  await expect(screen.getByRole("searchbox", { name: "Search repositories" })).toHaveValue(
    "agent-switch-project",
  );
  await expect(screen.getByRole("table").getByRole("row")).toHaveCount(2);
});

test("[agent] switch a checkout to another branch", async ({ app, agent, screen }) => {
  await app.open("/");
  await expect(screen.getByRole("row", { name: /agent-switch-project/ })).toBeVisible();
  await agent.act(
    "Open agent-switch-project's checkout on E2E machine, then use Local branches to switch it from main to feature/e2e.",
  );
  await expect(screen.getByRole("button", { name: "Switch to main", exact: true })).toBeVisible();
  await expect
    .poll(() => git(fixtures.agentSwitch, "branch", "--show-current"))
    .toBe("feature/e2e");
  expect(git(fixtures.agentSwitch, "status", "--porcelain")).toBe("");
});

test("[agent] archive and unarchive a checkout", async ({ app, agent, screen }) => {
  await app.open("/");
  await expect(screen.getByRole("row", { name: /agent-archive-project/ })).toBeVisible();
  await agent.act(
    "Open agent-archive-project's checkout on E2E machine, choose Archive from its More actions menu and confirm archiving it. Then open Cleanup's Archive page.",
  );
  const entry = cleanupEntry(screen, "agent-archive-project");

  await expect(entry).toBeVisible();
  expect(existsSync(fixtures.agentArchive)).toBe(false);
  expect(
    git(path.join(fixtures.archive, "agent-archive-project"), "branch", "--show-current"),
  ).toBe("main");
  await agent.act("Unarchive agent-archive-project so it returns to its original project folder.");
  await expect(entry).toBeHidden();
  await expect.poll(() => existsSync(fixtures.agentArchive)).toBe(true);
  expect(git(fixtures.agentArchive, "branch", "--show-current")).toBe("main");
  await app.open("/");
  await expect(screen.getByRole("row", { name: /agent-archive-project/ })).toBeVisible();
});

test("[agent] find a machine's configuration without changing it", async ({
  app,
  agent,
  screen,
}) => {
  await app.open("/");
  await agent.act(
    "Open Settings, then Fleet, then E2E machine's settings. Inspect its configuration and leave it unchanged.",
  );
  await expect(screen.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue(
    "E2E machine",
  );
  await expect(screen.getByRole("textbox", { name: "Archive folder", exact: true })).toHaveValue(
    fixtures.archive,
  );
  await expect(screen.getByRole("button", { name: "Rescan now", exact: true })).toBeEnabled();
});

test("[agent] navigate to running activity", async ({ app, agent, screen }) => {
  await app.open("/");
  await agent.act(
    "Open Activity and show the Running page to see whether any actions are still in progress.",
  );
  await expect(screen.getByRole("heading", { name: "Running", exact: true })).toBeVisible();
  await expect(screen.getByText("Nothing is running", { exact: true })).toBeVisible();
});
