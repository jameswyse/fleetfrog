import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Source archives and CI installs do not need local Git hooks.
if (process.env.HUSKY !== "0" && !process.env.CI && existsSync(".git")) {
  const { default: husky } = await import("husky");
  const commonDirectory = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  const hooksDirectory = path.join(commonDirectory, "husky");
  const error = husky(hooksDirectory);

  if (error) {
    throw new Error(error);
  }

  // Share Husky's generated runners, but execute the current worktree's hook definitions.
  for (const entry of readdirSync(".husky", { withFileTypes: true })) {
    if (entry.isFile() && !entry.name.startsWith(".")) {
      writeFileSync(
        path.join(hooksDirectory, entry.name),
        'hook=".husky/$(basename "$0")"\nif [ -f "$hook" ]; then\n  sh -e "$hook" "$@"\nfi\n',
      );
    }
  }
}
