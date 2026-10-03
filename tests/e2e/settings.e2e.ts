import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { Schema } from "effect";

import { MachineId } from "../../packages/protocol/src/domain/machine.ts";
import { fixturePaths, sandboxDirectory } from "../../tools/e2e/repositories.ts";
import { fleetSnapshot, machineSettings } from "./support.ts";

const directory = sandboxDirectory();
const fixtures = fixturePaths(directory);

test("[deterministic] appearance settings persist after reload", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/account");
  await screen.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(browser.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await screen.getByRole("switch", { name: "Blur emails and usernames" }).click();
  await expect(screen.getByRole("switch", { name: "Blur emails and usernames" })).toBeChecked();
  await browser.reload();
  await expect(screen.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(screen.getByRole("switch", { name: "Blur emails and usernames" })).toBeChecked();
  await screen.getByRole("switch", { name: "Blur emails and usernames" }).click();
  await screen.getByRole("button", { name: "Light", exact: true }).click();
  await expect(screen.getByRole("button", { name: "Light", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await screen.getByRole("button", { name: "System", exact: true }).click();
});

test("[deterministic] quick theme menu links to appearance", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByRole("button", { name: "Preferences", exact: true }).click();
  await screen.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(screen.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await screen.getByRole("link", { name: "Appearance", exact: true }).click();
  await expect(screen.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "System", exact: true }).click();
});

test("[deterministic] scanning intervals reject invalid values and persist valid changes", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/settings/scanning");
  const input = screen.getByLabel("Status checks while watching", { exact: true });
  await input.fill("1");
  await input.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(screen.getByText("Enter an interval of at least 5 seconds.")).toBeVisible();
  expect((await fleetSnapshot()).polling.watchingStatusSeconds).toBe(5);
  await input.fill("6");
  await input.press("Enter");
  await expect.poll(async () => (await fleetSnapshot()).polling.watchingStatusSeconds).toBe(6);
  await browser.reload();
  await expect(input).toHaveValue("6");
  await input.fill("5");
  await input.press("Enter");
  await expect.poll(async () => (await fleetSnapshot()).polling.watchingStatusSeconds).toBe(5);
});

test("[deterministic] machine display name and icon persist in hub and grid", async ({
  app,
  screen,
  browser,
}) => {
  await machineSettings(app, screen);
  const name = screen.getByRole("textbox", { name: "Display name" });

  try {
    await name.fill("Renamed E2E machine");
    await name.press("Enter");
    await expect
      .poll(async () =>
        (await fleetSnapshot()).machines.some(
          (machine) => machine.customName === "Renamed E2E machine",
        ),
      )
      .toBe(true);
    await screen.getByRole("button", { name: /^Icon:/ }).click();
    await screen.getByRole("button", { name: "Laptop", exact: true }).click();
    await browser.reload();
    await expect(name).toHaveValue("Renamed E2E machine");
    await expect(screen.getByRole("button", { name: "Icon: Laptop", exact: true })).toBeVisible();
    await app.open("/");
    await expect(
      screen.getByRole("columnheader").filter({ hasText: "Renamed E2E machine" }),
    ).toBeVisible();
  } finally {
    const fleet = await fleetSnapshot();
    const machine = fleet.machines.find((item) => item.customName === "Renamed E2E machine");

    if (machine !== undefined) {
      await app.open(`/settings/fleet/${machine.id}`);
      await name.fill("E2E machine");
      await name.press("Enter");
      await expect(name).toHaveValue("E2E machine");
    }
  }
});

test("[deterministic] add, create, reorder and remove a project folder", async ({
  app,
  screen,
}) => {
  await machineSettings(app, screen);
  const folder = path.join(directory, "added-projects");
  const input = screen.getByRole("textbox", { name: "New project folder" });
  await input.fill("relative-folder");
  await screen.getByRole("button", { name: "Add", exact: true }).click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill(folder);
  await screen.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(() => existsSync(folder)).toBe(true);
  await screen.getByRole("button", { name: `Make ${folder} the default`, exact: true }).click();
  await expect
    .poll(
      async () =>
        (await fleetSnapshot()).machines.find((machine) => machine.customName === "E2E machine")
          ?.discoveryRoots[0]?.path,
    )
    .toBe(folder);
  await screen.getByRole("button", { name: `Remove ${folder}`, exact: true }).click();
  await expect
    .poll(async () =>
      (await fleetSnapshot()).machines
        .find((machine) => machine.customName === "E2E machine")
        ?.discoveryRoots.map((root) => root.path),
    )
    .toEqual([fixtures.projects]);
  expect(existsSync(folder)).toBe(true);
});

test("[deterministic] archive folder validates paths and creates a missing directory", async ({
  app,
  screen,
}) => {
  await machineSettings(app, screen);
  const input = screen.getByRole("textbox", { name: "Archive folder", exact: true });
  await input.fill("relative-archive");
  await input.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  const folder = path.join(directory, "new-archive");
  await input.fill(folder);
  await input.press("Enter");
  await expect.poll(() => existsSync(folder)).toBe(true);
  await expect
    .poll(
      async () =>
        (await fleetSnapshot()).machines.find((machine) => machine.customName === "E2E machine")
          ?.archiveFolderStatus,
    )
    .toBe("Folder");
  await expect(input).toHaveValue(folder);
  await input.fill(fixtures.archive);
  await input.press("Enter");
  await expect
    .poll(
      async () =>
        (await fleetSnapshot()).machines.find((machine) => machine.customName === "E2E machine")
          ?.archiveFolder,
    )
    .toBe(fixtures.archive);
});

test("[deterministic] T3 Code switches save and dependent options follow enablement", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/settings/integrations/t3-code");
  const read = screen.getByRole("switch", { name: "Read T3 Code", exact: true });
  const appearance = screen.getByRole("switch", { name: "Project names and icons", exact: true });
  const discovery = screen.getByRole("switch", {
    name: "Find projects outside project folders",
    exact: true,
  });
  await expect(appearance).toBeDisabled();
  await expect(discovery).toBeDisabled();
  await read.click();
  await expect(appearance).toBeEnabled();
  await appearance.click();
  await discovery.click();
  await expect
    .poll(async () => (await fleetSnapshot()).integrations.t3Code)
    .toEqual({ enabled: true, projectAppearance: true, discoverProjects: true });
  await browser.reload();
  await expect(discovery).toBeChecked();
  await discovery.click();
  await appearance.click();
  await read.click();
  await expect
    .poll(async () => (await fleetSnapshot()).integrations.t3Code)
    .toEqual({ enabled: false, projectAppearance: false, discoverProjects: false });
});

test("[deterministic] pairing codes rotate, pair a temporary agent and remove its machine", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/settings/fleet/pair");
  await screen.getByRole("button", { name: "Create pairing code", exact: true }).click();
  const readCommand = async () =>
    (await browser.locator("code").allTextContents()).find((text) =>
      text.includes("fleetfrog pair "),
    ) ?? "";
  await expect.poll(readCommand).toContain("fleetfrog pair ");
  const first = await readCommand();
  await screen.getByRole("button", { name: "New code", exact: true }).click();
  await expect.poll(readCommand).not.toBe(first);
  const command = await readCommand();
  const invitation = command.split("fleetfrog pair ")[1]?.trim();
  expect(invitation).toBeTruthy();

  if (invitation === undefined) {
    throw new Error("The pairing command has no invitation.");
  }

  execFileSync(path.resolve("apps/agent-rs/dist/fleetfrog"), ["pair", invitation], {
    env: {
      ...process.env,
      FLEETFROG_INSTANCE: "e2e",
      FLEETFROG_CONFIG_DIR: path.join(directory, "paired-agent-config"),
      XDG_DATA_HOME: path.join(directory, "paired-agent-data"),
      XDG_STATE_HOME: path.join(directory, "paired-agent-state"),
    },
    stdio: "pipe",
  });
  await expect(screen.getByRole("status").filter({ hasText: "is paired" })).toBeVisible();
  const config = Schema.decodeSync(Schema.fromJsonString(Schema.Struct({ machineId: MachineId })))(
    readFileSync(path.join(directory, "paired-agent-config/agent.json"), "utf8"),
  );
  await app.open(`/settings/fleet/${config.machineId}`);
  await expect(screen.getByRole("button", { name: "Rescan now", exact: true })).toBeDisabled();
  await screen.getByRole("button", { name: "Remove machine…", exact: true }).click();
  const dialog = screen.getByRole("dialog");
  await expect(dialog).toContainText("token will stop working");
  await dialog.getByRole("button", { name: "Remove machine", exact: true }).click();
  await expect.poll(async () => (await fleetSnapshot()).machines.length).toBe(2);
});
