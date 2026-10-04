import { createLintConfig } from "@jameswyse/oxc-config/oxlint";

const testFiles = ["**/*.test.{ts,tsx}"];
const nodeModules = ["node:*", "node:*/**", "@effect/platform-node", "@effect/platform-node/**"];

const base = createLintConfig({
  root: import.meta.dirname,
  react: ["apps/web/src/**/*.{ts,tsx}", "apps/site/src/**/*.ts"],
  node: ["apps/agent-ts/**/*.ts", "apps/hub/**/*.ts", "packages/**/*.ts"],
  vitest: true,
  tests: ["**/*.e2e.ts"],
  effect: true,
  env: ["apps/agent-ts/src/config/environment.ts", "tools/e2e/**"],
  boundaries: [
    {
      files: ["packages/protocol/src/**"],
      ignore: testFiles,
      deny: nodeModules,
      message: "The dashboard runs the protocol in the browser, so it can't import Node modules.",
    },
    {
      files: ["apps/web/src/**", "apps/site/src/**"],
      ignore: testFiles,
      deny: nodeModules,
      message: "This code runs in the browser, so it can't import Node modules.",
    },
    {
      files: ["apps/web/src/**"],
      deny: ["@fleetfrog/protocol/agent/**", "packages/protocol/src/agent/**"],
      message: "The dashboard talks to the hub through @fleetfrog/protocol/dashboard.",
    },
    {
      files: ["apps/agent-ts/src/**"],
      deny: ["@fleetfrog/protocol/dashboard/**", "packages/protocol/src/dashboard/**"],
      message: "The agent talks to the hub through @fleetfrog/protocol/agent.",
    },
    {
      files: ["packages/protocol/src/domain/**"],
      ignore: testFiles,
      deny: ["packages/protocol/src/{agent,dashboard,pairing}/**"],
      message: "The domain types are the base the agent, dashboard and pairing protocols build on.",
    },
    {
      files: ["packages/protocol/src/agent/**"],
      ignore: testFiles,
      deny: ["packages/protocol/src/dashboard/**"],
      message: "The agent protocol is between the hub and agents, apart from the dashboard's.",
    },
    {
      files: ["packages/protocol/src/dashboard/**"],
      ignore: testFiles,
      deny: ["packages/protocol/src/agent/**"],
      message: "The dashboard protocol is between the hub and the browser, apart from the agents'.",
    },
  ],
});

export default {
  ...base,
  ignorePatterns: [...base.ignorePatterns, "apps/web/src/routeTree.gen.ts"],
  overrides: [
    ...base.overrides,
    {
      files: ["apps/web/src/routes/**/*.tsx"],
      rules: {
        "typescript/only-throw-error": [
          "error",
          { allow: [{ from: "package", package: "@tanstack/router-core", name: "Redirect" }] },
        ],
      },
    },
  ],
  settings: {
    react: { version: "19.3.0" },
  },
};
