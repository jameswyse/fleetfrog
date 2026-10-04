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
  settings: {
    react: { version: "19.3.0" },
  },
};
