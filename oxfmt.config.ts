import { createFormatConfig } from "@jameswyse/oxc-config/oxfmt";

export default createFormatConfig({
  ignorePatterns: ["apps/web/src/routeTree.gen.ts", ".github/workflows/pullfrog.yml"],
  sortImports: { internalPattern: ["@/", "~/", "#", "@fleetfrog/"] },
});
