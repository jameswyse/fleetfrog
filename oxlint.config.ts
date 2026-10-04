import { createLintConfig } from "@jameswyse/oxc-config/oxlint";

const base = createLintConfig({
  react: ["apps/web/src/**/*.{ts,tsx}", "apps/site/src/**/*.ts"],
  node: ["apps/agent-ts/**/*.ts", "apps/hub/**/*.ts", "packages/**/*.ts"],
  vitest: true,
  tests: ["**/*.e2e.ts"],
  effect: true,
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
