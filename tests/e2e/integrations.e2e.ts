import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { Effect } from "effect";

import { withDashboard } from "../../tools/e2e/dashboard.ts";
import { fixturePaths, git, sandboxDirectory } from "../../tools/e2e/repositories.ts";
import { fleetSnapshot } from "./support.ts";

const fixtures = fixturePaths(sandboxDirectory());

test("[deterministic] T3 Code projects, threads and busy-action confirmation come from the agent's database", async ({
  app,
  screen,
  browser,
}) => {
  const url = app.baseUrl;

  if (url === undefined) {
    throw new Error("The dashboard URL is missing.");
  }

  await app.open("/settings/integrations/t3-code");

  try {
    await screen.getByRole("switch", { name: "Read T3 Code", exact: true }).click();
    await screen.getByRole("switch", { name: "Project names and icons", exact: true }).click();
    await expect
      .poll(async () => (await fleetSnapshot()).integrations.t3Code)
      .toEqual({ enabled: true, projectAppearance: true, discoverProjects: false });
    await withDashboard(url, (client) => client.Refresh({ target: { _tag: "All" } }));
    await expect
      .poll(async () =>
        (await fleetSnapshot()).machines.flatMap((machine) =>
          machine.t3Code?.reading._tag === "Read"
            ? machine.t3Code.reading.projects.map((project) => project.title)
            : [],
        ),
      )
      .toEqual(["E2E T3 project", "E2E non-Git project"]);
    await expect(
      screen.getByRole("heading", { name: "Projects without a repository", exact: true }),
    ).toBeVisible();
    await expect.poll(() => browser.locator("main").textContent()).toContain("E2E non-Git project");
    await app.open("/");
    await screen
      .getByRole("searchbox", { name: "Search repositories", exact: true })
      .fill("t3-project");
    const row = screen.getByRole("row", { name: /^E2E T3 project / });
    await expect(row).toContainText("Working");
    await row.getByRole("button", { name: /main/ }).click();
    await expect(screen.getByRole("complementary")).toContainText("E2E coding thread");
    await screen.getByRole("button", { name: "Switch to feature/e2e", exact: true }).click();
    const dialog = screen.getByRole("dialog", {
      name: "Switch to feature/e2e while T3 Code is working?",
      exact: true,
    });
    await expect(dialog).toContainText("E2E coding thread");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(git(fixtures.t3, "branch", "--show-current")).toBe("main");
    await screen.getByRole("button", { name: "Switch to feature/e2e", exact: true }).click();
    await dialog.getByRole("button", { name: "Switch anyway", exact: true }).click();
    await expect.poll(() => git(fixtures.t3, "branch", "--show-current")).toBe("feature/e2e");
  } finally {
    await withDashboard(url, (client) =>
      client
        .UpdateIntegrations({
          integrations: {
            t3Code: { enabled: false, projectAppearance: false, discoverProjects: false },
          },
        })
        .pipe(Effect.asVoid),
    );
    await expect.poll(async () => (await fleetSnapshot()).integrations.t3Code.enabled).toBe(false);
  }
});

test("[deterministic] T3 Code discovers a real checkout outside the configured project folders", async ({
  app,
  screen,
}) => {
  const directory = sandboxDirectory();
  const checkout = path.join(directory, "t3-outside-project");
  mkdirSync(checkout);
  git(checkout, "init", "--initial-branch=main");
  git(checkout, "config", "user.name", "FleetFrog E2E");
  git(checkout, "config", "user.email", "e2e@example.test");
  writeFileSync(path.join(checkout, "README.md"), "Outside the project folders\n");
  git(checkout, "add", ".");
  git(checkout, "commit", "-m", "T3 discovery fixture");
  const database = new DatabaseSync(path.join(directory, "t3code/userdata/statev2.sqlite"));

  try {
    database
      .prepare("INSERT INTO projection_projects VALUES (?, ?, ?, ?, NULL, 0, ?, NULL)")
      .run(
        "e2e-outside",
        "E2E external project",
        checkout,
        JSON.stringify({ kind: "lucide", name: "sparkles", color: "amber" }),
        new Date().toISOString(),
      );
  } finally {
    database.close();
  }

  const hasCheckout = async () =>
    (await fleetSnapshot()).repositories.some((repository) =>
      repository.checkouts.some((entry) => entry.checkout.path === checkout),
    );
  expect(await hasCheckout()).toBe(false);
  const url = app.baseUrl;

  if (url === undefined) {
    throw new Error("The dashboard URL is missing.");
  }

  try {
    await app.open("/settings/integrations/t3-code");
    await screen.getByRole("switch", { name: "Read T3 Code", exact: true }).click();
    await screen.getByRole("switch", { name: "Project names and icons", exact: true }).click();
    await screen
      .getByRole("switch", { name: "Find projects outside project folders", exact: true })
      .click();
    await expect
      .poll(async () => (await fleetSnapshot()).integrations.t3Code)
      .toEqual({ enabled: true, projectAppearance: true, discoverProjects: true });
    await withDashboard(url, (client) => client.Refresh({ target: { _tag: "All" } }));
    await expect.poll(hasCheckout).toBe(true);
    await app.open("/");
    await screen
      .getByRole("searchbox", { name: "Search repositories", exact: true })
      .fill("t3-outside-project");
    await expect(screen.getByRole("row", { name: /^E2E external project / })).toBeVisible();
    expect(readFileSync(path.join(checkout, "README.md"), "utf8")).toBe(
      "Outside the project folders\n",
    );
    expect(git(checkout, "status", "--porcelain")).toBe("");
  } finally {
    await withDashboard(url, (client) =>
      Effect.gen(function* () {
        yield* client.UpdateIntegrations({
          integrations: {
            t3Code: { enabled: false, projectAppearance: false, discoverProjects: false },
          },
        });
        yield* client.Refresh({ target: { _tag: "All" } });
      }),
    );
    await expect.poll(hasCheckout).toBe(false);
  }
});
