import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  platform: "node",
  target: "node26",
  format: "esm",
  // The protocol package ships as TypeScript source, so it is bundled rather than installed.
  deps: { alwaysBundle: [/^@fleetfrog\//] },
});
