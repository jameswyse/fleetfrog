import { expect } from "e2e";
import { Effect, Option, Stream } from "effect";

import { dashboardUrl, withDashboard } from "../../tools/e2e/dashboard.ts";

import type { App, Screen } from "e2e";

export async function openCheckout(app: App, screen: Screen, name: string) {
  await app.open("/");
  const row = screen.getByRole("row", { name: new RegExp(`^${name} `) });
  await row.getByRole("button", { name: /main/ }).first().click();
  await expect(
    screen.getByRole("button", { name: "More actions for this checkout" }),
  ).toBeVisible();
}

export function fleetSnapshot() {
  return withDashboard(dashboardUrl(), (client) =>
    client.WatchFleet().pipe(Stream.runHead, Effect.map(Option.getOrThrow)),
  );
}

export async function machineSettings(app: App, screen: Screen) {
  await app.open("/settings/fleet");
  await screen.getByRole("table").getByRole("link", { name: "E2E machine", exact: true }).click();
  await expect(screen.getByRole("textbox", { name: "Display name" })).toHaveValue("E2E machine");
}

export function requireIsolatedTrash() {
  if (process.platform !== "linux") {
    throw new Error("Trash tests require Linux: XDG_DATA_HOME isolates the native agent's trash.");
  }
}

export function cleanupEntry(screen: Screen, name: string) {
  return screen.getByRole("listitem").filter({ has: screen.getByText(name, { exact: true }) });
}
