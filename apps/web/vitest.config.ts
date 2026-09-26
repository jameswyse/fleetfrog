import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { vitestReporterConfiguration } from "../../tools/vitest/reporters.ts";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    ...vitestReporterConfiguration({
      githubActions: process.env.GITHUB_ACTIONS,
      humanOutput: process.env.FLEETFROG_HUMAN_OUTPUT,
    }),
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
