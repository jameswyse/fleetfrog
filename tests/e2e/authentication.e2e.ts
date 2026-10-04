import { beforeEach, afterEach, test } from "@e2e-dev/web";
import { expect } from "e2e";

import { startIdentityProvider } from "../../tools/e2e/oidc.ts";

import type { App, Screen } from "e2e";

const adminEmail = "admin@e2e.example.test";
const adminPassword = "FleetFrog test password 123";
const changedPassword = "FleetFrog changed password 456";

async function login(app: App, screen: Screen, email = adminEmail, password = adminPassword) {
  await app.open("/login");
  await screen.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await screen.getByLabel("Password", { exact: true }).fill(password);
  await screen.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(screen.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
}

beforeEach(async ({ app, screen }) => {
  await app.open("/settings/authentication");
  await screen.getByRole("switch", { name: "Email and password", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Turn on password sign-in", exact: true });
  await dialog.getByRole("textbox", { name: "Your name", exact: true }).fill("E2E admin");
  await dialog.getByRole("textbox", { name: "Your email", exact: true }).fill(adminEmail);
  await dialog.getByLabel("Password", { exact: true }).fill(adminPassword);
  await dialog.getByLabel("Confirm password", { exact: true }).fill(adminPassword);
  await dialog.getByRole("button", { name: "Turn on", exact: true }).click();
  await expect(
    screen.getByRole("button", { name: "Account menu for E2E admin", exact: true }),
  ).toBeVisible();
});

afterEach(async () => {
  const url = process.env.FLEETFROG_E2E_URL;

  if (url === undefined) {
    throw new Error("The e2e dashboard URL is missing.");
  }

  const headers = { "Content-Type": "application/json", Origin: url };

  for (const password of [adminPassword, changedPassword]) {
    const response = await fetch(`${url}/auth/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: adminEmail, password }),
    });

    if (!response.ok) {
      continue;
    }

    const cookie = response.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; ");

    const disabled = await fetch(`${url}/auth/methods`, {
      method: "POST",
      headers: { ...headers, Cookie: cookie },
      body: JSON.stringify({ _tag: "TurnOff" }),
    });

    if (!disabled.ok) {
      throw new Error(`Could not restore open sign-in: ${disabled.status}`);
    }

    return;
  }

  // The test may already have turned sign-in off through the dashboard.
  const response = await fetch(`${url}/auth/methods`, {
    method: "POST",
    headers,
    body: JSON.stringify({ _tag: "TurnOff" }),
  });

  if (!response.ok) {
    throw new Error(`Could not restore authentication after the test: ${response.status}`);
  }
});

test("[deterministic] password sign-in rejects wrong credentials and preserves return route", async ({
  app,
  screen,
  browser,
}) => {
  await app.clearState();
  await app.open("/activity/running");
  await expect(screen.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await screen.getByRole("textbox", { name: "Email", exact: true }).fill(adminEmail);
  await screen.getByLabel("Password", { exact: true }).fill("Incorrect fixture password");
  await screen.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(screen.getByRole("alert")).toContainText(/email|password|match|incorrect/i);
  await screen.getByLabel("Password", { exact: true }).fill(adminPassword);
  await screen.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(screen.getByRole("heading", { name: "Running", exact: true })).toBeVisible();
  expect(await browser.url()).toContain("/activity/running");
  await screen.getByRole("button", { name: "Account menu for E2E admin", exact: true }).click();
  await screen.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(screen.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("[deterministic] user management creates, edits, resets password and deletes a user", async ({
  app,
  screen,
}) => {
  await app.open("/settings/authentication/users");
  await screen.getByRole("button", { name: "Add user", exact: true }).click();
  let dialog = screen.getByRole("dialog", { name: "Add a user", exact: true });
  await dialog.getByRole("button", { name: "Add user", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("E2E managed user");
  await dialog
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("managed@e2e.example.test");
  await dialog.getByLabel("Password", { exact: true }).fill("User fixture password 123");
  await dialog.getByRole("button", { name: "Add user", exact: true }).click();
  await expect(dialog).toBeHidden();
  await screen.getByRole("button", { name: "Actions for E2E managed user", exact: true }).click();
  await screen.getByRole("button", { name: "Edit…", exact: true }).click();
  dialog = screen.getByRole("dialog", { name: "Edit E2E managed user", exact: true });
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("E2E renamed user");
  await dialog
    .getByRole("combobox", { name: "Role", exact: true })
    .selectOption({ value: "admin" });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(screen.getByRole("listitem").filter({ hasText: "E2E renamed user" })).toContainText(
    "Admin",
  );
  await screen.getByRole("button", { name: "Actions for E2E renamed user", exact: true }).click();
  await screen.getByRole("button", { name: "Set a new password…", exact: true }).click();
  dialog = screen.getByRole("dialog");
  await dialog.getByLabel("New password", { exact: true }).fill("Reset fixture password 456");
  await dialog.getByRole("button", { name: "Set password", exact: true }).click();
  await expect(dialog).toBeHidden();
  await app.clearState();
  await login(app, screen, "managed@e2e.example.test", "Reset fixture password 456");
  await expect(
    screen.getByRole("button", { name: "Account menu for E2E renamed user", exact: true }),
  ).toBeVisible();
  await app.clearState();
  await login(app, screen);
  await app.open("/settings/authentication/users");
  await screen.getByRole("button", { name: "Actions for E2E renamed user", exact: true }).click();
  await screen.getByRole("button", { name: "Delete…", exact: true }).click();
  await screen
    .getByRole("dialog")
    .getByRole("button", { name: "Delete user", exact: true })
    .click();
  await expect(
    screen.getByRole("button", { name: "Actions for E2E renamed user", exact: true }),
  ).toHaveCount(0);
});

test("[deterministic] regular user can use projects but cannot open administration or cleanup", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/settings/authentication/users");
  await screen.getByRole("button", { name: "Add user", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Add a user", exact: true });
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("E2E regular user");
  await dialog
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("regular@e2e.example.test");
  await dialog.getByLabel("Password", { exact: true }).fill("Regular fixture password 123");
  await dialog.getByRole("button", { name: "Add user", exact: true }).click();
  await expect(dialog).toBeHidden();
  await app.clearState();
  await login(app, screen, "regular@e2e.example.test", "Regular fixture password 123");
  await expect(
    screen
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("link", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  await expect(
    screen
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("link", { name: "Cleanup", exact: true }),
  ).toHaveCount(0);
  await screen
    .getByRole("row", { name: /^dirty-project / })
    .getByRole("button", { name: /main/ })
    .click();
  await expect(screen.getByRole("button", { name: "Stash changes", exact: true })).toBeVisible();
  await expect(screen.getByRole("button", { name: "More actions for this checkout" })).toHaveCount(
    0,
  );

  for (const route of ["/settings/authentication/users", "/cleanup/trash"]) {
    await app.open(route);
    await expect(screen.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    expect(new URL(await browser.url()).pathname).toBe("/");
  }

  const forbidden = await browser.evaluate<number>(
    `async () => (await fetch('/auth/methods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _tag: 'TurnOff' }) })).status`,
  );

  expect(forbidden).toBe(403);
});

test("[deterministic] profile name and uploaded picture persist and can be removed", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/account");
  await screen.getByRole("textbox", { name: "Name", exact: true }).fill("E2E profile name");
  await screen.getByRole("textbox", { name: "Name", exact: true }).press("Enter");
  await expect(
    screen.getByRole("button", { name: "Account menu for E2E profile name", exact: true }),
  ).toBeVisible();
  await browser.locator('input[type="file"]').setInputFiles("apps/web/public/apple-touch-icon.png");
  await expect(screen.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "E2E profile name",
  );
  await screen.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(screen.getByRole("button", { name: "Upload…", exact: true })).toBeVisible();
});

test("[deterministic] change password validates confirmation and accepts the new password", async ({
  app,
  screen,
}) => {
  await app.open("/account");
  await screen.getByLabel("Current password", { exact: true }).fill(adminPassword);
  await screen.getByLabel("New password", { exact: true }).fill(changedPassword);
  await screen.getByLabel("Confirm new password", { exact: true }).fill("Different password 999");
  await screen.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(screen.getByRole("status").filter({ hasText: "don't match" })).toBeVisible();
  await screen.getByLabel("Confirm new password", { exact: true }).fill(changedPassword);
  await screen.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(screen.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible();
  await app.clearState();
  await login(app, screen, adminEmail, changedPassword);
});

test("[deterministic] turning off password sign-in requires confirmation", async ({
  app,
  screen,
}) => {
  await app.open("/settings/authentication");
  await screen.getByRole("switch", { name: "Email and password", exact: true }).click();
  let dialog = screen.getByRole("dialog", { name: "Turn off sign-in?", exact: true });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    screen.getByRole("switch", { name: "Email and password", exact: true }),
  ).toBeChecked();
  await screen.getByRole("switch", { name: "Email and password", exact: true }).click();
  dialog = screen.getByRole("dialog", { name: "Turn off sign-in?", exact: true });
  await dialog.getByRole("button", { name: "Turn off sign-in", exact: true }).click();
  await expect(screen.getByRole("button", { name: "Preferences", exact: true })).toBeVisible();
  await app.clearState();
  await app.open("/cleanup/trash");
  await expect(screen.getByRole("heading", { name: "Trash", exact: true })).toBeVisible();
});

test("[deterministic] OpenID Connect saves discovery settings and signs in through a local provider", async ({
  app,
  screen,
  browser,
}) => {
  const provider = await startIdentityProvider();

  try {
    await app.open("/settings/authentication/oidc");
    await screen.getByRole("button", { name: "Save", exact: true }).click();
    await expect(screen.getByRole("textbox", { name: "Name", exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await screen.getByRole("textbox", { name: "Name", exact: true }).fill("E2E provider");
    await screen.getByRole("textbox", { name: "Issuer URL", exact: true }).fill(provider.issuer);
    await screen.getByRole("textbox", { name: "Client ID", exact: true }).fill("fleetfrog-e2e");
    await screen.getByLabel("Client secret", { exact: true }).fill("E2E provider client secret");

    if (app.baseUrl === undefined) {
      throw new Error("The dashboard URL is missing.");
    }

    await screen.getByRole("textbox", { name: "Dashboard URL", exact: true }).fill(app.baseUrl);
    await screen
      .getByRole("textbox", { name: "Required group (optional)", exact: true })
      .fill("fleetfrog-users");
    await expect(
      screen.getByText(new URL("/auth/oidc/callback", app.baseUrl).href, { exact: true }),
    ).toBeVisible();
    await screen.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      screen.getByRole("status").filter({ hasText: "Saved. The provider answered." }),
    ).toBeVisible();
    await app.open("/settings/authentication");
    await screen.getByRole("switch", { name: "OpenID Connect", exact: true }).click();
    await expect(screen.getByRole("switch", { name: "OpenID Connect", exact: true })).toBeChecked();
    await app.clearState();
    await app.open("/login");
    await screen.getByRole("link", { name: /E2E provider/ }).click();
    await expect(
      screen.getByRole("button", { name: "Account menu for E2E provider user", exact: true }),
    ).toBeVisible();
    await app.open("/account");
    await expect(
      screen.getByRole("main").getByText("provider@e2e.example.test", { exact: true }),
    ).toBeVisible();
    expect(new URL(await browser.url()).pathname).toBe("/account");
  } finally {
    await provider.close();
  }
});
