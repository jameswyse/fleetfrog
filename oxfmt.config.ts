import { formatConfig } from "@jameswyse/oxc-config/oxfmt";

export default {
  ...formatConfig,
  ignorePatterns: [...formatConfig.ignorePatterns, "apps/web/src/routeTree.gen.ts"],
  sortImports: {
    ...formatConfig.sortImports,
    internalPattern: [...(formatConfig.sortImports.internalPattern ?? []), "@fleetfrog/"],
  },
};
