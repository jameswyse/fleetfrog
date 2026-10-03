import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import { openCheckout } from "./support.ts";

test("[deterministic] search shortcut, empty results and URL survive reload", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/");
  await screen.getByRole("heading", { name: "Projects", exact: true }).press("/");
  const search = screen.getByRole("searchbox", { name: "Search repositories" });
  await expect(search).toBeFocused();
  await search.fill("nothing-matches-this-name");
  await expect(screen.getByText("No repositories match.")).toBeVisible();
  expect(await browser.url()).toContain("q=nothing-matches-this-name");
  await browser.reload();
  await expect(search).toHaveValue("nothing-matches-this-name");
  await screen.getByRole("button", { name: "Clear the search" }).click();
  await expect(screen.getByRole("row").filter({ hasText: "clean-project" })).toBeVisible();
});

test("[deterministic] out-of-sync filter selects checkouts behind their upstream", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/");
  await screen.getByRole("radio", { name: /Out of sync/ }).press("Space");
  await expect(screen.getByRole("row").filter({ hasText: "filter-project" })).toBeVisible();
  await expect(screen.getByRole("row").filter({ hasText: "clean-project" })).toHaveCount(0);
  await browser.reload();
  await expect(screen.getByRole("radio", { name: /Out of sync/ })).toBeChecked();
});

test("[deterministic] checkout panel deep link and Escape restore grid focus", async ({
  app,
  screen,
  browser,
}) => {
  await openCheckout(app, screen, "dirty-project");
  const url = await browser.url();
  expect(url).toContain("repo=");
  expect(url).toContain("machine=");
  await browser.reload();
  await expect(screen.getByRole("button", { name: "Stash changes", exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Close", exact: true }).press("Escape");
  await expect(screen.getByRole("button", { name: "Stash changes", exact: true })).toBeHidden();
  await expect(
    screen
      .getByRole("row")
      .filter({ hasText: "dirty-project" })
      .getByRole("button", { name: /main/ }),
  ).toBeFocused();
});

test("[deterministic] narrow viewport supports navigation and checkout panels", async ({
  app,
  screen,
  browser,
}) => {
  await browser.setViewport({ width: 390, height: 844 });
  await openCheckout(app, screen, "dirty-project");
  await expect(screen.getByRole("button", { name: "Stash changes", exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Close", exact: true }).click();
  await expect(screen.getByRole("searchbox", { name: "Search repositories" })).toBeVisible();
  await app.open("/settings/scanning");
  await expect(screen.getByRole("heading", { name: "Scanning", exact: true })).toBeVisible();
  await expect(
    screen.getByRole("spinbutton", { name: "Status checks while watching" }),
  ).toBeVisible();
});

test("[deterministic] repository panel shows checkouts and machine menus", async ({
  app,
  screen,
}) => {
  await app.open("/");
  await screen.getByRole("button", { name: "dirty-project", exact: true }).click();
  await expect(screen.getByRole("complementary")).toContainText("E2E machine");
  await screen.getByRole("button", { name: "Close", exact: true }).click();
  await screen
    .getByRole("columnheader")
    .filter({ hasText: "E2E machine" })
    .getByRole("button")
    .click();
  await expect(screen.getByRole("button", { name: "Rescan now", exact: true })).toBeVisible();
  await expect(screen.getByRole("link", { name: "Machine settings", exact: true })).toBeVisible();
});

test("[deterministic] all dashboard sections load through their route", async ({ app, screen }) => {
  for (const [route, heading] of [
    ["/activity", "History"],
    ["/activity/running", "Running"],
    ["/cleanup", "Archive"],
    ["/cleanup/trash", "Trash"],
    ["/settings", "Scanning"],
    ["/settings/fleet", "Fleet"],
    ["/settings/scanning", "Scanning"],
    ["/settings/integrations", "Integrations"],
    ["/settings/integrations/t3-code", "T3 Code"],
    ["/settings/authentication", "Authentication"],
    ["/settings/authentication/users", "Users"],
    ["/settings/authentication/oidc", "OpenID Connect"],
    ["/account", "Appearance"],
  ] as const) {
    await app.open(route);
    await expect(screen.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
  }
});
