import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: ["coverage", "dist", "apps/web/src/routeTree.gen.ts"],
  sortImports: {
    internalPattern: ["@/", "#"],
    groups: [
      "value-builtin",
      "react-libs",
      "value-external",
      "value-internal",
      ["value-parent", "value-sibling", "value-index"],
      "type-builtin",
      "type-external",
      "type-internal",
      ["type-parent", "type-sibling", "type-index"],
      "unknown",
      "style",
    ],
    customGroups: [
      {
        groupName: "react-libs",
        elementNamePattern: ["react", "react-dom", "react-dom/*"],
        modifiers: ["value"],
        selector: "external",
      },
    ],
  },
  sortPackageJson: { sortScripts: true },
});
