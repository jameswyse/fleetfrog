import { defineConfig } from "vitest/config";

import { vitestReporterConfiguration } from "../../tools/vitest/reporters.ts";

export default defineConfig({
  test: {
    ...vitestReporterConfiguration({
      githubActions: process.env.GITHUB_ACTIONS,
      humanOutput: process.env.FLEETFROG_HUMAN_OUTPUT,
    }),
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
