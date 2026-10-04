import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/bin.ts"],
  platform: "node",
  target: "node26",
  format: "esm",
  deps: { alwaysBundle: [/^@fleetfrog\//] },
});
