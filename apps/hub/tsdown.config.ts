import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  platform: "node",
  target: "node26",
  format: "esm",
  deps: { alwaysBundle: [/^@fleetfrog\//] },
});
