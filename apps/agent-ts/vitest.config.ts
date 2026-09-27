import { defineConfig } from "vitest/config";

import { vitestReporterConfiguration } from "../../tools/vitest/reporters.ts";

export default defineConfig({
  test: {
    ...vitestReporterConfiguration({
      githubActions: process.env.GITHUB_ACTIONS,
      humanOutput: process.env.FLEETFROG_HUMAN_OUTPUT,
    }),
    environment: "node",
    // Git run by the code under test ignores the developer's own configuration.
    env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    include: ["src/**/*.test.ts"],
  },
});
