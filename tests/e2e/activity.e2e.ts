import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import { openCheckout } from "./support.ts";

test("[deterministic] action history opens details and filters by repository and outcome", async ({
  app,
  screen,
}) => {
  await openCheckout(app, screen, "dirty-project");
  await screen.getByRole("button", { name: "Fetch", exact: true }).click();
  await expect(screen.getByRole("link", { name: "View in Activity", exact: true })).toBeVisible();
  await screen.getByRole("link", { name: "View in Activity", exact: true }).click();
  await expect(screen.getByRole("dialog")).toContainText("dirty-project");
  await screen.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await screen.getByRole("checkbox", { name: "dirty-project", exact: true }).press("Space");
  await expect(screen.getByRole("table")).toContainText("dirty-project");
  await screen.getByRole("checkbox", { name: "Failed", exact: true }).press("Space");
  await expect(screen.getByText("Nothing matches these filters", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(
    screen.getByRole("checkbox", { name: "dirty-project", exact: true }),
  ).not.toBeChecked();
  await expect(screen.getByRole("table")).toBeVisible();
});

test("[deterministic] activity repository search and machine filter persist in URL", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/activity");
  await screen
    .getByRole("searchbox", { name: "Find a repository", exact: true })
    .fill("dirty-project");
  await expect(screen.getByRole("checkbox", { name: "dirty-project", exact: true })).toBeVisible();
  await expect(screen.getByRole("checkbox", { name: "clean-project", exact: true })).toHaveCount(0);
  await screen.getByRole("checkbox", { name: "E2E machine", exact: true }).press("Space");
  await browser.reload();
  await expect(screen.getByRole("checkbox", { name: "E2E machine", exact: true })).toBeChecked();
});

test("[deterministic] running activity is empty when all actions have finished", async ({
  app,
  screen,
}) => {
  await app.open("/activity/running");
  await expect(screen.getByText("Nothing is running", { exact: true })).toBeVisible();
});
