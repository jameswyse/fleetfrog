import { formatConfig } from "@jameswyse/oxc-config/oxfmt";

export default {
  ...formatConfig,
  ignorePatterns: [
    ...formatConfig.ignorePatterns,
    "apps/web/src/routeTree.gen.ts",
    ".github/workflows/pullfrog.yml",
  ],
  sortImports: {
    ...formatConfig.sortImports,
    internalPattern: [...(formatConfig.sortImports.internalPattern ?? []), "@fleetfrog/"],
  },
};
